/*
 * Intel 8086 CPU core.
 *
 * Executes real machine code against a 1 MB real-mode address space. Covers the
 * documented 8086 instruction set; 80186+ opcodes are rejected, not emulated.
 *
 * Time is counted in clock cycles, using Intel's published execution times for the
 * 8086: a fixed cost per instruction form, plus the effective address calculation
 * for memory operands, plus the per-bit and per-repetition terms of shifts and
 * string instructions. Multiplies and divides are documented as a range; they are
 * charged the low end plus one cycle per set bit of the multiplier or quotient,
 * which stays inside it. Like Intel's figures, this leaves out the time spent
 * fetching instruction bytes, so a real 8086 is somewhat slower than the total.
 *
 * The host supplies `io`:
 *   io.inb(port) -> byte, io.outb(port, byte)
 *   io.interrupt(n, cpu) -> true if the host handled INT n (otherwise the IVT is used)
 */
(function (root) {
  'use strict';

  var AX = 0, CX = 1, DX = 2, BX = 3, SP = 4, BP = 5, SI = 6, DI = 7;
  var ES = 0, CS = 1, SS = 2, DS = 3;

  var PARITY = new Uint8Array(256);
  (function () {
    for (var i = 0; i < 256; i++) {
      var bits = 0;
      for (var b = 0; b < 8; b++) bits += (i >> b) & 1;
      PARITY[i] = (bits & 1) ? 0 : 1;
    }
  })();

  // Clock cycles by opcode. CYCLES is the cost with register operands (or the only cost);
  // MEMORY is what a memory operand adds to it, before the effective address time.
  // Opcodes whose cost depends on the ModRM reg field, a count or a branch are finished in step().
  var CYCLES = new Uint8Array(256), MEMORY = new Uint8Array(256);
  (function () {
    function set(ops, reg, mem) {
      ops.forEach(function (op) { CYCLES[op] = reg; MEMORY[op] = mem === undefined ? 0 : mem - reg; });
    }
    function range(a, b) { var out = []; for (; a <= b; a++) out.push(a); return out; }
    for (var k = 0; k < 8; k++) {
      set([k * 8, k * 8 + 1], 3, k === 7 ? 9 : 16);       // ALU r/m, reg (CMP writes nothing back)
      set([k * 8 + 2, k * 8 + 3], 3, 9);                  // ALU reg, r/m
      set([k * 8 + 4, k * 8 + 5], 4);                     // ALU acc, imm
    }
    set([0x06, 0x0E, 0x16, 0x1E], 10);                    // PUSH seg
    set([0x07, 0x17, 0x1F], 8);                           // POP seg
    set([0x27, 0x2F], 4); set([0x37, 0x3F], 8);           // DAA DAS, AAA AAS
    set(range(0x40, 0x4F), 2);                            // INC/DEC reg16
    set(range(0x50, 0x57), 11); set(range(0x58, 0x5F), 8);
    set(range(0x70, 0x7F), 4);                            // Jcc not taken; 16 if taken
    set([0x84, 0x85], 3, 9);                              // TEST
    set([0x86, 0x87], 4, 17);                             // XCHG
    set([0x88, 0x89, 0x8C], 2, 9);                        // MOV r/m, reg
    set([0x8A, 0x8B, 0x8E], 2, 8);                        // MOV reg, r/m
    set([0x8D], 2);                                       // LEA: 2 + EA
    set([0x8F], 8, 17);                                   // POP r/m
    set(range(0x90, 0x97), 3);                            // NOP, XCHG AX, reg
    set([0x98], 2); set([0x99], 5);                       // CBW, CWD
    set([0x9A], 28); set([0x9B], 4);                      // CALL far, WAIT
    set([0x9C], 10); set([0x9D], 8); set([0x9E, 0x9F], 4);
    set(range(0xA0, 0xA3), 10);                           // MOV acc <-> direct address
    set([0xA8, 0xA9], 4);                                 // TEST acc, imm
    set(range(0xB0, 0xBF), 4);                            // MOV reg, imm
    set([0xC2], 12); set([0xC3], 8); set([0xCA], 17); set([0xCB], 18);
    set([0xC4, 0xC5], 16);                                // LES, LDS: 16 + EA
    set([0xC6, 0xC7], 4, 10);                             // MOV r/m, imm
    set([0xCC], 52); set([0xCD], 51); set([0xCE], 4); set([0xCF], 24);
    set([0xD0, 0xD1], 2, 15);                             // shift by 1
    set([0xD2, 0xD3], 8, 20);                             // shift by CL: plus 4 per bit
    set([0xD4], 83); set([0xD5], 60); set([0xD6], 4); set([0xD7], 11);
    set(range(0xD8, 0xDF), 2, 8);                         // ESC
    set([0xE0, 0xE2], 5); set([0xE1, 0xE3], 6);           // LOOPNE, LOOP, LOOPE, JCXZ when not taken
    set([0xE4, 0xE5, 0xE6, 0xE7], 10); set([0xEC, 0xED, 0xEE, 0xEF], 8);
    set([0xE8], 19); set([0xE9, 0xEA, 0xEB], 15);
    set([0xF4, 0xF5, 0xF8, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD], 2);
  })();

  // Effective address time by ModRM rm field: without a displacement, and with one.
  var EA_PLAIN = [7, 8, 8, 7, 5, 5, 6, 5], EA_DISP = [11, 12, 12, 11, 9, 9, 9, 9];
  // String instructions MOVS CMPS . STOS LODS SCAS, indexed by (opcode - A4h) >> 1: alone, and per repetition.
  var STRING_ONCE = [18, 22, 0, 11, 12, 15], STRING_REP = [17, 22, 0, 10, 13, 15];

  function bitCount(v) { var n = 0; for (; v; v &= v - 1) n++; return n; }

  function hex(v, n) {
    var t = v.toString(16).toUpperCase();
    while (t.length < n) t = '0' + t;
    return t;
  }

  function CPU8086(io) {
    io = io || {};
    var self = this;
    var mem = new Uint8Array(0x100000);
    var r = new Uint16Array(8);
    var s = new Uint16Array(4);
    var ip = 0;
    var cf = 0, pf = 0, af = 0, zf = 0, sf = 0, tf = 0, ifl = 0, df = 0, of = 0;
    var cycles = 0, idle = 0, limit = Infinity, stop = false;
    var curOp = 0, resumed = false;
    var video = null;
    var segOverride = -1, rep = 0;
    var mod = 0, reg = 0, rm = 0, ea = 0, eo = 0, eseg = 0;
    var opCS = 0, opIP = 0;   // where the current instruction started, for error reports

    function fault(message) {
      var e = new Error(message);
      e.cpuFault = true;
      e.cs = opCS;
      e.ip = opIP;
      return e;
    }

    // --- memory -----------------------------------------------------------

    // Data reads and writes go through here so the machine can take over segment A000h
    // (a VGA in a planar mode does not behave like plain memory). Code is always fetched from `mem`.
    function rb(a) { return video !== null && (a >>> 16) === 0xA ? video.read(a & 0xFFFF) : mem[a]; }
    function wb(a, v) { if (video !== null && (a >>> 16) === 0xA) video.write(a & 0xFFFF, v & 0xFF); else mem[a] = v; }
    function rd16(a) { return rb(a) | (rb((a + 1) & 0xFFFFF) << 8); }
    function wr16(a, v) { wb(a, v & 0xFF); wb((a + 1) & 0xFFFFF, (v >> 8) & 0xFF); }

    function fetch8() {
      var v = mem[((s[CS] << 4) + ip) & 0xFFFFF];
      ip = (ip + 1) & 0xFFFF;
      return v;
    }

    function fetch16() {
      var v = fetch8();
      return v | (fetch8() << 8);
    }

    function fetchS8() { return (fetch8() << 24) >> 24; }

    function push16(v) {
      r[SP] -= 2;
      wr16(((s[SS] << 4) + r[SP]) & 0xFFFFF, v);
    }

    function pop16() {
      var v = rd16(((s[SS] << 4) + r[SP]) & 0xFFFFF);
      r[SP] += 2;
      return v;
    }

    // --- registers and operands -------------------------------------------

    function g8(i) { return i < 4 ? r[i] & 0xFF : r[i - 4] >> 8; }

    function s8(i, v) {
      if (i < 4) r[i] = (r[i] & 0xFF00) | (v & 0xFF);
      else r[i - 4] = (r[i - 4] & 0xFF) | ((v & 0xFF) << 8);
    }

    function modrm() {
      var b = fetch8(), off = 0, seg = DS;
      mod = b >> 6; reg = (b >> 3) & 7; rm = b & 7;
      if (mod === 3) return;
      cycles += MEMORY[curOp] + (mod === 0 ? EA_PLAIN[rm] : EA_DISP[rm]);
      switch (rm) {
        case 0: off = r[BX] + r[SI]; break;
        case 1: off = r[BX] + r[DI]; break;
        case 2: off = r[BP] + r[SI]; seg = SS; break;
        case 3: off = r[BP] + r[DI]; seg = SS; break;
        case 4: off = r[SI]; break;
        case 5: off = r[DI]; break;
        case 6: if (mod === 0) off = fetch16(); else { off = r[BP]; seg = SS; } break;
        case 7: off = r[BX]; break;
      }
      if (mod === 1) off += fetchS8();
      else if (mod === 2) off += fetch16();
      eo = off & 0xFFFF;
      eseg = segOverride >= 0 ? segOverride : seg;
      ea = ((s[eseg] << 4) + eo) & 0xFFFFF;
    }

    function getRM8() { return mod === 3 ? g8(rm) : rb(ea); }
    function setRM8(v) { if (mod === 3) s8(rm, v); else wb(ea, v & 0xFF); }
    function getRM16() { return mod === 3 ? r[rm] : rd16(ea); }
    function setRM16(v) { if (mod === 3) r[rm] = v; else wr16(ea, v); }

    function needMem(what) {
      if (mod === 3) throw fault(what + ' needs a memory operand');
    }

    // --- flags ------------------------------------------------------------

    function szp8(v) { zf = v === 0 ? 1 : 0; sf = v >> 7; pf = PARITY[v]; }
    function szp16(v) { zf = v === 0 ? 1 : 0; sf = v >> 15; pf = PARITY[v & 0xFF]; }

    function add8(a, b, c) {
      var t = a + b + c, res = t & 0xFF;
      cf = t >> 8;
      af = ((a ^ b ^ res) >> 4) & 1;
      of = ((~(a ^ b) & (a ^ res)) >> 7) & 1;
      szp8(res);
      return res;
    }

    function add16(a, b, c) {
      var t = a + b + c, res = t & 0xFFFF;
      cf = t >> 16;
      af = ((a ^ b ^ res) >> 4) & 1;
      of = ((~(a ^ b) & (a ^ res)) >> 15) & 1;
      szp16(res);
      return res;
    }

    function sub8(a, b, c) {
      var t = a - b - c, res = t & 0xFF;
      cf = t < 0 ? 1 : 0;
      af = ((a ^ b ^ res) >> 4) & 1;
      of = (((a ^ b) & (a ^ res)) >> 7) & 1;
      szp8(res);
      return res;
    }

    function sub16(a, b, c) {
      var t = a - b - c, res = t & 0xFFFF;
      cf = t < 0 ? 1 : 0;
      af = ((a ^ b ^ res) >> 4) & 1;
      of = (((a ^ b) & (a ^ res)) >> 15) & 1;
      szp16(res);
      return res;
    }

    function logic8(v) { cf = 0; of = 0; af = 0; szp8(v); return v; }
    function logic16(v) { cf = 0; of = 0; af = 0; szp16(v); return v; }

    // ADD OR ADC SBB AND SUB XOR CMP, selected by the 3-bit field in the opcode.
    function alu8(k, a, b) {
      switch (k) {
        case 0: return add8(a, b, 0);
        case 1: return logic8(a | b);
        case 2: return add8(a, b, cf);
        case 3: return sub8(a, b, cf);
        case 4: return logic8(a & b);
        case 5: return sub8(a, b, 0);
        case 6: return logic8(a ^ b);
        default: sub8(a, b, 0); return a;
      }
    }

    function alu16(k, a, b) {
      switch (k) {
        case 0: return add16(a, b, 0);
        case 1: return logic16(a | b);
        case 2: return add16(a, b, cf);
        case 3: return sub16(a, b, cf);
        case 4: return logic16(a & b);
        case 5: return sub16(a, b, 0);
        case 6: return logic16(a ^ b);
        default: sub16(a, b, 0); return a;
      }
    }

    // ROL ROR RCL RCR SHL SHR (SAL) SAR. The 8086 does not mask the count.
    function shift(k, v, n, w) {
      var top = w ? 15 : 7, mask = w ? 0xFFFF : 0xFF, c;
      if (n === 0) return v;
      for (var i = 0; i < n; i++) {
        switch (k) {
          case 0: c = v >> top; v = ((v << 1) | c) & mask; cf = c; of = (v >> top) ^ cf; break;
          case 1: c = v & 1; v = (v >> 1) | (c << top); cf = c; of = ((v >> top) ^ (v >> (top - 1))) & 1; break;
          case 2: c = v >> top; v = ((v << 1) | cf) & mask; cf = c; of = (v >> top) ^ cf; break;
          case 3: c = v & 1; v = (v >> 1) | (cf << top); cf = c; of = ((v >> top) ^ (v >> (top - 1))) & 1; break;
          case 4: case 6: cf = v >> top; v = (v << 1) & mask; of = (v >> top) ^ cf; break;
          case 5: cf = v & 1; of = v >> top; v >>= 1; break;
          case 7: cf = v & 1; v = (v >> 1) | (v & (1 << top)); of = 0; break;
        }
      }
      if (k >= 4) { af = 0; if (w) szp16(v); else szp8(v); }
      return v;
    }

    function getFlags() {
      return 0xF002 | cf | (pf << 2) | (af << 4) | (zf << 6) | (sf << 7) | (tf << 8) | (ifl << 9) | (df << 10) | (of << 11);
    }

    function setFlags(v) {
      cf = v & 1; pf = (v >> 2) & 1; af = (v >> 4) & 1; zf = (v >> 6) & 1; sf = (v >> 7) & 1;
      tf = (v >> 8) & 1; ifl = (v >> 9) & 1; df = (v >> 10) & 1; of = (v >> 11) & 1;
    }

    function cond(c) {
      var t;
      switch (c >> 1) {
        case 0: t = of; break;
        case 1: t = cf; break;
        case 2: t = zf; break;
        case 3: t = cf | zf; break;
        case 4: t = sf; break;
        case 5: t = pf; break;
        case 6: t = sf ^ of; break;
        default: t = (sf ^ of) | zf; break;
      }
      return (t ^ (c & 1)) === 1;
    }

    // --- interrupts and I/O -----------------------------------------------

    function interrupt(n) {
      if (io.interrupt && io.interrupt(n, self)) return;
      var v = n * 4, nip = rd16(v), ncs = rd16(v + 2);
      if (nip === 0 && ncs === 0) {
        throw fault(n === 0 ? 'Divide error' : 'Unhandled interrupt ' + hex(n, 2) + 'h');
      }
      push16(getFlags());
      push16(s[CS]);
      push16(ip);
      ifl = 0; tf = 0;
      s[CS] = ncs; ip = nip;
    }

    function inb(p) { return io.inb ? io.inb(p & 0xFFFF) & 0xFF : 0xFF; }
    function outb(p, v) { if (io.outb) io.outb(p & 0xFFFF, v & 0xFF); }

    // --- string instructions ----------------------------------------------

    function stringOp(op) {
      var w = op & 1, kind = op & 0xFE;
      var d = (df ? -1 : 1) * (w ? 2 : 1);
      var src = s[segOverride >= 0 ? segOverride : DS] << 4, dst = s[ES] << 4;
      var a, b, each = STRING_REP[(kind - 0xA4) >> 1];
      if (!rep) cycles += STRING_ONCE[(kind - 0xA4) >> 1];
      else if (resumed) resumed = false;
      else cycles += 9;
      if (rep && r[CX] === 0) return;
      for (;;) {
        switch (kind) {
          case 0xA4:
            if (w) wr16((dst + r[DI]) & 0xFFFFF, rd16((src + r[SI]) & 0xFFFFF));
            else wb((dst + r[DI]) & 0xFFFFF, rb((src + r[SI]) & 0xFFFFF));
            r[SI] += d; r[DI] += d;
            break;
          case 0xA6:
            if (w) sub16(rd16((src + r[SI]) & 0xFFFFF), rd16((dst + r[DI]) & 0xFFFFF), 0);
            else sub8(rb((src + r[SI]) & 0xFFFFF), rb((dst + r[DI]) & 0xFFFFF), 0);
            r[SI] += d; r[DI] += d;
            break;
          case 0xAA:
            if (w) wr16((dst + r[DI]) & 0xFFFFF, r[AX]);
            else wb((dst + r[DI]) & 0xFFFFF, r[AX] & 0xFF);
            r[DI] += d;
            break;
          case 0xAC:
            if (w) r[AX] = rd16((src + r[SI]) & 0xFFFFF);
            else s8(0, rb((src + r[SI]) & 0xFFFFF));
            r[SI] += d;
            break;
          default:   // 0xAE SCAS
            a = (dst + r[DI]) & 0xFFFFF;
            if (w) sub16(r[AX], rd16(a), 0);
            else sub8(r[AX] & 0xFF, rb(a), 0);
            r[DI] += d;
            break;
        }
        if (!rep) return;
        r[CX]--;
        cycles += each;
        if (kind === 0xA6 || kind === 0xAE) {
          b = rep === 0xF3 ? 1 : 0;   // REPE continues while ZF=1, REPNE while ZF=0
          if (zf !== b) return;
        }
        if (r[CX] === 0) return;
        // Out of time: leave IP on this instruction so it carries on from here, as an interrupted REP does.
        if (cycles >= limit) { ip = opIP; resumed = true; return; }
      }
    }

    // --- multiply / divide --------------------------------------------------

    function group3(w) {
      var v, t, n, d, q;
      modrm();
      v = w ? getRM16() : getRM8();
      if (reg < 2) cycles += mod === 3 ? 5 : 11;            // TEST r/m, imm
      else if (reg < 4) cycles += mod === 3 ? 3 : 16;       // NOT, NEG
      else if (mod !== 3) cycles += 6;                      // MUL IMUL DIV IDIV from memory
      switch (reg) {
        case 0: case 1:
          if (w) logic16(v & fetch16()); else logic8(v & fetch8());
          break;
        case 2:
          if (w) setRM16(~v & 0xFFFF); else setRM8(~v & 0xFF);
          break;
        case 3:
          if (w) setRM16(sub16(0, v, 0)); else setRM8(sub8(0, v, 0));
          break;
        case 4:
          cycles += w ? 118 + Math.min(15, bitCount(v)) : 70 + Math.min(7, bitCount(v));
          if (w) {
            t = r[AX] * v;
            r[AX] = t & 0xFFFF;
            r[DX] = Math.floor(t / 65536) & 0xFFFF;
            cf = of = r[DX] !== 0 ? 1 : 0;
          } else {
            r[AX] = (r[AX] & 0xFF) * v;
            cf = of = (r[AX] >> 8) !== 0 ? 1 : 0;
          }
          break;
        case 5:
          cycles += w ? 128 + Math.min(26, bitCount(v)) : 80 + Math.min(18, bitCount(v));
          if (w) {
            t = ((r[AX] << 16) >> 16) * ((v << 16) >> 16);
            r[AX] = t & 0xFFFF;
            r[DX] = (t >> 16) & 0xFFFF;
            cf = of = t !== ((t << 16) >> 16) ? 1 : 0;
          } else {
            t = (((r[AX] & 0xFF) << 24) >> 24) * ((v << 24) >> 24);
            r[AX] = t & 0xFFFF;
            cf = of = t !== ((t << 24) >> 24) ? 1 : 0;
          }
          break;
        case 6:
          if (v === 0) { interrupt(0); return; }
          if (w) {
            n = r[DX] * 65536 + r[AX];
            q = Math.floor(n / v);
            if (q > 0xFFFF) { interrupt(0); return; }
            cycles += 144 + Math.min(18, bitCount(q));
            r[AX] = q; r[DX] = n % v;
          } else {
            n = r[AX];
            q = Math.floor(n / v);
            if (q > 0xFF) { interrupt(0); return; }
            cycles += 80 + Math.min(10, bitCount(q));
            r[AX] = q | ((n % v) << 8);
          }
          break;
        default:
          if (w) {
            n = (r[DX] << 16) | r[AX];
            d = (v << 16) >> 16;
            if (d === 0) { interrupt(0); return; }
            q = Math.trunc(n / d);
            if (q > 32767 || q < -32768) { interrupt(0); return; }
            cycles += 165 + Math.min(19, bitCount(q & 0xFFFF));
            r[AX] = q & 0xFFFF; r[DX] = (n % d) & 0xFFFF;
          } else {
            n = (r[AX] << 16) >> 16;
            d = (v << 24) >> 24;
            if (d === 0) { interrupt(0); return; }
            q = Math.trunc(n / d);
            if (q > 127 || q < -128) { interrupt(0); return; }
            cycles += 101 + Math.min(11, bitCount(q & 0xFF));
            r[AX] = (q & 0xFF) | (((n % d) & 0xFF) << 8);
          }
          break;
      }
    }

    // --- one instruction ----------------------------------------------------

    function step() {
      var op, a, b, c, t, k, w;

      opCS = s[CS]; opIP = ip;
      segOverride = -1; rep = 0;
      for (;;) {
        op = fetch8();
        if ((op & 0xE7) === 0x26) { segOverride = (op >> 3) & 3; cycles += 2; }
        else if (op === 0xF2 || op === 0xF3) rep = op;
        else if (op === 0xF0) cycles += 2;
        else break;
      }
      curOp = op;
      cycles += CYCLES[op];

      // 00-3F: the eight ALU instructions in their six operand forms.
      if (op < 0x40 && (op & 7) < 6) {
        k = op >> 3;
        switch (op & 7) {
          case 0: modrm(); t = alu8(k, getRM8(), g8(reg)); if (k !== 7) setRM8(t); return;
          case 1: modrm(); t = alu16(k, getRM16(), r[reg]); if (k !== 7) setRM16(t); return;
          case 2: modrm(); t = alu8(k, g8(reg), getRM8()); if (k !== 7) s8(reg, t); return;
          case 3: modrm(); t = alu16(k, r[reg], getRM16()); if (k !== 7) r[reg] = t; return;
          case 4: t = alu8(k, r[AX] & 0xFF, fetch8()); if (k !== 7) s8(0, t); return;
          default: t = alu16(k, r[AX], fetch16()); if (k !== 7) r[AX] = t; return;
        }
      }

      switch (op) {
        case 0x06: case 0x0E: case 0x16: case 0x1E: push16(s[op >> 3]); return;
        case 0x07: case 0x17: case 0x1F: s[op >> 3] = pop16(); return;

        case 0x27:   // DAA
          a = r[AX] & 0xFF; c = cf; t = a;
          if ((a & 0x0F) > 9 || af) { t += 6; af = 1; } else af = 0;
          if (a > 0x99 || c) { t += 0x60; cf = 1; } else cf = 0;
          t &= 0xFF; s8(0, t); szp8(t);
          return;
        case 0x2F:   // DAS
          a = r[AX] & 0xFF; c = cf; t = a;
          if ((a & 0x0F) > 9 || af) { t -= 6; af = 1; } else af = 0;
          if (a > 0x99 || c) { t -= 0x60; cf = 1; } else cf = 0;
          t &= 0xFF; s8(0, t); szp8(t);
          return;
        case 0x37:   // AAA
          if ((r[AX] & 0x0F) > 9 || af) { r[AX] += 0x106; af = cf = 1; } else af = cf = 0;
          r[AX] &= 0xFF0F;
          return;
        case 0x3F:   // AAS
          if ((r[AX] & 0x0F) > 9 || af) { r[AX] -= 6; s8(4, g8(4) - 1); af = cf = 1; } else af = cf = 0;
          r[AX] &= 0xFF0F;
          return;

        case 0x40: case 0x41: case 0x42: case 0x43: case 0x44: case 0x45: case 0x46: case 0x47:
          c = cf; r[op & 7] = add16(r[op & 7], 1, 0); cf = c; return;
        case 0x48: case 0x49: case 0x4A: case 0x4B: case 0x4C: case 0x4D: case 0x4E: case 0x4F:
          c = cf; r[op & 7] = sub16(r[op & 7], 1, 0); cf = c; return;

        case 0x50: case 0x51: case 0x52: case 0x53: case 0x55: case 0x56: case 0x57:
          push16(r[op & 7]); return;
        case 0x54:   // PUSH SP stores the already-decremented value on an 8086
          r[SP] -= 2; wr16(((s[SS] << 4) + r[SP]) & 0xFFFFF, r[SP]); return;
        case 0x58: case 0x59: case 0x5A: case 0x5B: case 0x5C: case 0x5D: case 0x5E: case 0x5F:
          r[op & 7] = pop16(); return;

        case 0x70: case 0x71: case 0x72: case 0x73: case 0x74: case 0x75: case 0x76: case 0x77:
        case 0x78: case 0x79: case 0x7A: case 0x7B: case 0x7C: case 0x7D: case 0x7E: case 0x7F:
          t = fetchS8();
          if (cond(op & 15)) { ip = (ip + t) & 0xFFFF; cycles += 12; }
          return;

        case 0x80: case 0x82:
          modrm(); cycles += mod === 3 ? 4 : reg === 7 ? 10 : 17;
          a = getRM8(); t = alu8(reg, a, fetch8()); if (reg !== 7) setRM8(t); return;
        case 0x81:
          modrm(); cycles += mod === 3 ? 4 : reg === 7 ? 10 : 17;
          a = getRM16(); t = alu16(reg, a, fetch16()); if (reg !== 7) setRM16(t); return;
        case 0x83:
          modrm(); cycles += mod === 3 ? 4 : reg === 7 ? 10 : 17;
          a = getRM16(); t = alu16(reg, a, fetchS8() & 0xFFFF); if (reg !== 7) setRM16(t); return;

        case 0x84: modrm(); logic8(getRM8() & g8(reg)); return;
        case 0x85: modrm(); logic16(getRM16() & r[reg]); return;
        case 0x86: modrm(); t = getRM8(); setRM8(g8(reg)); s8(reg, t); return;
        case 0x87: modrm(); t = getRM16(); setRM16(r[reg]); r[reg] = t; return;
        case 0x88: modrm(); setRM8(g8(reg)); return;
        case 0x89: modrm(); setRM16(r[reg]); return;
        case 0x8A: modrm(); s8(reg, getRM8()); return;
        case 0x8B: modrm(); r[reg] = getRM16(); return;
        case 0x8C: modrm(); setRM16(s[reg & 3]); return;
        case 0x8D: modrm(); needMem('LEA'); r[reg] = eo; return;
        case 0x8E: modrm(); s[reg & 3] = getRM16(); return;
        case 0x8F: modrm(); setRM16(pop16()); return;

        case 0x90: return;
        case 0x91: case 0x92: case 0x93: case 0x94: case 0x95: case 0x96: case 0x97:
          t = r[AX]; r[AX] = r[op & 7]; r[op & 7] = t; return;
        case 0x98: r[AX] = ((r[AX] << 24) >> 24) & 0xFFFF; return;
        case 0x99: r[DX] = (r[AX] & 0x8000) ? 0xFFFF : 0; return;
        case 0x9A:
          a = fetch16(); b = fetch16();
          push16(s[CS]); push16(ip);
          s[CS] = b; ip = a;
          return;
        case 0x9B: return;   // WAIT
        case 0x9C: push16(getFlags()); return;
        case 0x9D: setFlags(pop16()); return;
        case 0x9E: setFlags((getFlags() & 0xFF00) | (r[AX] >> 8)); return;
        case 0x9F: s8(4, getFlags() & 0xFF); return;

        case 0xA0: s8(0, rb(((s[segOverride >= 0 ? segOverride : DS] << 4) + fetch16()) & 0xFFFFF)); return;
        case 0xA1: r[AX] = rd16(((s[segOverride >= 0 ? segOverride : DS] << 4) + fetch16()) & 0xFFFFF); return;
        case 0xA2: wb(((s[segOverride >= 0 ? segOverride : DS] << 4) + fetch16()) & 0xFFFFF, r[AX] & 0xFF); return;
        case 0xA3: wr16(((s[segOverride >= 0 ? segOverride : DS] << 4) + fetch16()) & 0xFFFFF, r[AX]); return;

        case 0xA4: case 0xA5: case 0xA6: case 0xA7:
        case 0xAA: case 0xAB: case 0xAC: case 0xAD: case 0xAE: case 0xAF:
          stringOp(op); return;

        case 0xA8: logic8(r[AX] & 0xFF & fetch8()); return;
        case 0xA9: logic16(r[AX] & fetch16()); return;

        case 0xB0: case 0xB1: case 0xB2: case 0xB3: case 0xB4: case 0xB5: case 0xB6: case 0xB7:
          s8(op & 7, fetch8()); return;
        case 0xB8: case 0xB9: case 0xBA: case 0xBB: case 0xBC: case 0xBD: case 0xBE: case 0xBF:
          r[op & 7] = fetch16(); return;

        case 0xC2: t = fetch16(); ip = pop16(); r[SP] += t; return;
        case 0xC3: ip = pop16(); return;
        case 0xC4: modrm(); needMem('LES'); r[reg] = rd16(ea); s[ES] = rd16((ea + 2) & 0xFFFFF); return;
        case 0xC5: modrm(); needMem('LDS'); r[reg] = rd16(ea); s[DS] = rd16((ea + 2) & 0xFFFFF); return;
        case 0xC6: modrm(); setRM8(fetch8()); return;
        case 0xC7: modrm(); setRM16(fetch16()); return;
        case 0xCA: t = fetch16(); ip = pop16(); s[CS] = pop16(); r[SP] += t; return;
        case 0xCB: ip = pop16(); s[CS] = pop16(); return;
        case 0xCC: interrupt(3); return;
        case 0xCD: interrupt(fetch8()); return;
        case 0xCE: if (of) { cycles += 49; interrupt(4); } return;
        case 0xCF: ip = pop16(); s[CS] = pop16(); setFlags(pop16()); return;

        case 0xD0: modrm(); setRM8(shift(reg, getRM8(), 1, 0)); return;
        case 0xD1: modrm(); setRM16(shift(reg, getRM16(), 1, 1)); return;
        case 0xD2: modrm(); cycles += 4 * (r[CX] & 0xFF); setRM8(shift(reg, getRM8(), r[CX] & 0xFF, 0)); return;
        case 0xD3: modrm(); cycles += 4 * (r[CX] & 0xFF); setRM16(shift(reg, getRM16(), r[CX] & 0xFF, 1)); return;
        case 0xD4:   // AAM
          b = fetch8();
          if (b === 0) { interrupt(0); return; }
          a = r[AX] & 0xFF;
          r[AX] = (Math.floor(a / b) << 8) | (a % b);
          szp8(r[AX] & 0xFF);
          return;
        case 0xD5:   // AAD
          b = fetch8();
          r[AX] = ((r[AX] & 0xFF) + (r[AX] >> 8) * b) & 0xFF;
          szp8(r[AX]);
          return;
        case 0xD6: s8(0, cf ? 0xFF : 0); return;   // SALC (undocumented but present on every 8086)
        case 0xD7: s8(0, rb(((s[segOverride >= 0 ? segOverride : DS] << 4) + ((r[BX] + (r[AX] & 0xFF)) & 0xFFFF)) & 0xFFFFF)); return;
        case 0xD8: case 0xD9: case 0xDA: case 0xDB: case 0xDC: case 0xDD: case 0xDE: case 0xDF:
          modrm(); return;   // ESC: no coprocessor fitted

        case 0xE0: t = fetchS8(); r[CX]--; if (r[CX] !== 0 && !zf) { ip = (ip + t) & 0xFFFF; cycles += 14; } return;
        case 0xE1: t = fetchS8(); r[CX]--; if (r[CX] !== 0 && zf) { ip = (ip + t) & 0xFFFF; cycles += 12; } return;
        case 0xE2: t = fetchS8(); r[CX]--; if (r[CX] !== 0) { ip = (ip + t) & 0xFFFF; cycles += 12; } return;
        case 0xE3: t = fetchS8(); if (r[CX] === 0) { ip = (ip + t) & 0xFFFF; cycles += 12; } return;

        case 0xE4: s8(0, inb(fetch8())); return;
        case 0xE5: a = fetch8(); r[AX] = inb(a) | (inb(a + 1) << 8); return;
        case 0xE6: outb(fetch8(), r[AX]); return;
        case 0xE7: a = fetch8(); outb(a, r[AX]); outb(a + 1, r[AX] >> 8); return;
        case 0xE8: t = fetch16(); push16(ip); ip = (ip + t) & 0xFFFF; return;
        case 0xE9: t = fetch16(); ip = (ip + t) & 0xFFFF; return;
        case 0xEA: a = fetch16(); b = fetch16(); s[CS] = b; ip = a; return;
        case 0xEB: t = fetchS8(); ip = (ip + t) & 0xFFFF; return;
        case 0xEC: s8(0, inb(r[DX])); return;
        case 0xED: r[AX] = inb(r[DX]) | (inb(r[DX] + 1) << 8); return;
        case 0xEE: outb(r[DX], r[AX]); return;
        case 0xEF: outb(r[DX], r[AX]); outb(r[DX] + 1, r[AX] >> 8); return;

        case 0xF4: self.halted = true; stop = true; return;
        case 0xF5: cf ^= 1; return;
        case 0xF6: group3(0); return;
        case 0xF7: group3(1); return;
        case 0xF8: cf = 0; return;
        case 0xF9: cf = 1; return;
        case 0xFA: ifl = 0; return;
        case 0xFB: ifl = 1; return;
        case 0xFC: df = 0; return;
        case 0xFD: df = 1; return;

        case 0xFE:
          modrm(); c = cf;
          cycles += mod === 3 ? 3 : 15;
          if (reg === 0) setRM8(add8(getRM8(), 1, 0));
          else if (reg === 1) setRM8(sub8(getRM8(), 1, 0));
          else throw fault('Invalid opcode FE /' + reg);
          cf = c;
          return;

        case 0xFF:
          modrm();
          switch (reg) {
            case 0: cycles += mod === 3 ? 3 : 15; c = cf; setRM16(add16(getRM16(), 1, 0)); cf = c; return;
            case 1: cycles += mod === 3 ? 3 : 15; c = cf; setRM16(sub16(getRM16(), 1, 0)); cf = c; return;
            case 2: cycles += mod === 3 ? 16 : 21; t = getRM16(); push16(ip); ip = t; return;
            case 3:
              needMem('CALL FAR'); cycles += 37;
              a = rd16(ea); b = rd16((ea + 2) & 0xFFFFF);
              push16(s[CS]); push16(ip);
              s[CS] = b; ip = a;
              return;
            case 4: cycles += mod === 3 ? 11 : 18; ip = getRM16(); return;
            case 5:
              needMem('JMP FAR'); cycles += 24;
              a = rd16(ea); b = rd16((ea + 2) & 0xFFFFF);
              s[CS] = b; ip = a;
              return;
            case 6:
              cycles += mod === 3 ? 11 : 16;
              t = getRM16();
              if (mod === 3 && rm === SP) t = (t - 2) & 0xFFFF;
              push16(t);
              return;
          }
          throw fault('Invalid opcode FF /7');
      }

      if ((op >= 0x60 && op <= 0x6F) || op === 0xC0 || op === 0xC1 || op === 0xC8 || op === 0xC9 || op === 0x0F) {
        throw fault('Opcode ' + hex(op, 2) + 'h is not an 8086 instruction (80186 or later)');
      }
      throw fault('Invalid opcode ' + hex(op, 2) + 'h');
    }

    // --- public interface -------------------------------------------------

    self.mem = mem;
    self.reg = r;        // AX CX DX BX SP BP SI DI
    self.seg = s;        // ES CS SS DS
    self.halted = false;

    self.getIP = function () { return ip; };
    self.setIP = function (v) { ip = v & 0xFFFF; };
    self.getFlags = getFlags;
    self.setFlags = setFlags;
    self.setCF = function (v) { cf = v ? 1 : 0; };
    self.setZF = function (v) { zf = v ? 1 : 0; };
    self.getCycles = function () { return cycles; };            // clock cycles since reset, idle time included
    self.getExecuted = function () { return cycles - idle; };   // clock cycles spent executing instructions
    self.read16 = rd16;
    self.write16 = wr16;
    self.push16 = push16;
    self.stop = function () { stop = true; };
    // Let time pass without executing anything (the host uses this to skip idle waits).
    self.skipTo = function (target) { if (cycles < target) { idle += target - cycles; cycles = target; } };
    self.step = step;
    // Route data access to A000:0000-FFFF through { read(offset), write(offset, byte) }; null for plain memory.
    self.setVideo = function (hook) { video = hook || null; };

    self.reset = function () {
      mem.fill(0);
      r.fill(0);
      s.fill(0);
      ip = 0;
      setFlags(0);
      cycles = 0; idle = 0; limit = Infinity; resumed = false;
      stop = false;
      video = null;
      self.halted = false;
    };

    // Run until `target` cycles have elapsed in total, or something calls stop().
    self.runUntil = function (target) {
      stop = false;
      limit = target;
      while (cycles < target && !stop) step();
      limit = Infinity;
    };
  }

  CPU8086.REG = { AX: AX, CX: CX, DX: DX, BX: BX, SP: SP, BP: BP, SI: SI, DI: DI };
  CPU8086.SEG = { ES: ES, CS: CS, SS: SS, DS: DS };
  CPU8086.hex = hex;

  if (typeof module !== 'undefined' && module.exports) module.exports = CPU8086;
  else root.CPU8086 = CPU8086;
})(typeof self !== 'undefined' ? self : this);
