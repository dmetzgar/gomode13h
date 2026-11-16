/*
 * The mode 13h machine: an 8086, 1 MB of memory, a VGA in mode 13h and just enough
 * BIOS and DOS to run a small .COM program. No DOM in here; the page drives it
 * with runFrame() and reads the finished picture from `frame`.
 *
 * Timing is counted in instructions. A frame is 200 visible scanlines (each with an
 * active part and a horizontal blank) followed by the vertical retrace. Each scanline
 * is latched from video memory through the palette as the "beam" reaches it, so
 * palette changes made between lines show up as raster bars, and a copy that stays
 * ahead of the beam does not tear.
 */
(function (root) {
  'use strict';

  var CPU8086 = root.CPU8086 || (typeof require !== 'undefined' ? require('./cpu8086.js') : null);
  var AX = 0, CX = 1, DX = 2, BX = 3, SP = 4, DI = 7, ES = 0, CS = 1, SS = 2, DS = 3;

  var LOAD_SEG = 0x1000;          // programs load here, like a .COM file: CS=DS=ES=SS
  var VGA = 0xA0000;
  var WIDTH = 320, HEIGHT = 200;
  var VISIBLE = 0.89;             // share of a frame spent drawing the 200 lines; the rest is vertical retrace
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
    var frame = new Uint32Array(WIDTH * HEIGHT);
    var writeIndex = 0, writePart = 0, readIndex = 0, readPart = 0;
    var mode = 3;
    var budget = 420000;
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

    function setMode(m) {
      mode = m;
      if (m === 0x13) {
        mem.fill(0, VGA, VGA + WIDTH * HEIGHT);
        resetPalette();
      } else if (m !== 3) {
        warn('mode' + m, 'Video mode ' + hex(m, 2) + 'h is not emulated; only 13h shows a picture');
      }
    }

    function latchLine(y) {
      var at = y * WIDTH, src = VGA + at, x;
      if (mode !== 0x13) { frame.fill(0xFF000000, at, at + WIDTH); return; }
      for (x = 0; x < WIDTH; x++) frame[at + x] = pal32[mem[src + x]];
    }

    function inb(port) {
      var v, now;
      switch (port) {
        case 0x3DA:
          // Bit 3: vertical retrace. Bit 0: display disabled (either blank).
          v = phase === PHASE_VBLANK ? 9 : phase === PHASE_HBLANK ? 1 : 0;
          now = cpu.getCycles();
          // A program polling this in a tight loop is waiting for it to change: skip ahead.
          if (v === lastStatus && now - lastStatusAt <= 16) cpu.stop();
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
        case 0x3C5: case 0x3D5: case 0x3CF:
          warn('vgareg', 'VGA sequencer/CRTC/graphics registers are not emulated: only plain chained mode 13h');
          return 0;
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
        case 0x3C4: case 0x3C5: case 0x3D4: case 0x3D5: case 0x3CE: case 0x3CF: case 0x3C2:
          warn('vgareg', 'VGA sequencer/CRTC/graphics registers are not emulated: only plain chained mode 13h');
          return;
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

    // Advance the clock by `length` instructions, executing the program unless it is idle.
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
      var line = Math.floor(budget * VISIBLE / HEIGHT), active = Math.floor(line * ACTIVE), y;
      skipped = 0;
      if (clock < cpu.getCycles() - budget) clock = cpu.getCycles();   // never owe more than a frame
      for (y = 0; y < HEIGHT; y++) {
        latchLine(y);
        phase = PHASE_ACTIVE; advance(active);
        phase = PHASE_HBLANK; advance(line - active);
      }
      phase = PHASE_VBLANK;
      cpu.halted = false;   // HLT sleeps until the retrace starts (there are no other interrupts to wake it)
      advance(budget - line * HEIGHT);
      frames++;
      self.load = 1 - skipped / budget;
    };

    self.loadProgram = function (bytes, origin) {
      cpu.reset();
      mode = 3; frames = 0; clock = 0; phase = PHASE_VBLANK; keys = []; lastScan = 0; waitingForKey = false;
      lastStatus = -1; lastStatusAt = -100; warned = {};
      writeIndex = writePart = readIndex = readPart = 0;
      resetPalette();
      frame.fill(0xFF000000);
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

    self.setSpeed = function (instructionsPerFrame) { budget = Math.max(2000, instructionsPerFrame | 0); };
    self.resume = function () { if (self.state === 'paused') self.state = 'running'; };

    // Draw 64000 bytes at `segment` through the current palette (for looking at the back buffer).
    self.renderSegment = function (segment, target) {
      var at = (segment << 4) & 0xFFFFF, i;
      for (i = 0; i < WIDTH * HEIGHT; i++) target[i] = pal32[mem[(at + i) & 0xFFFFF]];
    };

    self.cpu = cpu;
    self.frame = frame;
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

  if (typeof module !== 'undefined' && module.exports) module.exports = Machine;
  else root.Mode13hMachine = Machine;
})(typeof self !== 'undefined' ? self : this);
