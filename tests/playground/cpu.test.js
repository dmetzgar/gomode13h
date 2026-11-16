// Checks the 8086 core against independently written reference arithmetic.
// Run: node tests/playground/cpu.test.js
'use strict';
const CPU = require('../../static/playground/cpu8086.js');
const ASM = require('../../static/playground/asm8086.js');
const { AX, CX, DX, BX, SP, BP, SI, DI } = CPU.REG;
const { ES, CS, SS, DS } = CPU.SEG;

let failures = 0, checks = 0;
function eq(got, want, what) {
  checks++;
  if (got !== want) { failures++; if (failures < 30) console.log(`FAIL ${what}: got ${got}, want ${want}`); }
}

const cache = new Map();
function build(src) {
  if (!cache.has(src)) {
    const r = ASM.assemble('org 0x100\n' + src + '\nhlt\n');
    if (r.errors.length) throw new Error(src + ': ' + r.errors[0].message);
    cache.set(src, r.bytes);
  }
  return cache.get(src);
}

// Assemble and run a fragment; `init` may set registers/memory first. Returns the cpu.
function run(src, init, io) {
  const cpu = new CPU(io || {});
  cpu.reset();
  cpu.seg[CS] = cpu.seg[DS] = cpu.seg[ES] = cpu.seg[SS] = 0x1000;
  cpu.reg[SP] = 0xFFFE;
  cpu.mem.set(build(src), 0x10100);
  cpu.setIP(0x100);
  if (init) init(cpu);
  cpu.runUntil(cpu.getCycles() + 200000);
  if (!cpu.halted) throw new Error('did not halt: ' + src);
  return cpu;
}

const F = (cpu) => { const f = cpu.getFlags(); return { c: f & 1, p: (f >> 2) & 1, a: (f >> 4) & 1, z: (f >> 6) & 1, s: (f >> 7) & 1, o: (f >> 11) & 1 }; };
const parity = (v) => { let n = 0; for (let i = 0; i < 8; i++) n += (v >> i) & 1; return n % 2 === 0 ? 1 : 0; };
const signed = (v, bits) => (v & (1 << (bits - 1))) ? v - (1 << bits) : v;
let seed = 12345;
const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * n); };
const interesting = (bits) => { const m = (1 << bits) - 1, pick = [0, 1, 2, m, m - 1, 1 << (bits - 1), (1 << (bits - 1)) - 1, (1 << (bits - 1)) + 1, 0x0F, 0x10];
  return rnd(3) === 0 ? pick[rnd(pick.length)] & m : rnd(m + 1); };

