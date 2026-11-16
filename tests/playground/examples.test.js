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
  check(new Set(m.frame).size > 1, `${file}: draws something`);
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

// --- Mode X: unchained planes, write modes, page flipping, 240 lines ----------------
function raw(body, frames) {
  const r = build('org 100h\n mov ax, 13h\n int 10h\n mov ax, 0A000h\n mov es, ax\n' + body + '\nhang: jmp hang\n', 'modex-test');
  const m = new Machine();
  m.loadProgram(r.bytes, r.origin);
  for (let f = 0; f < (frames || 4); f++) m.runFrame();
  check(m.state === 'running', 'mode x test runs: ' + m.state + (m.fault ? ' ' + m.fault.message : ''));
  const plane = (p, at) => m.planes[(p << 16) | at];
  return { m, plane, at: (x, y) => m.frame[y * 320 + x], mem: (a) => m.cpu.mem[0x10000 + a] };
}
const UNCHAIN = ' mov dx, 3C4h\n mov ax, 0604h\n out dx, ax\n';
const colourOf = (() => { const t = raw(' mov byte [es:0], 9\n mov byte [es:1], 12\n mov byte [es:2], 5'); return { 9: t.at(0, 0), 12: t.at(1, 0), 5: t.at(2, 0), 0: t.at(3, 0) }; })();
{
  // A picture drawn in mode 13h is still there after unchaining.
  let t = raw(' mov byte [es:320 * 3 + 6], 9\n' + UNCHAIN);
  check(t.at(6, 3) === colourOf[9] && t.plane(2, 3 * 80 + 1) === 9, 'unchaining keeps the picture');

  // Map mask: one write lands only in the enabled planes; x mod 4 is the plane.
  t = raw(UNCHAIN + ' mov ax, 0202h\n out dx, ax\n mov byte [es:80 * 2 + 5], 12\n mov ax, 0C02h\n out dx, ax\n mov byte [es:7], 5');
  check(t.plane(1, 165) === 12 && t.plane(0, 165) === 0 && t.plane(2, 165) === 0 && t.plane(3, 165) === 0, 'map mask selects one plane');
  check(t.at(21, 2) === colourOf[12] && t.at(20, 2) === colourOf[0] && t.at(22, 2) === colourOf[0], 'unchained pixel shows at x = offset * 4 + plane');
  check(t.plane(2, 7) === 5 && t.plane(3, 7) === 5 && t.plane(0, 7) === 0 && t.at(30, 0) === colourOf[5] && t.at(31, 0) === colourOf[5], 'two planes at once');
  check(t.m.cpu.mem[0xA0000 + 7] === 0, 'plain memory at A000h is untouched while unchained');

  // Read map select, and reading back through a word access.
  t = raw(UNCHAIN + ' mov ax, 0102h\n out dx, ax\n mov byte [es:9], 11h\n mov ax, 0802h\n out dx, ax\n mov word [es:9], 4433h\n' +
    ' mov dx, 3CEh\n mov ax, 0004h\n out dx, ax\n mov al, [es:9]\n mov [0x2000], al\n mov ax, 0304h\n out dx, ax\n mov ax, [es:9]\n mov [0x2002], ax');
  check(t.mem(0x2000) === 0x11 && t.mem(0x2002) === 0x33 && t.mem(0x2003) === 0x44, 'read map select');

  // Write mode 1: a read loads the latches, a write stores all four of them.
  t = raw(UNCHAIN + ' mov cx, 4\n mov ah, 1\nl: mov al, 2\n out dx, ax\n mov [es:3], ah\n shl ah, 1\n loop l\n mov ax, 0F02h\n out dx, ax\n' +
    ' mov dx, 3CEh\n mov ax, 4105h\n out dx, ax\n mov al, [es:3]\n mov [es:500], al\n mov ax, 4005h\n out dx, ax');
  check([0, 1, 2, 3].every((p) => t.plane(p, 500) === 1 << p), 'write mode 1 copies the latches');

  // rep stosw with all planes on clears four pixels per byte; rep movsb in write mode 1 copies them.
  t = raw(UNCHAIN + ' mov ax, 0F02h\n out dx, ax\n xor di, di\n mov ax, 0707h\n mov cx, 40\n cld\n rep stosw\n mov ax, 0402h\n out dx, ax\n mov byte [es:2], 9\n mov ax, 0F02h\n out dx, ax\n' +
    ' mov dx, 3CEh\n mov ax, 4105h\n out dx, ax\n push es\n pop ds\n xor si, si\n mov di, 800\n mov cx, 80\n rep movsb\n push cs\n pop ds');
  let ok = true;
  for (let i = 0; i < 80; i++) for (let p = 0; p < 4; p++) if (t.plane(p, 800 + i) !== (i === 2 && p === 2 ? 9 : 7)) ok = false;
  check(ok && t.at(12, 10) === t.at(0, 0) && t.at(12, 10) !== colourOf[0] && t.at(10, 10) === colourOf[9], 'latched rep movsb copies a whole row');

  // Bit mask and set/reset (write mode 0), and write mode 2.
  t = raw(UNCHAIN + ' mov ax, 0F02h\n out dx, ax\n mov byte [es:4], 0FFh\n mov dx, 3CEh\n mov ax, 0F08h\n out dx, ax\n mov al, [es:4]\n mov byte [es:4], 0\n' +
    ' mov ax, 0FF08h\n out dx, ax\n mov ax, 0500h\n out dx, ax\n mov ax, 0F01h\n out dx, ax\n mov byte [es:5], 0\n mov ax, 0001h\n out dx, ax\n mov ax, 4205h\n out dx, ax\n mov byte [es:6], 0Ah');
  check([0, 1, 2, 3].every((p) => t.plane(p, 4) === 0xF0), 'bit mask keeps the latched bits');
  check(t.plane(0, 5) === 0xFF && t.plane(1, 5) === 0 && t.plane(2, 5) === 0xFF && t.plane(3, 5) === 0, 'set/reset');
  check(t.plane(0, 6) === 0 && t.plane(1, 6) === 0xFF && t.plane(2, 6) === 0 && t.plane(3, 6) === 0xFF, 'write mode 2');

  // CRTC: registers read back, 240 lines, and the start address shows another page after the retrace.
  const CRTC = ' mov dx, 3D4h\n mov si, tbl\n mov cx, 10\n cld\nc: lodsw\n out dx, ax\n loop c\n';
  const TBL = '\ntbl: dw 0D06h, 3E07h, 4109h, 0EA10h, 0AC11h, 0DF12h, 0014h, 0E715h, 0616h, 0E317h\n';
  t = raw(UNCHAIN + CRTC + ' mov al, 12h\n out dx, al\n inc dx\n in al, dx\n mov [0x2000], al\n mov ax, 0102h\n mov dx, 3C4h\n out dx, ax\n mov byte [es:239 * 80], 9\n mov byte [es:19200 + 80], 12\n jmp hang' + TBL);
  check(t.mem(0x2000) === 0xDF, 'CRTC registers read back');
  check(t.m.height === 240 && t.at(0, 239) === colourOf[9], '240 visible lines');
  t = raw(UNCHAIN + CRTC + ' mov ax, 0102h\n mov dx, 3C4h\n out dx, ax\n mov byte [es:19200 + 80], 12\n mov dx, 3D4h\n mov ax, 4B0Ch\n out dx, ax\n mov ax, 000Dh\n out dx, ax\n jmp hang' + TBL);
  check(t.at(0, 1) === colourOf[12] && t.at(0, 0) === colourOf[0], 'start address selects the page shown');

  // Setting the mode again goes back to plain chained mode 13h, 200 lines.
  t = raw(UNCHAIN + CRTC + ' mov ax, 13h\n int 10h\n mov byte [es:321], 9\n jmp hang' + TBL);
  check(t.m.height === 200 && t.at(1, 1) === colourOf[9] && t.m.cpu.mem[0xA0000 + 321] === 9, 'mode set restores chained mode 13h');
}

