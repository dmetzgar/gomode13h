// Compares the playground assembler's output with real NASM, one statement at a time.
// Run: node tests/playground/asm-vs-nasm.js   (skips if nasm is not installed)
'use strict';
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ASM = require('../../static/playground/asm8086.js');

if (spawnSync('nasm', ['-v']).status !== 0) { console.log('nasm not found, skipping'); process.exit(0); }

const R16 = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
const R8 = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'];
const MEM = ['[bx+si]', '[bx+di]', '[bp+si]', '[bp+di]', '[si]', '[di]', '[bp]', '[bx]', '[0x1234]', '[bx+5]', '[bp-3]',
  '[si+0x200]', '[bx+si+0x7f]', '[bx+si+0x80]', '[di-0x81]', '[es:di]', '[cs:0x10]', '[ss:bx+si+2]', '[ds:bp]', '[bp+0]', '[si+bx]', '[di+bp+1]'];
const cases = [];
const add = (s) => cases.push(s);

for (const op of ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp']) {
  add(`${op} ax, bx`); add(`${op} cl, dh`); add(`${op} al, 5`); add(`${op} ax, 5`); add(`${op} ax, 0x1234`); add(`${op} ax, -1`);
  add(`${op} bx, 1`); add(`${op} bx, 0x80`); add(`${op} bx, 0xff80`); add(`${op} bx, 300`); add(`${op} ch, 0x7f`); add(`${op} dl, -1`);
  for (const m of MEM) { add(`${op} ${m}, cx`); add(`${op} dx, ${m}`); add(`${op} ${m}, bl`); add(`${op} ah, ${m}`);
    add(`${op} byte ${m}, 7`); add(`${op} word ${m}, 7`); add(`${op} word ${m}, 0x777`); }
}
for (const m of MEM) { add(`mov ${m}, ax`); add(`mov ax, ${m}`); add(`mov ${m}, al`); add(`mov al, ${m}`); add(`mov ${m}, si`); add(`mov bh, ${m}`);
  add(`mov byte ${m}, 0x12`); add(`mov word ${m}, 0x1234`); add(`mov ${m}, es`); add(`mov ds, ${m}`); add(`lea di, ${m}`);
  add(`les bx, ${m}`); add(`lds si, ${m}`); add(`inc byte ${m}`); add(`dec word ${m}`); add(`push word ${m}`); add(`pop word ${m}`);
  add(`neg byte ${m}`); add(`not word ${m}`); add(`mul byte ${m}`); add(`imul word ${m}`); add(`div word ${m}`); add(`idiv byte ${m}`);
  add(`shl byte ${m}, 1`); add(`sar word ${m}, cl`); add(`test ${m}, dx`); add(`test byte ${m}, 3`); add(`test word ${m}, 0x300`);
  add(`xchg ${m}, cx`); add(`xchg bl, ${m}`); add(`jmp ${m}`); add(`call ${m}`); add(`jmp far ${m}`); add(`call far ${m}`); }
for (const r of R16) { add(`mov ${r}, 0x1234`); add(`mov ${r}, bx`); add(`mov si, ${r}`); add(`inc ${r}`); add(`dec ${r}`); add(`push ${r}`); add(`pop ${r}`);
  add(`xchg ax, ${r}`); add(`xchg ${r}, ax`); add(`xchg ${r}, dx`); add(`neg ${r}`); add(`shr ${r}, 1`); add(`rol ${r}, cl`); add(`jmp ${r}`); add(`call ${r}`);
  add(`mov es, ${r}`); add(`mov ${r}, ss`); add(`test ${r}, 0x55`); add(`test ${r}, bx`); add(`mul ${r}`); }
for (const r of R8) { add(`mov ${r}, 0x12`); add(`mov ${r}, cl`); add(`inc ${r}`); add(`dec ${r}`); add(`not ${r}`); add(`rcr ${r}, 1`); add(`ror ${r}, cl`);
  add(`xchg ${r}, bl`); add(`test ${r}, 1`); add(`test ${r}, ah`); add(`div ${r}`); }
