/*
 * A small NASM-style assembler for the 8086.
 *
 *   var result = ASM8086.assemble(source, { include: function (name) { return text; } });
 *   result.errors   [{ file, line, message }]   (empty on success)
 *   result.bytes    Uint8Array, flat binary
 *   result.origin   the ORG address
 *   result.lines    [{ addr, length, file, line }] in address order, for mapping IP back to source
 *   result.symbols  { name: value }
 *
 * Supported: labels and .local labels, EQU, ORG, DB/DW/DD, RESB/RESW, TIMES, %include,
 * $ and $$, expressions with + - * / % << >> & | ^ ~ and parentheses, numbers as
 * 123, 0x7B, 7Bh, 0b1111011, 1111011b and 'c'. Only 8086 instructions are accepted.
 */
(function (root) {
  'use strict';

  var REG16 = { ax: 0, cx: 1, dx: 2, bx: 3, sp: 4, bp: 5, si: 6, di: 7 };
  var REG8 = { al: 0, cl: 1, dl: 2, bl: 3, ah: 4, ch: 5, dh: 6, bh: 7 };
  var SREG = { es: 0, cs: 1, ss: 2, ds: 3 };
  var ALU = { add: 0, or: 1, adc: 2, sbb: 3, and: 4, sub: 5, xor: 6, cmp: 7 };
  var SHIFT = { rol: 0, ror: 1, rcl: 2, rcr: 3, shl: 4, sal: 4, shr: 5, sar: 7 };
  var GROUP3 = { not: 2, neg: 3, mul: 4, imul: 5, div: 6, idiv: 7 };
  var JCC = {
    jo: 0, jno: 1, jb: 2, jc: 2, jnae: 2, jnb: 3, jae: 3, jnc: 3, je: 4, jz: 4, jne: 5, jnz: 5,
    jbe: 6, jna: 6, ja: 7, jnbe: 7, js: 8, jns: 9, jp: 10, jpe: 10, jnp: 11, jpo: 11,
    jl: 12, jnge: 12, jge: 13, jnl: 13, jle: 14, jng: 14, jg: 15, jnle: 15
  };
  var LOOPS = { loopne: 0xE0, loopnz: 0xE0, loope: 0xE1, loopz: 0xE1, loop: 0xE2, jcxz: 0xE3 };
  var SIMPLE = {
    nop: [0x90], cbw: [0x98], cwd: [0x99], wait: [0x9B], fwait: [0x9B], pushf: [0x9C], popf: [0x9D],
    sahf: [0x9E], lahf: [0x9F], movsb: [0xA4], movsw: [0xA5], cmpsb: [0xA6], cmpsw: [0xA7],
    stosb: [0xAA], stosw: [0xAB], lodsb: [0xAC], lodsw: [0xAD], scasb: [0xAE], scasw: [0xAF],
    xlat: [0xD7], xlatb: [0xD7], daa: [0x27], das: [0x2F], aaa: [0x37], aas: [0x3F],
    aam: [0xD4, 0x0A], aad: [0xD5, 0x0A], into: [0xCE], iret: [0xCF], hlt: [0xF4], cmc: [0xF5],
    clc: [0xF8], stc: [0xF9], cli: [0xFA], sti: [0xFB], cld: [0xFC], std: [0xFD], salc: [0xD6]
  };
  var PREFIX = { rep: 0xF3, repe: 0xF3, repz: 0xF3, repne: 0xF2, repnz: 0xF2, lock: 0xF0 };
  var SEG_PREFIX = [0x26, 0x2E, 0x36, 0x3E];
  var LATER_CPU = {
    pusha: 1, popa: 1, enter: 1, leave: 1, bound: 1, insb: 1, insw: 1, outsb: 1, outsw: 1,
    movzx: 1, movsx: 1, pushad: 1, popad: 1, bt: 1, bsf: 1, bsr: 1, shld: 1, shrd: 1, cdq: 1,
    cwde: 1, lodsd: 1, stosd: 1, movsd: 1, pushfd: 1, popfd: 1, iretd: 1, jecxz: 1, setz: 1, setnz: 1
  };
  var DIRECTIVES = { db: 1, dw: 1, dd: 1, resb: 1, resw: 1, times: 1, equ: 1, org: 1, bits: 1, cpu: 1, section: 1, segment: 1, use16: 1, global: 1, extern: 1, align: 1 };

  function AsmError(message) { this.message = message; }

  function isMnemonic(word) {
    return word in ALU || word in SHIFT || word in GROUP3 || word in JCC || word in LOOPS || word in SIMPLE ||
      word in PREFIX || word in LATER_CPU || word in DIRECTIVES ||
      /^(mov|test|xchg|inc|dec|push|pop|lea|les|lds|jmp|call|ret|retn|retf|int|int3|in|out)$/.test(word);
  }

  function fitsS8(v) { v &= 0xFFFF; return v < 0x80 || v >= 0xFF80; }

  // --- source text helpers ------------------------------------------------

  function stripComment(text) {
    var quote = null;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (quote) { if (ch === quote) quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ';') return text.slice(0, i);
    }
    return text;
  }

  // Split on a separator character at the top level (outside quotes, brackets and parentheses).
  function splitTop(text, sep) {
    var parts = [], depth = 0, quote = null, start = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (quote) { if (ch === quote) quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === sep && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    parts.push(text.slice(start));
    return parts.map(function (p) { return p.trim(); });
  }

  // --- expressions --------------------------------------------------------

  // Returns { v, pure }. `pure` means the value does not move when code moves: it is a plain
  // constant, or labels cancel out (as in `$ - start`). Internally each value carries `rel`,
  // the net number of addresses added into it; anything but + and - on an address poisons it.
  function evaluate(text, ctx) {
    var pos = 0;

    function peek() {
      while (pos < text.length && /\s/.test(text.charAt(pos))) pos++;
      return text.charAt(pos);
    }

    function num(v) { return { v: v, rel: 0 }; }
    function mix(a, b, v) { return { v: v, rel: a.rel === 0 && b.rel === 0 ? 0 : NaN }; }

    function primary() {
      var ch = peek(), m, rest = text.slice(pos), v, sym;
      if (ch === '(') {
        pos++;
        v = or();
        if (peek() !== ')') throw new AsmError('Missing ) in "' + text.trim() + '"');
        pos++;
        return v;
      }
      if (ch === "'" || ch === '"') {
        m = /^(['"])(.*?)\1/.exec(rest);
        if (!m || m[2].length < 1 || m[2].length > 2) throw new AsmError('Bad character constant in "' + text.trim() + '"');
        pos += m[0].length;
        return num(m[2].charCodeAt(0) | (m[2].length > 1 ? m[2].charCodeAt(1) << 8 : 0));
      }
      if ((m = /^0[xX]([0-9a-fA-F]+)\b/.exec(rest))) { pos += m[0].length; return num(parseInt(m[1], 16)); }
      if ((m = /^([0-9][0-9a-fA-F]*)[hH]\b/.exec(rest))) { pos += m[0].length; return num(parseInt(m[1], 16)); }
      if ((m = /^0[bB]([01]+)\b/.exec(rest))) { pos += m[0].length; return num(parseInt(m[1], 2)); }
      if ((m = /^([01]+)[bB]\b/.exec(rest))) { pos += m[0].length; return num(parseInt(m[1], 2)); }
      if ((m = /^[0-9]+\b/.exec(rest))) { pos += m[0].length; return num(parseInt(m[0], 10)); }
      if ((m = /^\$\$/.exec(rest))) { pos += 2; return { v: ctx.origin, rel: 1 }; }
      if (ch === '$' && !/^\$[\w.]/.test(rest)) { pos++; return { v: ctx.here, rel: 1 }; }
      if ((m = /^[A-Za-z_.?@$][\w.?@$]*/.exec(rest))) {
        pos += m[0].length;
        sym = ctx.lookup(m[0]);
        if (!sym) {
          if (m[0].toLowerCase() in REG16 || m[0].toLowerCase() in REG8 || m[0].toLowerCase() in SREG) {
            throw new AsmError('Register "' + m[0] + '" cannot be used here');
          }
          if (ctx.final) throw new AsmError('Undefined symbol "' + m[0] + '"');
          return { v: 0, rel: NaN };
        }
        return { v: sym.v, rel: sym.rel };
      }
      throw new AsmError(rest.trim() === '' ? 'Expression expected' : 'Cannot understand "' + rest.trim() + '"');
    }

    function unary() {
      var ch = peek(), a;
      if (ch === '-') { pos++; a = unary(); return { v: -a.v, rel: -a.rel }; }
      if (ch === '+') { pos++; return unary(); }
      if (ch === '~') { pos++; a = unary(); return mix(a, a, ~a.v); }
      return primary();
    }

    function mul() {
      var a = unary(), ch, b;
      for (;;) {
        ch = peek();
        if (ch === '*') { pos++; b = unary(); a = mix(a, b, a.v * b.v); }
        else if (ch === '/' || ch === '%') {
          pos++;
          if (text.charAt(pos) === ch) pos++;   // NASM's // and %% (signed) behave the same for our purposes
          b = unary();
          if (b.v === 0) { if (ctx.final) throw new AsmError('Division by zero'); b = num(1); }
          a = mix(a, b, ch === '/' ? Math.trunc(a.v / b.v) : a.v % b.v);
        } else return a;
      }
    }

    function add() {
      var a = mul(), ch, b;
      for (;;) {
        ch = peek();
        if (ch === '+') { pos++; b = mul(); a = { v: a.v + b.v, rel: a.rel + b.rel }; }
        else if (ch === '-') { pos++; b = mul(); a = { v: a.v - b.v, rel: a.rel - b.rel }; }
        else return a;
      }
    }

    function shift() {
      var a = add(), two, b;
      for (;;) {
        peek();
        two = text.substr(pos, 2);
        if (two === '<<') { pos += 2; b = add(); a = mix(a, b, a.v << b.v); }
        else if (two === '>>') { pos += 2; b = add(); a = mix(a, b, a.v >>> b.v); }
        else return a;
      }
    }

    function and() { var a = shift(), b; while (peek() === '&') { pos++; b = shift(); a = mix(a, b, a.v & b.v); } return a; }
    function xor() { var a = and(), b; while (peek() === '^') { pos++; b = and(); a = mix(a, b, a.v ^ b.v); } return a; }
    function or() { var a = xor(), b; while (peek() === '|') { pos++; b = xor(); a = mix(a, b, a.v | b.v); } return a; }

    var value = or();
    if (peek() !== '') throw new AsmError('Unexpected "' + text.slice(pos).trim() + '"');
    return { v: value.v, pure: value.rel === 0, rel: value.rel };
  }

  // --- operands -----------------------------------------------------------

  var RM_BY_REGS = { 'bx+si': 0, 'bx+di': 1, 'bp+si': 2, 'bp+di': 3, si: 4, di: 5, bp: 6, bx: 7 };

  function parseMemory(inner, ctx) {
    var seg = -1, m, regs = [], disp = '', terms, i, t, sign, name, key, value;
    if ((m = /^\s*(es|cs|ss|ds)\s*:/i.exec(inner))) { seg = SREG[m[1].toLowerCase()]; inner = inner.slice(m[0].length); }

    // Break into signed terms so the registers can be pulled out of the displacement.
    terms = [];
    var depth = 0, start = 0, cur = '+';
    for (i = 0; i < inner.length; i++) {
      t = inner.charAt(i);
      if (t === '(') depth++;
      else if (t === ')') depth--;
      else if ((t === '+' || t === '-') && depth === 0 && inner.slice(start, i).trim() !== '') {
        terms.push({ sign: cur, text: inner.slice(start, i).trim() });
        cur = t; start = i + 1;
      }
    }
    terms.push({ sign: cur, text: inner.slice(start).trim() });

    for (i = 0; i < terms.length; i++) {
      sign = terms[i].sign; name = terms[i].text.toLowerCase();
      if (name in REG16 || name in REG8 || name in SREG) {
        if (sign === '-' || !/^(bx|bp|si|di)$/.test(name)) {
          throw new AsmError('The 8086 can only address memory through BX, BP, SI and DI (not "' + terms[i].text + '")');
        }
        regs.push(name);
      } else {
        disp += sign + '(' + terms[i].text + ')';
      }
    }

    value = disp === '' ? { v: 0, pure: true } : evaluate(disp, ctx);
    if (regs.length === 0) {
      if (disp === '') throw new AsmError('Empty memory operand');
      return { kind: 'mem', size: 0, direct: true, disp: value, seg: seg };
    }
    key = regs.slice().sort(function (a, b) { return (a < b ? -1 : 1); });
    // Canonical order is base (bx/bp) then index (si/di).
    key = key.sort(function (a, b) { return (/^b/.test(a) ? 0 : 1) - (/^b/.test(b) ? 0 : 1); }).join('+');
    if (!(key in RM_BY_REGS)) throw new AsmError('"' + regs.join('+') + '" is not a valid 8086 addressing mode');
    return { kind: 'mem', size: 0, direct: false, rm: RM_BY_REGS[key], disp: value, hasDisp: disp !== '', seg: seg };
  }

  function parseOperand(text, ctx) {
    var size = 0, jump = null, m, lower, op, parts, v;
    for (;;) {
      m = /^(byte|word|dword|short|near|far|ptr)\b\s*/i.exec(text);
      if (!m) break;
      lower = m[1].toLowerCase();
      if (lower === 'byte') size = 8;
      else if (lower === 'word') size = 16;
      else if (lower === 'dword') size = 32;
      else if (lower !== 'ptr') jump = lower;
      text = text.slice(m[0].length);
    }
    lower = text.toLowerCase();
    if (lower in REG16) return { kind: 'reg', size: 16, n: REG16[lower], jump: jump };
    if (lower in REG8) return { kind: 'reg', size: 8, n: REG8[lower] };
    if (lower in SREG) return { kind: 'sreg', n: SREG[lower] };

    // MASM-style es:[di] is accepted alongside NASM's [es:di].
    if ((m = /^(es|cs|ss|ds)\s*:\s*\[(.*)\]$/i.exec(text))) text = '[' + m[1] + ':' + m[2] + ']';
    if (text.charAt(0) === '[') {
      if (text.charAt(text.length - 1) !== ']') throw new AsmError('Missing ] in "' + text + '"');
      op = parseMemory(text.slice(1, -1), ctx);
      op.size = size; op.jump = jump;
      return op;
    }

    parts = splitTop(text, ':');
    if (parts.length === 2) {
      return { kind: 'farptr', seg: evaluate(parts[0], ctx).v, off: evaluate(parts[1], ctx).v };
    }
    v = evaluate(text, ctx);
    return { kind: 'imm', v: v.v, pure: v.pure, size: size, jump: jump };
  }

  function isAcc(op) { return op.kind === 'reg' && op.n === 0; }

  // --- instruction encoding -----------------------------------------------

  function lo(v) { return v & 0xFF; }
  function hi(v) { return (v >> 8) & 0xFF; }

  function checkByte(v, ctx) {
    if (ctx.final && (v < -128 || v > 255)) throw new AsmError('Value ' + v + ' does not fit in a byte');
    return [lo(v)];
  }

  function checkWord(v, ctx) {
    if (ctx.final && (v < -32768 || v > 65535)) throw new AsmError('Value ' + v + ' does not fit in a word');
    return [lo(v), hi(v)];
  }

  // opcode bytes + ModR/M for a register or memory operand, with any segment prefix in front.
  function withRM(opcode, regField, rmOp, ctx) {
    var out = [], d;
    if (rmOp.kind === 'reg') return opcode.concat([0xC0 | (regField << 3) | rmOp.n]);
    if (rmOp.seg >= 0) out.push(SEG_PREFIX[rmOp.seg]);
    out = out.concat(opcode);
    d = rmOp.disp.v & 0xFFFF;
    if (rmOp.direct) out.push((regField << 3) | 6, lo(d), hi(d));
    else if (rmOp.disp.pure && ctx.pick(d === 0 && rmOp.rm !== 6)) out.push((regField << 3) | rmOp.rm);
    else if (rmOp.disp.pure && ctx.pick(fitsS8(d))) out.push(0x40 | (regField << 3) | rmOp.rm, lo(d));
    else out.push(0x80 | (regField << 3) | rmOp.rm, lo(d), hi(d));
    return out;
  }

  function isRM(op) { return op.kind === 'reg' || op.kind === 'mem'; }

  // Work out the operand width (8 or 16) shared by two operands.
  function width(a, b) {
    var sa = a.kind === 'reg' || a.kind === 'mem' || a.kind === 'imm' ? a.size : 0;
    var sb = b ? (b.kind === 'reg' || b.kind === 'mem' ? b.size : 0) : 0;
    if (a.kind === 'imm') sa = 0;
    if (sa && sb && sa !== sb) throw new AsmError('Operand sizes do not match');
    if (!sa && !sb && b && b.kind === 'imm' && b.size) return b.size;
    if (!sa && !sb) throw new AsmError('Operand size not specified: add "byte" or "word"');
    if ((sa || sb) === 32) throw new AsmError('The 8086 has no 32-bit operands');
    return sa || sb;
  }

  function need(ops, n, mn) {
    if (ops.length !== n) throw new AsmError(mn + ' takes ' + n + ' operand' + (n === 1 ? '' : 's'));
  }

  function encode(mn, ops, ctx) {
    var a = ops[0], b = ops[1], w, k, target, rel, here;

    if (mn in SIMPLE) {
      if (ops.length && !((mn === 'aam' || mn === 'aad') && a.kind === 'imm')) throw new AsmError(mn + ' takes no operands');
      if (ops.length) return [SIMPLE[mn][0]].concat(checkByte(a.v, ctx));
      return SIMPLE[mn];
    }

    if (mn in ALU) {
      need(ops, 2, mn); k = ALU[mn];
      if (b.kind === 'imm') {
        if (!isRM(a)) throw new AsmError('Bad destination for ' + mn);
        w = width(a, b);
        if (w === 8) return isAcc(a) ? [k * 8 + 4].concat(checkByte(b.v, ctx)) : withRM([0x80], k, a, ctx).concat(checkByte(b.v, ctx));
        if (b.pure && ctx.pick(fitsS8(b.v))) return withRM([0x83], k, a, ctx).concat([lo(b.v)]);
        return isAcc(a) ? [k * 8 + 5].concat(checkWord(b.v, ctx)) : withRM([0x81], k, a, ctx).concat(checkWord(b.v, ctx));
      }
      if (b.kind === 'reg' && isRM(a)) { w = width(a, b); return withRM([k * 8 + (w === 16 ? 1 : 0)], b.n, a, ctx); }
      if (a.kind === 'reg' && b.kind === 'mem') { w = width(a, b); return withRM([k * 8 + 2 + (w === 16 ? 1 : 0)], a.n, b, ctx); }
      throw new AsmError('Bad operands for ' + mn);
    }

    if (mn in SHIFT) {
      need(ops, 2, mn); k = SHIFT[mn];
      if (!isRM(a)) throw new AsmError('Bad destination for ' + mn);
      w = width(a) === 16 ? 1 : 0;
      if (b.kind === 'reg' && b.size === 8 && b.n === 1) return withRM([0xD2 + w], k, a, ctx);
      if (b.kind === 'imm' && b.pure && b.v === 1) return withRM([0xD0 + w], k, a, ctx);
      throw new AsmError('The 8086 can only shift by 1 or by CL (load the count into CL first)');
    }

    if (mn in GROUP3) {
      if (mn === 'imul' && ops.length > 1) throw new AsmError('The 8086 only has the one-operand form of imul');
      need(ops, 1, mn);
      if (!isRM(a)) throw new AsmError('Bad operand for ' + mn);
      return withRM([0xF6 + (width(a) === 16 ? 1 : 0)], GROUP3[mn], a, ctx);
    }

    if (mn in JCC || mn in LOOPS) {
      need(ops, 1, mn);
      if (a.kind !== 'imm') throw new AsmError(mn + ' needs a label');
      rel = a.v - (ctx.here + 2);
      if (ctx.final && (rel < -128 || rel > 127)) {
        throw new AsmError(mn + ' target is out of range: 8086 conditional jumps only reach -128..+127 bytes. Invert the condition and use jmp');
      }
      return [mn in JCC ? 0x70 + JCC[mn] : LOOPS[mn], lo(rel)];
    }

    switch (mn) {
      case 'mov':
        need(ops, 2, mn);
        if (a.kind === 'sreg') {
          if (!isRM(b) || b.size === 8) throw new AsmError('A segment register can only be loaded from a 16-bit register or memory');
          if (a.n === 1) throw new AsmError('CS cannot be loaded with mov');
          return withRM([0x8E], a.n, b, ctx);
        }
        if (b.kind === 'sreg') {
          if (!isRM(a) || a.size === 8) throw new AsmError('A segment register can only be stored to a 16-bit register or memory');
          return withRM([0x8C], b.n, a, ctx);
        }
        if (b.kind === 'imm') {
          if (a.kind === 'reg') return a.size === 8 ? [0xB0 + a.n].concat(checkByte(b.v, ctx)) : [0xB8 + a.n].concat(checkWord(b.v, ctx));
          if (a.kind !== 'mem') throw new AsmError('Bad destination for mov');
          w = width(a, b);
          return w === 8 ? withRM([0xC6], 0, a, ctx).concat(checkByte(b.v, ctx)) : withRM([0xC7], 0, a, ctx).concat(checkWord(b.v, ctx));
        }
        if (isAcc(a) && b.kind === 'mem' && b.direct) {
          width(a, b);
          return (b.seg >= 0 ? [SEG_PREFIX[b.seg]] : []).concat([a.size === 8 ? 0xA0 : 0xA1, lo(b.disp.v), hi(b.disp.v)]);
        }
        if (isAcc(b) && a.kind === 'mem' && a.direct) {
          width(a, b);
          return (a.seg >= 0 ? [SEG_PREFIX[a.seg]] : []).concat([b.size === 8 ? 0xA2 : 0xA3, lo(a.disp.v), hi(a.disp.v)]);
        }
        if (b.kind === 'reg' && isRM(a)) { w = width(a, b); return withRM([0x88 + (w === 16 ? 1 : 0)], b.n, a, ctx); }
        if (a.kind === 'reg' && b.kind === 'mem') { w = width(a, b); return withRM([0x8A + (w === 16 ? 1 : 0)], a.n, b, ctx); }
        throw new AsmError('Bad operands for mov');

      case 'test':
        need(ops, 2, mn);
        if (b.kind === 'imm') {
          if (!isRM(a)) throw new AsmError('Bad operands for test');
          w = width(a, b);
          if (isAcc(a)) return w === 8 ? [0xA8].concat(checkByte(b.v, ctx)) : [0xA9].concat(checkWord(b.v, ctx));
          return w === 8 ? withRM([0xF6], 0, a, ctx).concat(checkByte(b.v, ctx)) : withRM([0xF7], 0, a, ctx).concat(checkWord(b.v, ctx));
        }
        if (b.kind === 'reg' && isRM(a)) { w = width(a, b); return withRM([0x84 + (w === 16 ? 1 : 0)], b.n, a, ctx); }
        if (a.kind === 'reg' && b.kind === 'mem') { w = width(a, b); return withRM([0x84 + (w === 16 ? 1 : 0)], a.n, b, ctx); }
        throw new AsmError('Bad operands for test');

      case 'xchg':
        need(ops, 2, mn);
        if (a.kind === 'reg' && b.kind === 'reg') {
          w = width(a, b);
          if (w === 16 && a.n === 0) return [0x90 + b.n];
          if (w === 16 && b.n === 0) return [0x90 + a.n];
          return withRM([0x86 + (w === 16 ? 1 : 0)], a.n, b, ctx);
        }
        if (a.kind === 'reg' && b.kind === 'mem') { w = width(a, b); return withRM([0x86 + (w === 16 ? 1 : 0)], a.n, b, ctx); }
        if (b.kind === 'reg' && a.kind === 'mem') { w = width(a, b); return withRM([0x86 + (w === 16 ? 1 : 0)], b.n, a, ctx); }
        throw new AsmError('Bad operands for xchg');

      case 'inc': case 'dec':
        need(ops, 1, mn); k = mn === 'inc' ? 0 : 1;
        if (!isRM(a)) throw new AsmError('Bad operand for ' + mn);
        if (a.kind === 'reg' && a.size === 16) return [0x40 + k * 8 + a.n];
        return withRM([0xFE + (width(a) === 16 ? 1 : 0)], k, a, ctx);

      case 'push':
        need(ops, 1, mn);
        if (a.kind === 'reg' && a.size === 16) return [0x50 + a.n];
        if (a.kind === 'sreg') return [0x06 + a.n * 8];
        if (a.kind === 'mem' && a.size !== 8) return withRM([0xFF], 6, a, ctx);
        if (a.kind === 'imm') throw new AsmError('The 8086 cannot push a constant (load it into a register first)');
        throw new AsmError('push needs a 16-bit register or memory operand');

      case 'pop':
        need(ops, 1, mn);
        if (a.kind === 'reg' && a.size === 16) return [0x58 + a.n];
        if (a.kind === 'sreg') {
          if (a.n === 1) throw new AsmError('CS cannot be popped');
          return [0x07 + a.n * 8];
        }
        if (a.kind === 'mem' && a.size !== 8) return withRM([0x8F], 0, a, ctx);
        throw new AsmError('pop needs a 16-bit register or memory operand');

      case 'lea': case 'les': case 'lds':
        need(ops, 2, mn);
        if (a.kind !== 'reg' || a.size !== 16 || b.kind !== 'mem') throw new AsmError(mn + ' needs a 16-bit register and a memory operand');
        return withRM([mn === 'lea' ? 0x8D : mn === 'les' ? 0xC4 : 0xC5], a.n, b, ctx);

      case 'jmp': case 'call':
        need(ops, 1, mn);
        if (a.kind === 'farptr') return [mn === 'jmp' ? 0xEA : 0x9A, lo(a.off), hi(a.off), lo(a.seg), hi(a.seg)];
        if (a.kind === 'reg' && a.size === 16) return withRM([0xFF], mn === 'jmp' ? 4 : 2, a, ctx);
        if (a.kind === 'mem') {
          if (a.size === 8) throw new AsmError(mn + ' needs a 16-bit operand');
          if (a.jump === 'far' || a.size === 32) return withRM([0xFF], mn === 'jmp' ? 5 : 3, a, ctx);
          return withRM([0xFF], mn === 'jmp' ? 4 : 2, a, ctx);
        }
        if (a.kind !== 'imm') throw new AsmError('Bad operand for ' + mn);
        here = ctx.here;
        if (mn === 'call') { rel = a.v - (here + 3); return [0xE8, lo(rel), hi(rel)]; }
        rel = a.v - (here + 2);
        if (a.jump === 'short') {
          if (ctx.final && (rel < -128 || rel > 127)) throw new AsmError('Short jump is out of range');
          return [0xEB, lo(rel)];
        }
        if (a.jump !== 'near' && ctx.pick(rel >= -128 && rel <= 127)) return [0xEB, lo(rel)];
        rel = a.v - (here + 3);
        return [0xE9, lo(rel), hi(rel)];

      case 'ret': case 'retn':
        if (ops.length === 0) return [0xC3];
        need(ops, 1, mn);
        return [0xC2].concat(checkWord(a.v, ctx));
      case 'retf':
        if (ops.length === 0) return [0xCB];
        need(ops, 1, mn);
        return [0xCA].concat(checkWord(a.v, ctx));

      case 'int3': return [0xCC];
      case 'int':
        need(ops, 1, mn);
        if (a.kind !== 'imm') throw new AsmError('int needs an interrupt number');
        return [0xCD].concat(checkByte(a.v, ctx));

      case 'in':
        need(ops, 2, mn);
        if (!isAcc(a)) throw new AsmError('in reads into AL or AX');
        w = a.size === 16 ? 1 : 0;
        if (b.kind === 'reg' && b.size === 16 && b.n === 2) return [0xEC + w];
        if (b.kind === 'imm') return [0xE4 + w].concat(checkByte(b.v, ctx));
        throw new AsmError('The port must be a constant below 256 or DX');
      case 'out':
        need(ops, 2, mn);
        if (!isAcc(b)) throw new AsmError('out writes AL or AX');
        w = b.size === 16 ? 1 : 0;
        if (a.kind === 'reg' && a.size === 16 && a.n === 2) return [0xEE + w];
        if (a.kind === 'imm') return [0xE6 + w].concat(checkByte(a.v, ctx));
        throw new AsmError('The port must be a constant below 256 or DX');
    }

    if (mn in LATER_CPU) throw new AsmError('"' + mn + '" needs an 80186 or later; this is an 8086');
    throw new AsmError('Unknown instruction "' + mn + '"');
  }

  // --- data directives ----------------------------------------------------

  function dataBytes(kind, args, ctx) {
    var out = [], unit = kind === 'db' ? 1 : kind === 'dw' ? 2 : 4;
    splitTop(args, ',').forEach(function (item) {
      var m, i, v;
      if (item === '') throw new AsmError('Missing value in ' + kind);
      m = /^(['"])(.*)\1$/.exec(item);
      if (m && (m[2].length !== 1 || kind === 'db') && m[2].indexOf(m[1]) < 0) {
        for (i = 0; i < m[2].length; i++) out.push(m[2].charCodeAt(i) & 0xFF);
        while (out.length % unit) out.push(0);
        return;
      }
      if (unit === 4 && splitTop(item, ':').length === 2) {
        m = splitTop(item, ':');
        v = evaluate(m[1], ctx).v; out.push(lo(v), hi(v));
        v = evaluate(m[0], ctx).v; out.push(lo(v), hi(v));
        return;
      }
      v = evaluate(item, ctx).v;
      if (unit === 1) out.push(checkByte(v, ctx)[0]);
      else if (unit === 2) out.push(lo(v), hi(v));
      else out.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF);
    });
    return out;
  }

  // --- the assembler ------------------------------------------------------

  function expandIncludes(source, file, include, out, depth, errors) {
    source.split(/\r?\n/).forEach(function (text, index) {
      var m = /^\s*%include\s+["']([^"']+)["']/i.exec(text), body;
      if (!m) { out.push({ file: file, line: index + 1, text: text }); return; }
      body = include ? include(m[1]) : null;
      if (body === null || body === undefined) errors.push({ file: file, line: index + 1, message: 'Cannot find include file "' + m[1] + '"' });
      else if (depth > 8) errors.push({ file: file, line: index + 1, message: 'Includes are nested too deeply' });
      else expandIncludes(body, m[1], include, out, depth + 1, errors);
    });
  }

  function assemble(source, options) {
    options = options || {};
    var errors = [], lines = [];
    expandIncludes(source, options.file || 'program', options.include, lines, 0, errors);
    if (errors.length) return { errors: errors };

    var symbols = {}, longForms = {}, slot = 0, grew = false;
    var out, origin, map, lastGlobal, lineIndex, final = false;

    var ctx = {
      origin: 0, here: 0, final: false,
      lookup: function (name) {
        if (name.charAt(0) === '.') name = lastGlobal + name;
        return Object.prototype.hasOwnProperty.call(symbols, name) ? symbols[name] : null;
      },
      // Choose between a short and a long encoding. Once a spot has needed the long form it
      // keeps it, so sizes only ever grow from pass 2 on and the passes must settle.
      pick: function (fits) {
        var key = lineIndex + ':' + (slot++);
        if (longForms[key]) return false;
        if (fits) return true;
        longForms[key] = true; grew = true;
        return false;
      }
    };

    function define(name, value, rel, pass) {
      var full = name.charAt(0) === '.' ? lastGlobal + name : name, old;
      if (name.charAt(0) !== '.') lastGlobal = name;
      old = symbols[full];
      if (old && old.pass === pass) throw new AsmError('Label "' + name + '" is defined more than once');
      if (!old || old.v !== value) grew = true;
      symbols[full] = { v: value, rel: rel, pass: pass };
    }

    function emit(bytes) { for (var i = 0; i < bytes.length; i++) out.push(bytes[i]); }

    function statement(text, pass) {
      var m, word, rest, label, count, i, ops, bytes;

      // Leading label, with or without a colon.
      m = /^([A-Za-z_.?@][\w.?@$]*)\s*(:?)\s*(.*)$/.exec(text);
      if (!m) throw new AsmError('Cannot understand "' + text + '"');
      if (m[2] === ':' || !isMnemonic(m[1].toLowerCase())) {
        if (m[2] !== ':' && (m[1].toLowerCase() in REG16 || m[1].toLowerCase() in REG8 || m[1].toLowerCase() in SREG) && !/^(es|cs|ss|ds)$/i.test(m[1])) {
          throw new AsmError('Cannot understand "' + text + '"');
        }
        if (m[2] !== ':' && /^(es|cs|ss|ds)$/i.test(m[1])) {
          emit([SEG_PREFIX[SREG[m[1].toLowerCase()]]]);   // segment override written as a prefix
          if (m[3]) statement(m[3], pass);
          return;
        }
        label = m[1]; text = m[3];
        if (m[2] !== ':' && text !== '' && !isMnemonic((/^[A-Za-z_]\w*/.exec(text) || [''])[0].toLowerCase())) {
          throw new AsmError('Unknown instruction "' + label + '"');
        }
        if (/^equ\b/i.test(text)) {
          m = evaluate(text.slice(3), ctx);
          define(label, m.v, m.rel, pass);
          return;
        }
        define(label, ctx.here, 1, pass);
        if (text === '') return;
      }

      m = /^([A-Za-z_][\w]*)\s*(.*)$/.exec(text);
      if (!m) throw new AsmError('Cannot understand "' + text + '"');
      word = m[1].toLowerCase(); rest = m[2];

      if (word in PREFIX) {
        emit([PREFIX[word]]);
        ctx.here = origin + out.length;
        if (rest) statement(rest, pass);
        return;
      }

      switch (word) {
        case 'org':
          if (out.length) throw new AsmError('org must come before any code or data');
          origin = evaluate(rest, ctx).v & 0xFFFF; ctx.origin = origin; ctx.here = origin;
          return;
        case 'bits': case 'use16':
          if (word === 'bits' && evaluate(rest, ctx).v !== 16) throw new AsmError('Only 16-bit code is supported');
          return;
        case 'cpu': case 'section': case 'segment': case 'global': case 'extern':
          return;
        case 'align':
          count = evaluate(rest, ctx).v;
          while (count > 0 && (origin + out.length) % count) out.push(0x90);
          return;
        case 'db': case 'dw': case 'dd':
          emit(dataBytes(word, rest, ctx));
          return;
        case 'resb': case 'resw':
          count = evaluate(rest, ctx).v * (word === 'resw' ? 2 : 1);
          if (count < 0 || count > 0x10000) throw new AsmError('Bad ' + word + ' count');
          for (i = 0; i < count; i++) out.push(0);
          return;
        case 'times':
          // The count is everything up to the first word that is an instruction or directive.
          ops = rest.split(/\s+/);
          for (i = 1; i < ops.length; i++) if (isMnemonic(ops[i].toLowerCase())) break;
          if (i >= ops.length) throw new AsmError('times needs a count and something to repeat');
          count = evaluate(ops.slice(0, i).join(' '), ctx).v;
          if (count < 0 || count > 0x10000) {
            if (ctx.final) throw new AsmError('Bad times count ' + count);
            count = 0;
          }
          rest = ops.slice(i).join(' ');
          for (i = 0; i < count; i++) { ctx.here = origin + out.length; statement(rest, pass); }
          return;
        case 'equ':
          throw new AsmError('equ needs a name in front of it');
      }

      ops = rest === '' ? [] : splitTop(rest, ',').map(function (t) {
        if (t === '') throw new AsmError('Missing operand');
        return parseOperand(t, ctx);
      });
      bytes = encode(word, ops, ctx);
      emit(bytes);
    }

    function runPass(pass) {
      out = []; origin = 0; map = []; lastGlobal = ''; grew = false;
      ctx.origin = 0; ctx.final = final;
      for (lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        var text = stripComment(lines[lineIndex].text).trim(), before = out.length;
        if (text === '') continue;
        ctx.here = origin + out.length; slot = 0;
        try {
          statement(text, pass);
        } catch (e) {
          if (!(e instanceof AsmError)) throw e;
          errors.push({ file: lines[lineIndex].file, line: lines[lineIndex].line, message: e.message });
          if (errors.length >= 20) return;
        }
        if (out.length > before) map.push({ addr: origin + before, length: out.length - before, file: lines[lineIndex].file, line: lines[lineIndex].line });
      }
      if (origin + out.length > 0x10000 && final) {
        errors.push({ file: lines[0].file, line: 1, message: 'Program is larger than 64K' });
      }
    }

    // Pass 1 learns the symbols. Later passes start with every jump short and grow the
    // ones that do not reach, until nothing moves; one more pass then reports errors.
    var pass = 1;
    runPass(pass);
    if (!errors.length) {
      longForms = {};
      for (pass = 2; pass < 40; pass++) {
        runPass(pass);
        if (errors.length || !grew) break;
      }
    }
    if (!errors.length) { final = true; runPass(pass + 1); }
    if (errors.length) return { errors: errors };

    var table = {};
    Object.keys(symbols).forEach(function (name) { table[name] = symbols[name].v; });
    return { errors: [], bytes: new Uint8Array(out), origin: origin, lines: map, symbols: table };
  }

  var ASM8086 = { assemble: assemble };
  if (typeof module !== 'undefined' && module.exports) module.exports = ASM8086;
  else root.ASM8086 = ASM8086;
})(typeof self !== 'undefined' ? self : this);