// --- add / adc / sub / sbb / cmp / logic ------------------------------------
for (const bits of [8, 16]) {
  const mask = (1 << bits) - 1, ra = bits === 8 ? 'al' : 'ax', rb = bits === 8 ? 'bl' : 'bx';
  const lim = 1 << (bits - 1);
  for (let i = 0; i < 4000; i++) {
    const a = interesting(bits), b = interesting(bits), c = rnd(2);
    for (const op of ['add', 'adc', 'sub', 'sbb', 'cmp', 'and', 'or', 'xor', 'test']) {
      const cpu = run(`${op} ${ra}, ${rb}`, (k) => { k.reg[AX] = a; k.reg[BX] = b; k.setCF(c); });
      const got = cpu.reg[AX] & mask, f = F(cpu), tag = `${op}${bits} ${a},${b},cf=${c}`;
      let res, cf, of, af;
      if (op === 'add' || op === 'adc') {
        const cin = op === 'adc' ? c : 0, full = a + b + cin, sfull = signed(a, bits) + signed(b, bits) + cin;
        res = full & mask; cf = full > mask ? 1 : 0; of = (sfull >= lim || sfull < -lim) ? 1 : 0; af = ((a & 15) + (b & 15) + cin) > 15 ? 1 : 0;
      } else if (op === 'sub' || op === 'sbb' || op === 'cmp') {
        const cin = op === 'sbb' ? c : 0, sfull = signed(a, bits) - signed(b, bits) - cin;
        res = (a - b - cin) & mask; cf = a < b + cin ? 1 : 0; of = (sfull >= lim || sfull < -lim) ? 1 : 0; af = (a & 15) < (b & 15) + cin ? 1 : 0;
      } else {
        res = (op === 'or' ? a | b : op === 'xor' ? a ^ b : a & b); cf = 0; of = 0; af = null;
      }
      eq(got, (op === 'cmp' || op === 'test') ? a : res, tag + ' result');
      eq(f.c, cf, tag + ' CF'); eq(f.o, of, tag + ' OF'); eq(f.z, res === 0 ? 1 : 0, tag + ' ZF');
      eq(f.s, res >> (bits - 1), tag + ' SF'); eq(f.p, parity(res & 0xFF), tag + ' PF');
      if (af !== null) eq(f.a, af, tag + ' AF');
    }
    // inc / dec keep CF; neg
    for (const op of ['inc', 'dec', 'neg', 'not']) {
      const cpu = run(`${op} ${ra}`, (k) => { k.reg[AX] = a; k.setCF(c); });
      const got = cpu.reg[AX] & mask, f = F(cpu), tag = `${op}${bits} ${a}`;
      const res = (op === 'inc' ? a + 1 : op === 'dec' ? a - 1 : op === 'neg' ? -a : ~a) & mask;
      eq(got, res, tag);
      if (op === 'inc' || op === 'dec') { eq(f.c, c, tag + ' CF kept'); eq(f.o, (op === 'inc' ? a === lim - 1 : a === lim) ? 1 : 0, tag + ' OF'); eq(f.z, res === 0 ? 1 : 0, tag + ' ZF'); }
      if (op === 'neg') { eq(f.c, a !== 0 ? 1 : 0, tag + ' CF'); eq(f.o, a === lim ? 1 : 0, tag + ' OF'); }
    }
    // shifts and rotates, by 1 and by CL
    const n = rnd(bits + 2);
    for (const op of ['shl', 'shr', 'sar', 'rol', 'ror', 'rcl', 'rcr']) {
      for (const byCl of [false, true]) {
        const count = byCl ? n : 1;
        const cpu = run(`${op} ${ra}, ${byCl ? 'cl' : '1'}`, (k) => { k.reg[AX] = a; k.reg[CX] = n; k.setCF(c); });
        let v = a, carry = c;
        for (let j = 0; j < count; j++) {
          const msb = v >> (bits - 1), lsb = v & 1;
          if (op === 'shl') { carry = msb; v = (v << 1) & mask; }
          else if (op === 'shr') { carry = lsb; v = v >> 1; }
          else if (op === 'sar') { carry = lsb; v = (v >> 1) | (msb << (bits - 1)); }
          else if (op === 'rol') { carry = msb; v = ((v << 1) & mask) | msb; }
          else if (op === 'ror') { carry = lsb; v = (v >> 1) | (lsb << (bits - 1)); }
          else if (op === 'rcl') { v = ((v << 1) & mask) | carry; carry = msb; }
          else { v = (v >> 1) | (carry << (bits - 1)); carry = lsb; }
        }
        const tag = `${op}${bits} ${a} by ${count} cf=${c}`;
        eq(cpu.reg[AX] & mask, v, tag);
        eq(F(cpu).c, carry, tag + ' CF');
        if (count === 1) {
          const msbIn = a >> (bits - 1), msbOut = v >> (bits - 1);
          const of = op === 'shr' ? msbIn : op === 'sar' ? 0 : (op === 'shl' || op === 'rol' || op === 'rcl') ? msbOut ^ carry : msbOut ^ ((v >> (bits - 2)) & 1);
          eq(F(cpu).o, of, tag + ' OF');
        }
        if (count > 0 && /sh|sa/.test(op)) { eq(F(cpu).z, v === 0 ? 1 : 0, tag + ' ZF'); eq(F(cpu).s, v >> (bits - 1), tag + ' SF'); }
      }
    }
  }
}