for (const s of ['es', 'cs', 'ss', 'ds']) { add(`push ${s}`); if (s !== 'cs') add(`pop ${s}`); }
['nop', 'cbw', 'cwd', 'pushf', 'popf', 'sahf', 'lahf', 'movsb', 'movsw', 'cmpsb', 'cmpsw', 'stosb', 'stosw', 'lodsb', 'lodsw', 'scasb', 'scasw',
  'xlatb', 'daa', 'das', 'aaa', 'aas', 'aam', 'aad', 'into', 'iret', 'hlt', 'cmc', 'clc', 'stc', 'cli', 'sti', 'cld', 'std', 'ret', 'retf', 'ret 4', 'retf 6',
  'rep movsw', 'rep stosb', 'repe cmpsb', 'repne scasb', 'repz cmpsw', 'repnz scasw', 'lock inc word [bx]', 'int 0x10', 'int 3', 'int 0x21',
  'in al, 0x60', 'in ax, 0x40', 'in al, dx', 'in ax, dx', 'out 0x43, al', 'out 0x42, ax', 'out dx, al', 'out dx, ax',
  'mov al, [0x1234]', 'mov ax, [es:0x1234]', 'mov [0x1234], al', 'mov [0x1234], ax', 'mov ax, 0xA000', 'mov ax, 0A000h', 'mov cx, 320*200/2',
  'mov bx, (3+4)*2', "mov al, 'A'", 'mov ax, 1 << 4', 'mov ax, 0xFF & ~0x0F', 'mov dx, 0b1010', 'mov dx, 1010b', 'mov ax, -2',
  'jmp 0x1234:0x5678', 'call 0xF000:0xFFF0', 'db 1, 2, 3', "db 'Hello', 13, 10, '$'", 'dw 0x1234, 5', 'dd 0x12345678', 'times 5 db 0xAA', 'times 3 nop',
  'add bx, word 5', 'aam 16'].forEach(add);
// Jumps and labels need context, so these are little programs.
const programs = [
  'org 0x100\nstart: jmp end\n nop\nend: jmp start',
  'org 0x100\nstart: jmp far_away\n times 200 nop\nfar_away: jmp start\n jz far_away\n jnz .l\n.l: loop .l\n jcxz .l',
  'org 0x100\n jmp short x\n jmp near x\nx: call x\n call y\n times 300 db 0\ny: ret',
  'org 0x100\nmain: mov ax, data\n mov bx, [data]\n mov si, data+2\n add bx, len\n cmp word [data], len\n mov cx, len\n.a: loop .a\nother: jmp .a\n.a: nop\ndata: dw 1, 2\nlen equ $ - data',
  'org 0x100\nK equ 5\n add bx, K\n add bx, FWD\n mov ax, [bx+K]\n mov ax, [bx+FWD]\n mov ax, [bx+lbl]\nlbl: nop\nFWD equ 6',
  'org 0x100\n' + ['jo', 'jno', 'jb', 'jc', 'jnae', 'jnb', 'jae', 'jnc', 'je', 'jz', 'jne', 'jnz', 'jbe', 'jna', 'ja', 'jnbe', 'js', 'jns', 'jp', 'jpe', 'jnp', 'jpo',
    'jl', 'jnge', 'jge', 'jnl', 'jle', 'jng', 'jg', 'jnle', 'loop', 'loope', 'loopz', 'loopne', 'loopnz', 'jcxz'].map((j) => ` ${j} t`).join('\n') + '\nt: ret',
  'org 0x100\na: jmp c\n times 120 nop\nb: jmp d\n times 5 nop\nc: jmp b\n times 124 nop\nd: jmp a',
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asm-'));
function nasm(src) {
  const f = path.join(tmp, 't.asm'), o = path.join(tmp, 't.bin');
  fs.writeFileSync(f, 'bits 16\ncpu 8086\n' + src + '\n');
  const r = spawnSync('nasm', ['-f', 'bin', '-o', o, f], { encoding: 'utf8' });
  if (r.status !== 0) return { error: r.stderr.trim() };
  return { bytes: [...fs.readFileSync(o)] };
}
const hexs = (b) => b.map((x) => x.toString(16).padStart(2, '0')).join(' ');
let bad = 0, n = 0;
for (const src of cases.concat(programs)) {
  n++;
  const want = nasm(src), got = ASM.assemble(src);
  if (want.error) { console.log('NASM rejects:', JSON.stringify(src), want.error.split('\n')[0]); bad++; continue; }
  if (got.errors.length) { console.log('OURS rejects:', JSON.stringify(src), got.errors[0].message); bad++; continue; }
  if (hexs(want.bytes) !== hexs([...got.bytes])) { console.log('MISMATCH', JSON.stringify(src), '\n  nasm:', hexs(want.bytes).slice(0, 120), '\n  ours:', hexs([...got.bytes]).slice(0, 120)); bad++; }
}
fs.rmSync(tmp, { recursive: true });
console.log(`${n - bad}/${n} match`);
process.exit(bad ? 1 : 0);
