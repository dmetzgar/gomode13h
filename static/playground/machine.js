/*
 * The mode 13h machine: an 8086, 1 MB of memory, a VGA in mode 13h and just enough
 * BIOS and DOS to run a small .COM program. No DOM in here; the page drives it
 * with runFrame() and reads the finished picture from `frame`.
 *
 * Timing is counted in CPU clock cycles. A frame is the visible scanlines (each with an
 * active part and a horizontal blank) followed by the vertical retrace. Each scanline
 * is latched from video memory through the palette as the "beam" reaches it, so
 * palette changes made between lines show up as raster bars, and a copy that stays
 * ahead of the beam does not tear.
 *
 * The VGA also does the unchained 256-colour modes built on mode 13h ("Mode X"):
 * turning chain-4 off in the sequencer exposes all 256K as four planes, written
 * through the map mask and the graphics controller's write modes and latches. The
 * CRTC start address, row offset and vertical size (200 or 240 lines) are honoured;
 * split screen, pixel panning and the 400/480-line modes are not.
 */
(function (root) {
  'use strict';

  var CPU8086 = root.CPU8086 || (typeof require !== 'undefined' ? require('./cpu8086.js') : null);
  var AX = 0, CX = 1, DX = 2, BX = 3, SP = 4, DI = 7, ES = 0, CS = 1, SS = 2, DS = 3;

  var LOAD_SEG = 0x1000;          // programs load here, like a .COM file: CS=DS=ES=SS
  var VGA = 0xA0000;
  var WIDTH = 320, HEIGHT = 200, MAX_HEIGHT = 240;
  var BLACK = 0xFF000000;
  var VISIBLE = 0.89;             // share of a frame spent drawing the visible lines; the rest is vertical retrace
  var ACTIVE = 0.8;               // share of a scanline that is not horizontal blank
  var PHASE_ACTIVE = 0, PHASE_HBLANK = 1, PHASE_VBLANK = 2;

  // The palette the BIOS loads for mode 13h, as 6-bit DAC values.
  function defaultPalette() {
    var p = [
      [0, 0, 0], [0, 0, 42], [0, 42, 0], [0, 42, 42], [42, 0, 0], [42, 0, 42], [42, 21, 0], [42, 42, 42],
      [21, 21, 21], [21, 21, 63], [21, 63, 21], [21, 63, 63], [63, 21, 21], [63, 21, 63], [63, 63, 21], [63, 63, 63]
    ];
    [0, 5, 8, 11, 14, 17, 20, 24, 28, 32, 36, 40, 45, 50, 56, 63].forEach(function (g) { p.push([g, g, g]); });
    [
      [0, 16, 31, 47, 63], [31, 39, 47, 55, 63], [45, 49, 54, 58, 63],
      [0, 7, 14, 21, 28], [14, 17, 21, 24, 28], [20, 22, 24, 26, 28],
      [0, 4, 8, 12, 16], [8, 10, 12, 14, 16], [11, 12, 13, 15, 16]
    ].forEach(function (r) {
      var lo = r[0], hi = r[4], i;
      for (i = 0; i < 4; i++) p.push([r[i], lo, hi]);
      for (i = 0; i < 4; i++) p.push([hi, lo, r[4 - i]]);
      for (i = 0; i < 4; i++) p.push([hi, r[i], lo]);
      for (i = 0; i < 4; i++) p.push([r[4 - i], hi, lo]);
      for (i = 0; i < 4; i++) p.push([lo, hi, r[i]]);
      for (i = 0; i < 4; i++) p.push([lo, r[4 - i], hi]);
    });
    while (p.length < 256) p.push([0, 0, 0]);
    var flat = new Uint8Array(768);
    p.forEach(function (c, i) { flat[i * 3] = c[0]; flat[i * 3 + 1] = c[1]; flat[i * 3 + 2] = c[2]; });
    return flat;
  }

  function hex(v, n) { return CPU8086.hex(v, n); }

  function Machine() {
    var self = this;
    var dac = new Uint8Array(768);
    var pal32 = new Uint32Array(256);
    var frame = new Uint32Array(WIDTH * MAX_HEIGHT);
    // VGA registers, and the four 64K planes used once chain-4 is off (plane p starts at p << 16).
    var seq = new Uint8Array(8), gc = new Uint8Array(16), crtc = new Uint8Array(32);
    var seqIndex = 0, gcIndex = 0, crtcIndex = 0, misc = 0x63;
    var planes = new Uint8Array(4 << 16), latch = new Uint8Array(4);
    var chain4 = true, lines = HEIGHT, startAddress = 0;
    var writeIndex = 0, writePart = 0, readIndex = 0, readPart = 0;
    var mode = 3;
    var budget = 4000000;           // clock cycles per frame
    var clock = 0, phase = PHASE_VBLANK, skipped = 0;
    var lastStatus = -1, lastStatusAt = -100;
    var keys = [], lastScan = 0, waitingForKey = false;
    var frames = 0, warned = {};

    var cpu = new CPU8086({ inb: inb, outb: outb, interrupt: interrupt });
    var mem = cpu.mem, r = cpu.reg, s = cpu.seg;

    function warn(key, text) {
      if (warned[key]) return;
      warned[key] = true;
      if (self.onOutput) self.onOutput('\n[' + text + ']\n');
    }

    function print(text) { if (self.onOutput) self.onOutput(text); }

    // --- VGA ------------------------------------------------------------------

    function updateColor(i) {
      var c = i * 3;
      var red = (dac[c] << 2) | (dac[c] >> 4), green = (dac[c + 1] << 2) | (dac[c + 1] >> 4), blue = (dac[c + 2] << 2) | (dac[c + 2] >> 4);
      pal32[i] = (255 << 24) | (blue << 16) | (green << 8) | red;
    }

    function resetPalette() {
      dac.set(defaultPalette());
      for (var i = 0; i < 256; i++) updateColor(i);
    }

    // Register values the BIOS loads for mode 13h.
    function resetRegisters() {
      seq.fill(0); gc.fill(0); crtc.fill(0);
      seq.set([0x03, 0x01, 0x0F, 0x00, 0x0E]);
      gc.set([0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x05, 0x0F, 0xFF]);
      crtc.set([0x5F, 0x4F, 0x50, 0x82, 0x54, 0x80, 0xBF, 0x1F, 0x00, 0x41, 0, 0, 0, 0, 0, 0,
        0x9C, 0x8E, 0x8F, 0x28, 0x40, 0x96, 0xB9, 0xA3, 0xFF]);
      seqIndex = gcIndex = crtcIndex = 0; misc = 0x63;
      latch.fill(0);
      chain4 = true; lines = HEIGHT; startAddress = 0;
      cpu.setVideo(null);
    }

    // Chain-4 on: A000h is 64K of ordinary memory, one byte per pixel (plain mode 13h).
    // Chain-4 off: the CPU reaches the planes through planarRead/planarWrite.
    // Pixel n of the chained layout lives in plane n & 3 at offset n >> 2, which is where the
    // unchained display looks for it, so a picture survives the switch. (A real card keeps the
    // bytes where they were and shows them scrambled; programs clear the memory anyway.)
    function setChain4(on) {
      var i;
      if (on === chain4) return;
      chain4 = on;
      if (on) for (i = 0; i < 0x10000; i++) mem[VGA + i] = planes[((i & 3) << 16) | (i >> 2)];
      else for (i = 0; i < 0x10000; i++) planes[((i & 3) << 16) | (i >> 2)] = mem[VGA + i];
      cpu.setVideo(on ? null : planar);
    }

    function planarRead(at) {
      var p, v;
      latch[0] = planes[at]; latch[1] = planes[0x10000 | at]; latch[2] = planes[0x20000 | at]; latch[3] = planes[0x30000 | at];
      if (!(gc[5] & 8)) return latch[gc[4] & 3];
      // Read mode 1: a 1 bit wherever the pixel matches the colour compare register.
      for (v = 0, p = 0; p < 4; p++) if ((gc[7] >> p) & 1) v |= latch[p] ^ ((gc[2] >> p) & 1 ? 0xFF : 0);
      return ~v & 0xFF;
    }

    function planarWrite(at, v) {
      var mask = seq[2] & 15, wm = gc[5] & 3, bits = gc[8], rot, fn, p, val;
      if (wm === 1) {   // copy the latches: four pixels per byte moved within video memory
        for (p = 0; p < 4; p++) if ((mask >> p) & 1) planes[(p << 16) | at] = latch[p];
        return;
      }
      if (wm === 0 && gc[1] === 0 && gc[3] === 0 && bits === 0xFF) {   // the usual case: the byte goes to every enabled plane
        for (p = 0; p < 4; p++) if ((mask >> p) & 1) planes[(p << 16) | at] = v;
        return;
      }
      rot = gc[3] & 7; fn = (gc[3] >> 3) & 3;
      if (wm !== 2) v = ((v >> rot) | (v << (8 - rot))) & 0xFF;
      if (wm === 3) bits &= v;
      for (p = 0; p < 4; p++) {
        if (!((mask >> p) & 1)) continue;
        if (wm === 0) val = (gc[1] >> p) & 1 ? ((gc[0] >> p) & 1 ? 0xFF : 0) : v;
        else if (wm === 2) val = (v >> p) & 1 ? 0xFF : 0;
        else val = (gc[0] >> p) & 1 ? 0xFF : 0;
        if (wm !== 3) {
          if (fn === 1) val &= latch[p]; else if (fn === 2) val |= latch[p]; else if (fn === 3) val ^= latch[p];
        }
        planes[(p << 16) | at] = (val & bits) | (latch[p] & ~bits);
      }
    }

    var planar = { read: planarRead, write: planarWrite };

    // Visible lines, from the CRTC's vertical display end and scan-line doubling.
    function updateLines() {
      var end = crtc[0x12] | ((crtc[7] & 0x02) << 7) | ((crtc[7] & 0x40) << 3);
      var n = Math.floor((end + 1) / ((crtc[9] & 0x1F) + 1));
      if (crtc[9] & 0x80) n >>= 1;
      if (n > MAX_HEIGHT) { warn('lines', 'A ' + n + '-line display is not emulated; showing the top ' + MAX_HEIGHT + ' lines'); n = MAX_HEIGHT; }
      lines = Math.max(1, n);
    }

    function setMode(m) {
      mode = m;
      resetRegisters();
      if (m === 0x13) {
        mem.fill(0, VGA, VGA + 0x10000);
        planes.fill(0);
        resetPalette();
      } else if (m !== 3) {
        warn('mode' + m, 'Video mode ' + hex(m, 2) + 'h is not emulated; only 13h shows a picture');
      }
    }

    // The CRTC counts in units of four pixels in both layouts: the start address is in those units and
    // the offset register holds half the units per row (40 gives 80 units, 320 pixels).
    function latchLine(y) {
      var at = y * WIDTH, src = VGA + at, pitch = crtc[0x13] * 2, unit, x;
      if (mode !== 0x13) { frame.fill(BLACK, at, at + WIDTH); return; }
      if (chain4 && startAddress === 0 && pitch === 80) {
        for (x = 0; x < WIDTH; x++) frame[at + x] = pal32[mem[src + x]];
        return;
      }
      unit = startAddress + y * pitch;
      if (chain4) for (x = 0; x < WIDTH; x++) frame[at + x] = pal32[mem[VGA + ((((unit + (x >> 2)) << 2) | (x & 3)) & 0xFFFF)]];
      else for (x = 0; x < WIDTH; x++) frame[at + x] = pal32[planes[((x & 3) << 16) | ((unit + (x >> 2)) & 0xFFFF)]];
    }

    function inb(port) {
      var v, now;
      switch (port) {
        case 0x3DA:
          // Bit 3: vertical retrace. Bit 0: display disabled (either blank).
          v = phase === PHASE_VBLANK ? 9 : phase === PHASE_HBLANK ? 1 : 0;
          now = cpu.getCycles();
          // A program polling this in a tight loop is waiting for it to change: skip ahead.
          if (v === lastStatus && now - lastStatusAt <= 48) cpu.stop();
          lastStatus = v; lastStatusAt = now;
          return v;
        case 0x3C9:
          v = dac[readIndex * 3 + readPart];
          if (++readPart === 3) { readPart = 0; readIndex = (readIndex + 1) & 255; }
          return v;
        case 0x3C8: return writeIndex;
        case 0x3C7: return 3;
        case 0x3C6: return 0xFF;
        case 0x60: return lastScan;
        case 0x40: return cpu.getCycles() & 0xFF;   // PIT counter: only good as a source of changing numbers
        case 0x3C4: return seqIndex;
        case 0x3C5: return seq[seqIndex & 7];
        case 0x3CE: return gcIndex;
        case 0x3CF: return gc[gcIndex & 15];
        case 0x3D4: return crtcIndex;
        case 0x3D5: return crtc[crtcIndex & 31];
        case 0x3CC: return misc;
      }
      return 0xFF;
    }

    function outb(port, v) {
      switch (port) {
        case 0x3C8: writeIndex = v; writePart = 0; return;
        case 0x3C7: readIndex = v; readPart = 0; return;
        case 0x3C9:
          dac[writeIndex * 3 + writePart] = v & 63;
          if (++writePart === 3) { writePart = 0; updateColor(writeIndex); writeIndex = (writeIndex + 1) & 255; }
          return;
        case 0x3C4: seqIndex = v; return;
        case 0x3C5:
          seq[seqIndex & 7] = v;
          if ((seqIndex & 7) === 4) setChain4((v & 8) !== 0);   // memory mode: bit 3 is chain-4
          return;
        case 0x3CE: gcIndex = v; return;
        case 0x3CF: gc[gcIndex & 15] = v; return;
        case 0x3D4: crtcIndex = v; return;
        case 0x3D5:
          crtc[crtcIndex & 31] = v;
          if ((crtcIndex & 31) === 0x18 && v !== 0xFF) warn('split', 'The CRTC line compare (split screen) is not emulated');
          updateLines();
          return;
        case 0x3C2: misc = v; return;
        case 0x3C0: warn('attr', 'The attribute controller (pixel panning and the like) is not emulated'); return;
      }
    }

    // --- BIOS and DOS services ----------------------------------------------

    function retry() {
      // Re-run the INT next time, and idle until a key arrives.
      cpu.setIP(cpu.getIP() - 2);
      waitingForKey = true;
      cpu.stop();
    }

    function finish() {
      self.state = 'exited';
      cpu.stop();
    }

    function video() {
      var ah = r[AX] >> 8, al = r[AX] & 0xFF, i, n, at;
      switch (ah) {
        case 0x00: setMode(al & 0x7F); return;
        case 0x0F: r[AX] = (40 << 8) | mode; r[BX] &= 0x00FF; return;
        case 0x0C:
          if (mode === 0x13 && r[CX] < WIDTH && r[DX] < HEIGHT) mem[VGA + r[DX] * WIDTH + r[CX]] = al;
          return;
        case 0x0D:
          r[AX] = (ah << 8) | (r[CX] < WIDTH && r[DX] < HEIGHT ? mem[VGA + r[DX] * WIDTH + r[CX]] : 0);
          return;
        case 0x0E: print(String.fromCharCode(al)); return;
        case 0x10:
          switch (al) {
            case 0x10:   // set one DAC register: BX = index, DH/CH/CL = red/green/blue
              i = r[BX] & 255;
              dac[i * 3] = (r[DX] >> 8) & 63; dac[i * 3 + 1] = (r[CX] >> 8) & 63; dac[i * 3 + 2] = r[CX] & 63;
              updateColor(i);
              return;
            case 0x12:   // set a block: BX = first, CX = count, ES:DX = table
              at = (s[ES] << 4) + r[DX];
              for (n = 0, i = r[BX] & 255; n < r[CX] && i < 256; n++, i++) {
                dac[i * 3] = mem[(at + n * 3) & 0xFFFFF] & 63; dac[i * 3 + 1] = mem[(at + n * 3 + 1) & 0xFFFFF] & 63; dac[i * 3 + 2] = mem[(at + n * 3 + 2) & 0xFFFFF] & 63;
                updateColor(i);
              }
              return;
            case 0x15:   // read one DAC register
              i = r[BX] & 255;
              r[DX] = (dac[i * 3] << 8) | (r[DX] & 0xFF); r[CX] = (dac[i * 3 + 1] << 8) | dac[i * 3 + 2];
              return;
            case 0x17:   // read a block
              at = (s[ES] << 4) + r[DX];
              for (n = 0, i = r[BX] & 255; n < r[CX] && i < 256; n++, i++) {
                mem[(at + n * 3) & 0xFFFFF] = dac[i * 3]; mem[(at + n * 3 + 1) & 0xFFFFF] = dac[i * 3 + 1]; mem[(at + n * 3 + 2) & 0xFFFFF] = dac[i * 3 + 2];
              }
              return;
          }
          warn('int10-10-' + al, 'int 10h AX=10' + hex(al, 2) + 'h is not emulated');
          return;
        case 0x01: case 0x02: case 0x03: case 0x05: case 0x0B: return;   // cursor and friends: nothing to do
      }
      warn('int10-' + ah, 'int 10h AH=' + hex(ah, 2) + 'h is not emulated');
    }

    function keyboard() {
      var ah = r[AX] >> 8;
      switch (ah) {
        case 0x00: case 0x10:
          if (!keys.length) { retry(); return; }
          r[AX] = keys.shift();
          return;
        case 0x01: case 0x11:
          if (keys.length) { r[AX] = keys[0]; cpu.setZF(0); } else cpu.setZF(1);
          return;
        case 0x02: r[AX] &= 0xFF00; return;
      }
      warn('int16-' + ah, 'int 16h AH=' + hex(ah, 2) + 'h is not emulated');
    }

    function dos() {
      var ah = r[AX] >> 8, at, n, ch, d;
      switch (ah) {
        case 0x00: case 0x4C: finish(); return;
        case 0x02: print(String.fromCharCode(r[DX] & 0xFF)); return;
        case 0x09:
          at = (s[DS] << 4) + r[DX];
          for (n = 0, ch = ''; n < 4096 && mem[(at + n) & 0xFFFFF] !== 0x24; n++) ch += String.fromCharCode(mem[(at + n) & 0xFFFFF]);
          print(ch);
          return;
        case 0x01: case 0x07: case 0x08:
          if (!keys.length) { retry(); return; }
          r[AX] = (r[AX] & 0xFF00) | (keys.shift() & 0xFF);
          return;
        case 0x0B: r[AX] = (r[AX] & 0xFF00) | (keys.length ? 0xFF : 0); return;
        case 0x25: at = (r[AX] & 0xFF) * 4; cpu.write16(at, r[DX]); cpu.write16(at + 2, s[DS]); return;
        case 0x35: at = (r[AX] & 0xFF) * 4; r[BX] = cpu.read16(at); s[ES] = cpu.read16(at + 2); return;
        case 0x2C:
          d = new Date();
          r[CX] = (d.getHours() << 8) | d.getMinutes();
          r[DX] = (d.getSeconds() << 8) | Math.floor(d.getMilliseconds() / 10);
          return;
        case 0x30: r[AX] = 0x0005; return;
      }
      warn('int21-' + ah, 'int 21h AH=' + hex(ah, 2) + 'h is not emulated');
    }

    function interrupt(n) {
      var t;
      switch (n) {
        case 0x10: video(); return true;
        case 0x16: keyboard(); return true;
        case 0x20: finish(); return true;
        case 0x21: dos(); return true;
        case 0x1A:
          if ((r[AX] >> 8) === 0) {   // ticks since midnight, counted in emulated frames
            t = Math.floor(frames * 18.2065 / self.refresh);
            r[CX] = (t >>> 16) & 0xFFFF; r[DX] = t & 0xFFFF; r[AX] &= 0xFF00;
          }
          return true;
        case 0x03:
          self.state = 'paused';
          print('\n[int 3 breakpoint]\n');
          cpu.stop();
          return true;
      }
      return false;
    }

    // --- running ----------------------------------------------------------------

    function idle() { return self.state !== 'running' || cpu.halted || (waitingForKey && !keys.length); }

    // Advance the clock by `length` cycles, executing the program unless it is idle.
    function advance(length) {
      var target = clock + length, before;
      if (!idle()) {
        waitingForKey = false;
        before = cpu.getCycles();
        try {
          cpu.runUntil(target);
        } catch (e) {
          if (!e.cpuFault) throw e;
          self.state = 'fault';
          self.fault = { message: e.message, cs: e.cs, ip: e.ip };
        }
        if (cpu.getCycles() < target) skipped += target - cpu.getCycles();
      } else {
        skipped += Math.max(0, target - cpu.getCycles());
      }
      cpu.skipTo(target);
      clock = target;
    }

    // Emulate one full frame: 200 scanlines, then the vertical retrace.
    self.runFrame = function () {
      var shown = lines, line = Math.floor(budget * VISIBLE / shown), active = Math.floor(line * ACTIVE), y;
      skipped = 0;
      if (clock < cpu.getCycles() - budget) clock = cpu.getCycles();   // never owe more than a frame
      self.height = shown;
      for (y = 0; y < shown; y++) {
        latchLine(y);
        phase = PHASE_ACTIVE; advance(active);
        phase = PHASE_HBLANK; advance(line - active);
      }
      phase = PHASE_VBLANK;
      startAddress = (crtc[0x0C] << 8) | crtc[0x0D];   // a new start address takes effect as the retrace begins
      cpu.halted = false;   // HLT sleeps until the retrace starts (there are no other interrupts to wake it)
      advance(budget - line * shown);
      frames++;
      self.load = 1 - skipped / budget;
    };

    self.loadProgram = function (bytes, origin) {
      cpu.reset();
      mode = 3; frames = 0; clock = 0; phase = PHASE_VBLANK; keys = []; lastScan = 0; waitingForKey = false;
      lastStatus = -1; lastStatusAt = -100; warned = {};
      writeIndex = writePart = readIndex = readPart = 0;
      resetPalette();
      frame.fill(BLACK);
      resetRegisters();
      self.height = HEIGHT;
      s[CS] = s[DS] = s[ES] = s[SS] = LOAD_SEG;
      mem[LOAD_SEG << 4] = 0xCD; mem[(LOAD_SEG << 4) + 1] = 0x20;   // PSP: "int 20h", reached by a final ret
      mem.set(bytes, (LOAD_SEG << 4) + origin);
      r[SP] = 0xFFFE;
      cpu.write16((LOAD_SEG << 4) + 0xFFFE, 0);
      cpu.setIP(origin);
      self.state = 'running';
      self.fault = null;
      self.load = 0;
    };

    self.keyDown = function (scan, ascii) {
      lastScan = scan & 0x7F;
      if (keys.length < 16) keys.push(((scan & 0x7F) << 8) | (ascii & 0xFF));
    };
    self.keyUp = function (scan) { lastScan = (scan & 0x7F) | 0x80; };

    self.setSpeed = function (cyclesPerFrame) { budget = Math.max(20000, Math.floor(cyclesPerFrame)); };
    self.resume = function () { if (self.state === 'paused') self.state = 'running'; };

    self.cpu = cpu;
    self.frame = frame;         // WIDTH x MAX_HEIGHT; the top `height` rows are the picture
    self.height = HEIGHT;
    self.planes = planes;
    self.refresh = 60;
    self.state = 'idle';
    self.fault = null;
    self.load = 0;
    self.onOutput = null;
    self.getMode = function () { return mode; };
    self.getFrames = function () { return frames; };
  }

  Machine.LOAD_SEG = LOAD_SEG;
  Machine.WIDTH = WIDTH;
  Machine.HEIGHT = HEIGHT;
  Machine.MAX_HEIGHT = MAX_HEIGHT;

  if (typeof module !== 'undefined' && module.exports) module.exports = Machine;
  else root.Mode13hMachine = Machine;
})(typeof self !== 'undefined' ? self : this);