// --- multiply / divide ---------------------------------------------------------
for (let i = 0; i < 6000; i++) {
  const a = interesting(16), b = interesting(16), d = interesting(16);
  let cpu = run('mul bx', (k) => { k.reg[AX] = a; k.reg[BX] = b; });
  eq(cpu.reg[DX] * 65536 + cpu.reg[AX], a * b, `mul16 ${a}*${b}`); eq(F(cpu).c, a * b > 0xFFFF ? 1 : 0, 'mul16 CF');
  cpu = run('imul bx', (k) => { k.reg[AX] = a; k.reg[BX] = b; });
  let p = signed(a, 16) * signed(b, 16);
  eq(signed(cpu.reg[DX], 16) * 65536 + cpu.reg[AX], p, `imul16 ${a}*${b}`); eq(F(cpu).o, (p > 32767 || p < -32768) ? 1 : 0, 'imul16 OF');
  cpu = run('mul bl', (k) => { k.reg[AX] = a; k.reg[BX] = b; });
  eq(cpu.reg[AX], (a & 0xFF) * (b & 0xFF), `mul8 ${a}*${b}`);
  cpu = run('imul bl', (k) => { k.reg[AX] = a; k.reg[BX] = b; });
  eq(cpu.reg[AX], (signed(a & 0xFF, 8) * signed(b & 0xFF, 8)) & 0xFFFF, `imul8 ${a}*${b}`);
  if (b !== 0) {
    const n = d * 65536 + a;
    if (Math.floor(n / b) <= 0xFFFF) {
      cpu = run('div bx', (k) => { k.reg[AX] = a; k.reg[DX] = d; k.reg[BX] = b; });
      eq(cpu.reg[AX], Math.floor(n / b), `div16 ${n}/${b}`); eq(cpu.reg[DX], n % b, `div16 rem ${n}/${b}`);
    }
    const sn = signed(d, 16) * 65536 + a, sb = signed(b, 16), q = Math.trunc(sn / sb);
    if (q <= 32767 && q >= -32768) {
      cpu = run('idiv bx', (k) => { k.reg[AX] = a; k.reg[DX] = d; k.reg[BX] = b; });
      eq(signed(cpu.reg[AX], 16), q, `idiv16 ${sn}/${sb}`); eq(signed(cpu.reg[DX], 16), sn - q * sb, `idiv16 rem ${sn}/${sb}`);
    }
  }
  const b8 = b & 0xFF;
  if (b8 !== 0) {
    if (Math.floor(a / b8) <= 0xFF) {
      cpu = run('div bl', (k) => { k.reg[AX] = a; k.reg[BX] = b; });
      eq(cpu.reg[AX], Math.floor(a / b8) | ((a % b8) << 8), `div8 ${a}/${b8}`);
    }
    const sa = signed(a, 16), sb = signed(b8, 8), q = Math.trunc(sa / sb);
    if (q <= 127 && q >= -128) {
      cpu = run('idiv bl', (k) => { k.reg[AX] = a; k.reg[BX] = b; });
      eq(cpu.reg[AX], (q & 0xFF) | (((sa - q * sb) & 0xFF) << 8), `idiv8 ${sa}/${sb}`);
    }
  }
}

// --- conditional jumps against real comparisons ------------------------------
const CC = { ja: (a, b) => a > b, jae: (a, b) => a >= b, jb: (a, b) => a < b, jbe: (a, b) => a <= b, je: (a, b) => a === b, jne: (a, b) => a !== b,
  jg: (a, b, s, t) => s > t, jge: (a, b, s, t) => s >= t, jl: (a, b, s, t) => s < t, jle: (a, b, s, t) => s <= t };
for (let i = 0; i < 3000; i++) {
  const a = interesting(16), b = interesting(16);
  for (const j of Object.keys(CC)) {
    const cpu = run(`cmp ax, bx\n mov cx, 0\n ${j} yes\n jmp done\nyes: mov cx, 1\ndone:`, (k) => { k.reg[AX] = a; k.reg[BX] = b; });
    eq(cpu.reg[CX], CC[j](a, b, signed(a, 16), signed(b, 16)) ? 1 : 0, `${j} ${a},${b}`);
  }
}

// --- everything else, as small programs with known answers ---------------------
function prog(name, src, check, init) { try { check(run(src, init)); } catch (e) { failures++; console.log('FAIL', name, e.message); } }
const m8 = (cpu, off) => cpu.mem[0x10000 + off], m16 = (cpu, off) => cpu.read16(0x10000 + off);