// --- clock cycles, against the published 8086 timings ------------------------------
// cyc(setup, body): cycles the CPU charges for `body`, measured as the difference between
// running setup + body + hlt and setup + hlt.
function cyc(setup, body, tail) {
  const run = (text) => {
    const r = build('org 100h\n' + text + '\n hlt\n' + (tail || '') + '\n%include "vga.inc"\n', 'cycles');
    const m = new Machine();
    m.loadProgram(r.bytes, r.origin);
    for (let i = 0; i < 2000000 && !m.cpu.halted; i++) m.cpu.step();
    check(m.cpu.halted, 'cycle test halts: ' + text.slice(0, 40));
    return m.cpu.getExecuted();
  };
  return run(setup + '\n' + body) - run(setup);
}
{
  const base = ' mov bx, 0x3000\n mov si, 4\n mov di, 8\n mov cx, 4\n mov ax, 1234h\n push ds\n pop es\n';
  const expect = (body, want, tail) => { const got = cyc(base, body, tail); check(got === want, `cycles: ${body.trim().replace(/\n\s*/g, ' / ')} = ${got}, expected ${want}`); };
  expect(' mov ax, bx', 2);
  expect(' mov ax, [bx]', 8 + 5);
  expect(' mov ax, [0x3000]', 10);                       // accumulator form
  expect(' mov dx, [0x3000]', 8 + 6);
  expect(' mov [bx + si], ax', 9 + 7);
  expect(' mov [bx + di + 2], ax', 9 + 12);
  expect(' mov [es:di], al', 2 + 9 + 5);                 // segment override costs 2
  expect(' mov word [bx], 5', 10 + 5);
  expect(' mov dx, 5', 4);
  expect(' add ax, 5', 4);
  expect(' add bx, cx', 3);
  expect(' add dx, [bx]', 9 + 5);
  expect(' add [bx], dx', 16 + 5);
  expect(' add word [bx + si + 2], 5', 17 + 11);
  expect(' cmp word [bx], 5', 10 + 5);
  expect(' cmp [bx], dx', 9 + 5);
  expect(' inc bx', 2);
  expect(' inc bl', 3);
  expect(' inc word [bx]', 15 + 5);
  expect(' neg bx', 3);
  expect(' not word [bx]', 16 + 5);
  expect(' test al, 8', 4);
  expect(' test bl, 8', 5);
  expect(' xchg ax, bx', 3);
  expect(' xchg cx, bx', 4);
  expect(' lea dx, [bx + si + 2]', 2 + 11);
  expect(' push ax\n pop ax', 11 + 8);
  expect(' push ds\n pop ds', 10 + 8);
  expect(' pushf\n popf', 10 + 8);
  expect(' shl ax, 1', 2);
  expect(' shl ax, cl', 8 + 4 * 4);
  expect(' shr word [bx], 1', 15 + 5);
  expect(' shl word [bx], cl', 20 + 5 + 4 * 4);
  expect(' cbw\n cwd', 2 + 5);
  expect(' xor dx, dx\n jz t\n nop\nt:', 3 + 16);
  expect(' xor dx, dx\n jnz t\n nop\nt:', 3 + 4 + 3);
  expect(' jmp t\n nop\nt:', 15);
  expect(' mov cx, 3\nt: loop t', 4 + 17 + 17 + 5);
  expect(' call f', 19 + 8, 'f: ret');
  expect(' mov dx, 3DAh\n in al, dx', 4 + 8);
  expect(' mov dx, 3C8h\n out dx, al', 4 + 8);
  expect(' cld\n mov cx, 100\n rep movsw', 2 + 4 + 9 + 17 * 100);
  expect(' mov cx, 100\n rep stosb', 4 + 9 + 10 * 100);
  expect(' movsb\n stosw\n lodsb', 18 + 11 + 12);
  expect(' xlat', 11);
  let got = cyc(base, ' mul bx'); check(got >= 118 && got <= 133, 'cycles: mul bx in 118-133, got ' + got);
  got = cyc(base, ' mov ax, 100\n mov bl, 7\n div bl') - 8; check(got >= 80 && got <= 90, 'cycles: div bl in 80-90, got ' + got);
  got = cyc(base, ' cwd\n idiv bx') - 5; check(got >= 165 && got <= 184, 'cycles: idiv bx in 165-184, got ' + got);
  got = cyc(base, ' imul bl'); check(got >= 80 && got <= 98, 'cycles: imul bl in 80-98, got ' + got);

  // The whole-screen copy, as costed by hand from the same tables: 171 cycles around a 544,009-cycle rep movsw.
  got = cyc(' call vga_init\n', ' call copy_buffer');
  check(got === 544180, 'cycles: call copy_buffer = ' + got + ', expected 544180');

  // A REP that runs past the end of a time slice carries on afterwards and costs the same.
  const r = build('org 100h\n call vga_init\n call copy_buffer\n hlt\n%include "vga.inc"\n', 'slices');
  const whole = new Machine(), sliced = new Machine();
  whole.loadProgram(r.bytes, r.origin); sliced.loadProgram(r.bytes, r.origin);
  for (let i = 0; i < 100000 && !whole.cpu.halted; i++) whole.cpu.step();
  for (let t = 1000; !sliced.cpu.halted && t < 5e6; t += 1000) sliced.cpu.runUntil(t);
  check(sliced.cpu.halted && sliced.cpu.getExecuted() === whole.cpu.getExecuted(), 'an interrupted rep movsw costs the same: ' + sliced.cpu.getExecuted() + ' vs ' + whole.cpu.getExecuted());
}

console.log(failures ? `${failures} FAILED` : 'all example and library checks passed');
process.exit(failures ? 1 : 0);
