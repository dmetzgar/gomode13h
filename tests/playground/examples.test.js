// Assembles every example, runs it on the machine, checks the helper routines, and
// (with an output directory as the first argument) writes a PNG of each final frame.
// Run: node tests/playground/examples.test.js [outdir]
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ASM = require('../../static/playground/asm8086.js');
global.CPU8086 = require('../../static/playground/cpu8086.js');
const Machine = require('../../static/playground/machine.js');

const dir = path.join(__dirname, '../../static/playground');
const inc = fs.readFileSync(path.join(dir, 'vga.inc'), 'utf8');
const outdir = process.argv[2];
let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.log('FAIL', what); } };

function build(src, name) {
  const r = ASM.assemble(src, { file: name, include: (n) => (n === 'vga.inc' ? inc : null) });
  if (r.errors.length) { r.errors.forEach((e) => console.log(`  ${e.file}:${e.line}: ${e.message}`)); throw new Error(name + ' does not assemble'); }
  return r;
}

function png(frame, file) {
  const raw = Buffer.alloc(200 * (1 + 320 * 3));
  for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
    const p = frame[y * 320 + x], o = y * 961 + 1 + x * 3;
    raw[o] = p & 255; raw[o + 1] = (p >> 8) & 255; raw[o + 2] = (p >> 16) & 255;
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([len, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(320, 0); ihdr.writeUInt32BE(200, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// --- examples -------------------------------------------------------------------
for (const file of fs.readdirSync(path.join(dir, 'examples')).filter((f) => f.endsWith('.asm')).sort()) {
  const r = build(fs.readFileSync(path.join(dir, 'examples', file), 'utf8'), file);
  const m = new Machine();
  let text = '';
  m.onOutput = (t) => { text += t; };
  m.loadProgram(r.bytes, r.origin);
  const t0 = Date.now();
  let loadSum = 0;
  for (let f = 0; f < 150; f++) { m.runFrame(); loadSum += m.load; }
  const ms = (Date.now() - t0) / 150;
  check(m.state === 'running', `${file}: state is ${m.state}${m.fault ? ' (' + m.fault.message + ' at ' + m.fault.ip.toString(16) + ')' : ''}`);
  check(m.getMode() === 0x13, `${file}: in mode 13h`);
  check(new Set(m.frame).size > 2, `${file}: draws something`);
  check(text === '', `${file}: unexpected output ${JSON.stringify(text)}`);
  if (outdir) png(m.frame, path.join(outdir, file.replace('.asm', '.png')));
  // A key press should end every example cleanly.
  m.keyDown(0x1C, 13);
  for (let f = 0; f < 10; f++) m.runFrame();
  check(m.state === 'exited', `${file}: exits on a key (state ${m.state})`);
  check(m.getMode() === 3, `${file}: back in text mode`);
  console.log(`${file}: ${r.bytes.length} bytes, ${ms.toFixed(2)} ms/frame, load ${(loadSum / 150 * 100).toFixed(0)}%`);
}

// --- library routines, checked pixel by pixel -------------------------------------
function lib(body, frames) {
  const r = build('org 100h\n call vga_init\n' + body + '\n ret\n%include "vga.inc"\n', 'test');
  const m = new Machine();
  m.loadProgram(r.bytes, r.origin);
  for (let f = 0; f < (frames || 20) && m.state === 'running'; f++) m.runFrame();
  check(m.state === 'exited', 'library test finishes: ' + m.state + (m.fault ? ' ' + m.fault.message : '') + ' :: ' + body.slice(0, 60));
  const vga = m.cpu.mem.subarray(0xA0000, 0xA0000 + 64000);
  return { m, vga, px: (x, y) => vga[y * 320 + x], count: (c) => vga.reduce((n, v) => n + (v === c ? 1 : 0), 0), sym: r.symbols, r };
}
const sorted = (a) => a.slice().sort((p, q) => p - q).join();

let t = lib('mov bx, 5\n mov dx, 7\n mov al, 9\n call put_pixel\n mov bx, 319\n mov dx, 199\n mov al, 3\n call put_pixel\n mov bx, 320\n mov dx, 0\n call put_pixel\n mov bx, -1\n call put_pixel\n mov bx, 0\n mov dx, 200\n call put_pixel\n mov bx, 5\n mov dx, 7\n xor al, al\n call get_pixel\n mov [0x80], al\n mov bx, 999\n call get_pixel\n mov [0x81], al');
check(t.px(5, 7) === 9 && t.px(319, 199) === 3, 'put_pixel');
check(t.count(0) === 63998, 'put_pixel clips');
check(t.m.cpu.mem[0x10080] === 9 && t.m.cpu.mem[0x10081] === 0, 'get_pixel');

// Lines in every octant: both ends plotted, right pixel count, and identical to a reference Bresenham.
for (const [x0, y0, x1, y1] of [[10, 10, 100, 10], [10, 10, 10, 90], [10, 10, 100, 40], [10, 10, 40, 100], [100, 100, 10, 60], [100, 100, 60, 10], [50, 150, 150, 50], [150, 50, 50, 150], [7, 7, 7, 7], [0, 0, 319, 199], [319, 0, 0, 199]]) {
  t = lib(`mov bx, ${x0}\n mov dx, ${y0}\n mov si, ${x1}\n mov di, ${y1}\n mov al, 5\n call draw_line`);
  const want = [];
  { let x = x0, y = y0, dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (;;) { want.push(y * 320 + x); if (x === x1 && y === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x += sx; } if (e2 <= dx) { err += dx; y += sy; } } }
  const got = []; t.vga.forEach((v, i) => { if (v === 5) got.push(i); });
  check(sorted(got) === sorted(want), `draw_line ${x0},${y0} -> ${x1},${y1} (${got.length} px, want ${want.length})`);
}
t = lib('mov bx, -20\n mov dx, 50\n mov si, 30\n mov di, 50\n mov al, 5\n call draw_line');
check(t.count(5) === 31, 'draw_line clips at the left edge');

for (const rad of [1, 5, 20, 60]) {
  t = lib(`mov bx, 160\n mov dx, 100\n mov cx, ${rad}\n mov al, 6\n call draw_circle`);
  let ok = t.px(160 + rad, 100) === 6 && t.px(160 - rad, 100) === 6 && t.px(160, 100 + rad) === 6 && t.px(160, 100 - rad) === 6, far = 0;
  t.vga.forEach((v, i) => { if (v === 6) { const d = Math.hypot((i % 320) - 160, Math.floor(i / 320) - 100); if (Math.abs(d - rad) > 0.8) far++; } });
  check(ok && far === 0, `draw_circle r=${rad} (off-radius pixels: ${far})`);
}

// Ellipses must match Zingl's algorithm pixel for pixel, including degenerate radii.
for (const [a, b] of [[60, 60], [100, 40], [40, 90], [155, 95], [255, 255], [1, 30], [30, 1], [0, 20], [20, 0], [0, 0], [1, 1], [7, 3]]) {
  t = lib(`mov bx, 160\n mov dx, 100\n mov cx, ${a}\n mov si, ${b}\n mov al, 6\n call draw_ellipse`);
  const want = new Set(), set = (x, y) => { if (x >= 0 && x < 320 && y >= 0 && y < 200) want.add(y * 320 + x); };
  { let x = -a, y = 0, e2 = b * b, err = x * (2 * e2 + x) + e2;
    do { set(160 - x, 100 + y); set(160 + x, 100 + y); set(160 + x, 100 - y); set(160 - x, 100 - y); e2 = 2 * err;
      if (e2 >= (x * 2 + 1) * b * b) err += (++x * 2 + 1) * b * b;
      if (e2 <= (y * 2 + 1) * a * a) err += (++y * 2 + 1) * a * a; } while (x <= 0);
    while (y++ < b) { set(160, 100 + y); set(160, 100 - y); } }
  const got = []; t.vga.forEach((v, i) => { if (v === 6) got.push(i); });
  check(sorted(got) === sorted([...want]), `draw_ellipse ${a} x ${b} (${got.length} px, want ${want.size})`);
}

t = lib('mov al, 7\n call clear_buffer');
check(t.count(7) === 64000, 'clear_buffer');
t = lib('call target_buffer\n mov al, 8\n call clear_buffer\n mov bx, 3\n mov dx, 4\n mov al, 2\n call put_pixel\n call copy_buffer');
check(t.count(8) === 63999 && t.px(3, 4) === 2, 'target_buffer + copy_buffer');
t = lib('call target_buffer\n mov al, 8\n call clear_buffer');
check(t.count(0) === 64000 && t.m.cpu.mem[0x20000] === 8 && t.m.cpu.mem[0x20000 + 63999] === 8, 'back buffer is separate from the screen');

// Flood fill inside a circle fills exactly the interior; reference fill in JS.
t = lib('mov bx, 100\n mov dx, 100\n mov cx, 30\n mov al, 6\n call draw_circle\n mov al, 9\n call flood_fill');
{
  const ref = lib('mov bx, 100\n mov dx, 100\n mov cx, 30\n mov al, 6\n call draw_circle').vga.slice();
  const stack = [100 * 320 + 100];
  while (stack.length) { const i = stack.pop(); if (ref[i] !== 0) continue; ref[i] = 9; const x = i % 320; if (x > 0) stack.push(i - 1); if (x < 319) stack.push(i + 1); if (i >= 320) stack.push(i - 320); if (i < 63680) stack.push(i + 320); }
  check(Buffer.compare(Buffer.from(ref), Buffer.from(t.vga)) === 0, 'flood_fill matches a reference fill inside a circle');
  check(t.count(9) > 2000 && t.px(0, 0) === 0, 'flood_fill stays inside');
}
t = lib('mov bx, 0\n mov dx, 0\n mov al, 4\n call flood_fill', 60);
check(t.count(4) === 64000, 'flood_fill of the whole empty screen');
t = lib('mov bx, 160\n mov dx, 0\n mov si, 160\n mov di, 199\n mov al, 1\n call draw_line\n mov bx, 0\n mov dx, 100\n mov si, 319\n mov di, 100\n call draw_line\n mov bx, 10\n mov dx, 10\n mov al, 4\n call flood_fill\n mov bx, 300\n mov dx, 190\n mov al, 4\n call flood_fill', 60);
check(t.count(4) === 160 * 100 + 159 * 99 && t.count(0) === 159 * 100 + 160 * 99, 'flood_fill respects boundaries');
t = lib('mov bx, 9\n mov dx, 9\n mov al, 0\n call flood_fill');
check(t.count(0) === 64000, 'flood_fill with the same colour does nothing');

// Palette: set/get one entry, then save/modify/load round trip.
t = lib('mov al, 200\n mov ah, 11\n mov bl, 22\n mov bh, 33\n call set_palette_entry\n xor ah, ah\n xor bx, bx\n call get_palette_entry\n mov [0x80], ax\n mov [0x82], bx\n push ds\n pop es\n mov di, 0x2000\n call save_palette\n mov byte [0x2000 + 15*3], 1\n mov byte [0x2000 + 15*3 + 1], 2\n mov byte [0x2000 + 15*3 + 2], 3\n mov si, 0x2000\n call load_palette\n mov al, 15\n call get_palette_entry\n mov [0x84], ax\n mov [0x86], bx\n mov bx, 0\n mov dx, 0\n mov al, 200\n call put_pixel\n call wait_retrace\n call wait_retrace');
{
  const mem = t.m.cpu.mem;
  check(mem[0x10080] === 200 && mem[0x10081] === 11 && mem[0x10082] === 22 && mem[0x10083] === 33, 'set/get_palette_entry');
  check(mem[0x12000 + 200 * 3] === 11 && mem[0x12000 + 3] === 0 && mem[0x12000 + 5] === 42, 'save_palette (entry 200 and default entry 1)');
  check(mem[0x10085] === 1 && mem[0x10086] === 2 && mem[0x10087] === 3, 'load_palette');
  const p = t.m.frame[0];
  check((p & 255) === ((11 << 2) | (11 >> 4)) && ((p >> 8) & 255) === ((22 << 2) | (22 >> 4)) && ((p >> 16) & 255) === ((33 << 2) | (33 >> 4)), 'palette reaches the displayed frame');
}

// wait_retrace costs one frame each.
{
  const r = build('org 100h\n call vga_init\n mov cx, 30\nl: call wait_retrace\n loop l\n ret\n%include "vga.inc"\n', 't');
  const m = new Machine(); m.loadProgram(r.bytes, r.origin);
  let n = 0; while (m.state === 'running' && n < 100) { m.runFrame(); n++; }
  check(n >= 30 && n <= 32, `30 x wait_retrace takes 30 frames (took ${n})`);
}

console.log(failures ? `${failures} FAILED` : 'all example and library checks passed');
process.exit(failures ? 1 : 0);