prog('stack', 'mov ax, 0x1234\n push ax\n mov bx, sp\n pop cx\n push sp\n pop dx', (c) => {
  eq(c.reg[CX], 0x1234, 'pop'); eq(c.reg[BX], 0xFFFC, 'sp after push'); eq(c.reg[DX], 0xFFFC, 'push sp pushes the new sp on an 8086'); eq(c.reg[SP], 0xFFFE, 'sp restored'); });
prog('call/ret', 'mov ax, 1\n call f\n add ax, 100\n jmp e\nf: add ax, 10\n ret\ne:', (c) => eq(c.reg[AX], 111, 'call/ret'));
prog('ret n', 'mov ax, 7\n push ax\n push ax\n call f\n jmp e\nf: ret 4\ne:', (c) => eq(c.reg[SP], 0xFFFE, 'ret 4'));
prog('far call', 'call 0x1000:f\n jmp e\nf: mov ax, cs\n retf\ne:', (c) => { eq(c.reg[AX], 0x1000, 'far call cs'); eq(c.reg[SP], 0xFFFE, 'retf'); });
prog('indirect', 'mov bx, f\n call bx\n mov word [p], g\n call [p]\n mov word [p], h\n jmp [p]\nf: mov cx, 5\n ret\ng: mov dx, 6\n ret\nh: mov si, 7\n jmp e\np: dw 0\ne:', (c) => {
  eq(c.reg[CX], 5, 'call reg'); eq(c.reg[DX], 6, 'call [mem]'); eq(c.reg[SI], 7, 'jmp [mem]'); });
prog('far indirect', 'mov word [p], f\n mov [p+2], cs\n call far [p]\n jmp e\nf: mov ax, 0x55\n retf\np: dw 0, 0\ne:', (c) => eq(c.reg[AX], 0x55, 'call far [mem]'));
prog('rep movsb', 'mov si, src\n mov di, dst\n mov cx, 5\n cld\n rep movsb\n jmp e\nsrc: db 1,2,3,4,5\ndst: db 0,0,0,0,0,9\ne:', (c) => {
  const d = c.reg[DI] - 5; eq([0, 1, 2, 3, 4, 5].map((i) => m8(c, d + i)).join(), '1,2,3,4,5,9', 'movsb data'); eq(c.reg[CX], 0, 'cx'); });
prog('movsw backwards', 'mov si, src+2\n mov di, dst+2\n mov cx, 2\n std\n rep movsw\n cld\n jmp e\nsrc: dw 0x1111, 0x2222\ndst: dw 0, 0\ne:', (c) => {
  const d = (c.reg[DI] + 2) & 0xFFFF; eq(m16(c, d), 0x1111, 'movsw 0'); eq(m16(c, d + 2), 0x2222, 'movsw 1'); });
prog('rep stosw', 'mov di, buf\n mov ax, 0xABCD\n mov cx, 3\n cld\n rep stosw\n jmp e\nbuf: dw 0,0,0,0x7777\ne:', (c) => {
  const d = c.reg[DI] - 6; eq(m16(c, d), 0xABCD, 'stosw'); eq(m16(c, d + 4), 0xABCD, 'stosw last'); eq(m16(c, d + 6), 0x7777, 'stosw stops'); });
prog('rep with cx=0', 'mov di, buf\n mov al, 1\n mov cx, 0\n rep stosb\n jmp e\nbuf: db 9\ne:', (c) => eq(m8(c, c.reg[DI]), 9, 'rep cx=0 does nothing'));
prog('repe cmpsb', 'mov si, a\n mov di, b\n mov cx, 5\n cld\n repe cmpsb\n jmp e\na: db "abcXe"\nb: db "abcYe"\ne:', (c) => { eq(c.reg[CX], 1, 'cmpsb stops at mismatch'); eq(F(c).z, 0, 'cmpsb ZF'); eq(F(c).c, 1, "cmpsb CF ('X' < 'Y')"); });
prog('repne scasb', 'mov di, s\n mov al, "c"\n mov cx, 10\n cld\n repne scasb\n jmp e\ns: db "abcdef"\ne:', (c) => { eq(c.reg[CX], 7, 'scasb count'); eq(F(c).z, 1, 'scasb found'); });
prog('lodsb/lodsw', 'mov si, d\n cld\n lodsb\n mov bl, al\n lodsw\n jmp e\nd: db 0x11, 0x22, 0x33\ne:', (c) => { eq(c.reg[BX] & 0xFF, 0x11, 'lodsb'); eq(c.reg[AX], 0x3322, 'lodsw'); });
prog('segment override', 'mov ax, 0x2000\n mov es, ax\n mov di, 0x10\n mov byte [es:di], 0x5A\n mov al, [es:0x10]\n mov bx, 0x10\n es\n mov ah, [bx]', (c) => {
  eq(c.mem[0x20010], 0x5A, 'write through es'); eq(c.reg[AX], 0x5A5A, 'read through es'); });
prog('bp uses ss', 'mov ax, 0x3000\n mov ss, ax\n mov bp, 0x20\n mov word [bp+2], 0xBEEF\n mov ax, 0x1000\n mov ss, ax', (c) => eq(c.read16(0x30022), 0xBEEF, 'bp defaults to ss'));
prog('lea', 'mov bx, 0x100\n mov si, 0x20\n lea ax, [bx+si+5]\n lea dx, [0x1234]', (c) => { eq(c.reg[AX], 0x125, 'lea'); eq(c.reg[DX], 0x1234, 'lea direct'); });
prog('les/lds', 'les bx, [p]\n push ds\n lds si, [p]\n mov cx, ds\n pop ds\n jmp e\np: dw 0x1234, 0x5678\ne:', (c) => { eq(c.reg[BX], 0x1234, 'les off'); eq(c.seg[ES], 0x5678, 'les seg'); eq(c.reg[SI], 0x1234, 'lds off'); eq(c.reg[CX], 0x5678, 'lds seg'); });
prog('xchg', 'mov ax, 1\n mov bx, 2\n xchg ax, bx\n mov cl, 3\n mov ch, 4\n xchg cl, ch\n xchg [m], ax\n jmp e\nm: dw 9\ne:', (c) => { eq(c.reg[AX], 9, 'xchg mem'); eq(c.reg[BX], 1, 'xchg'); eq(c.reg[CX], 0x0304, 'xchg 8'); });
prog('cbw/cwd', 'mov al, 0x80\n cbw\n mov bx, ax\n cwd\n mov cx, dx\n mov ax, 0x7FFF\n cwd', (c) => { eq(c.reg[BX], 0xFF80, 'cbw'); eq(c.reg[CX], 0xFFFF, 'cwd neg'); eq(c.reg[DX], 0, 'cwd pos'); });
prog('xlat', 'mov bx, t\n mov al, 2\n xlatb\n jmp e\nt: db 10, 20, 30\ne:', (c) => eq(c.reg[AX] & 0xFF, 30, 'xlat'));
prog('loop', 'mov cx, 10\n xor ax, ax\nl: add ax, cx\n loop l', (c) => eq(c.reg[AX], 55, 'loop'));
prog('loopne/jcxz', 'mov cx, 10\n mov bx, 0\nl: inc bx\n cmp bx, 4\n loopne l\n mov dx, cx\n xor cx, cx\n jcxz z\n mov dx, 0xFF\nz:', (c) => { eq(c.reg[BX], 4, 'loopne stops on ZF'); eq(c.reg[DX], 6, 'loopne cx'); });
prog('pushf/popf/sahf/lahf', 'stc\n std\n pushf\n pop ax\n cld\n clc\n mov bx, ax\n mov ah, 0xD5\n sahf\n lahf', (c) => {
  eq(c.reg[BX] & 0x0401, 0x0401, 'pushf has CF and DF'); eq(c.reg[BX] & 0xF002, 0xF002, 'pushf fixed bits'); eq(c.reg[AX] >> 8, 0xD7, 'sahf/lahf'); });
prog('daa', 'mov al, 0x19\n add al, 0x28\n daa\n mov bl, al\n mov al, 0x99\n add al, 0x01\n daa', (c) => { eq(c.reg[BX] & 0xFF, 0x47, 'daa'); eq(c.reg[AX] & 0xFF, 0x00, 'daa wrap'); eq(F(c).c, 1, 'daa CF'); });
prog('das', 'mov al, 0x47\n sub al, 0x28\n das', (c) => eq(c.reg[AX] & 0xFF, 0x19, 'das'));
prog('aaa/aas', 'mov ax, 0x0009\n add al, 8\n aaa\n mov bx, ax\n mov ax, 0x0103\n sub al, 5\n aas', (c) => { eq(c.reg[BX], 0x0107, 'aaa'); eq(c.reg[AX], 0x0008, 'aas'); });
prog('aam/aad', 'mov al, 47\n aam\n mov bx, ax\n aad', (c) => { eq(c.reg[BX], 0x0407, 'aam'); eq(c.reg[AX], 47, 'aad'); });
prog('mov moffs', 'mov ax, 0x1234\n mov [v], ax\n mov al, 0x77\n mov [v+2], al\n mov bx, [v]\n mov cl, [v+2]\n jmp e\nv: dw 0\n db 0\ne:', (c) => { eq(c.reg[BX], 0x1234, 'moffs word'); eq(c.reg[CX] & 0xFF, 0x77, 'moffs byte'); });
prog('high/low bytes', 'mov ax, 0x1234\n mov bl, ah\n mov bh, al\n add ah, 1\n inc al', (c) => { eq(c.reg[BX], 0x3412, 'ah/al'); eq(c.reg[AX], 0x1335, 'byte ops'); });
prog('addressing modes', 'mov bx, t\n mov si, 2\n mov di, 4\n mov al, [bx+si]\n mov ah, [bx+di]\n mov cl, [bx+si+1]\n mov bp, t\n mov ch, [ds:bp+di+1]\n mov dl, [si+t]\n jmp e\nt: db 1,2,3,4,5,6\ne:', (c) => {
  eq(c.reg[AX], 0x0503, '[bx+si],[bx+di]'); eq(c.reg[CX], 0x0604, 'disp8'); eq(c.reg[DX] & 0xFF, 3, '[si+disp16]'); });
prog('test/neg/not', 'mov ax, 0x00F0\n test ax, 0x000F\n pushf\n pop bx\n not ax', (c) => { eq((c.reg[BX] >> 6) & 1, 1, 'test ZF'); eq(c.reg[AX], 0xFF0F, 'not'); });
prog('inc/dec memory', 'inc word [v]\n dec byte [v+2]\n jmp e\nv: dw 0xFFFF\n db 0\ne:', (c) => { eq(m16(c, 0x100 + 10), 0, 'inc word mem wraps'); eq(m8(c, 0x100 + 12), 0xFF, 'dec byte mem'); });
prog('int via IVT', 'xor ax, ax\n mov es, ax\n mov word [es:0x60*4], h\n mov [es:0x60*4+2], cs\n mov bx, 1\n int 0x60\n jmp e\nh: mov bx, 0x99\n iret\ne:', (c) => { eq(c.reg[BX], 0x99, 'int/iret'); eq(c.reg[SP], 0xFFFE, 'iret sp'); });
{
  let seen = [];
  const io = { outb: (p, v) => seen.push([p, v]), inb: (p) => (p === 0x60 ? 0x1C : 0xFF) };
  const c = run('mov dx, 0x3C8\n mov al, 5\n out dx, al\n out 0x42, al\n in al, 0x60\n mov bl, al\n mov ax, 0x1234\n out dx, ax', null, io);
  eq(JSON.stringify(seen), JSON.stringify([[0x3C8, 5], [0x42, 5], [0x3C8, 0x34], [0x3C9, 0x12]]), 'out'); eq(c.reg[BX] & 0xFF, 0x1C, 'in');
  let hit = null;
  run('mov ax, 0x13\n int 0x10', null, { interrupt: (n, cpu) => { hit = [n, cpu.reg[AX]]; return true; } });
  eq(JSON.stringify(hit), '[16,19]', 'host interrupt hook');
}
for (const [src, msg] of [['xor bx, bx\n div bx', /Divide error/], ['db 0x0F', /not an 8086/], ['db 0x60', /not an 8086/], ['int 0x77', /Unhandled interrupt 77h/]]) {
  let err = null;
  try { run(src); } catch (e) { err = e; }
  checks++;
  if (!err || !msg.test(err.message)) { failures++; console.log('FAIL expected fault', msg, 'from', JSON.stringify(src), 'got', err && err.message); }
}

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
