(function () {
  'use strict';

  var root = document.documentElement;
  // Offered in the preview picker. "vga" and "turbo" still exist but are hidden for now:
  // reach them with ?theme=vga or params.variant.
  var VARIANTS = ['copper', 'turboc'];
  var KEY = 'm13h-variant';
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function variant() { return root.getAttribute('data-theme'); }

  // ---------------------------------------------------------------------
  // The default VGA 256-colour palette, as the BIOS loads it for mode 13h:
  // 16 EGA colours, 16 greys, then a 24-step hue ring at three saturations
  // and three brightness levels. Values are 6-bit DAC levels.
  // ---------------------------------------------------------------------
  function vgaPalette() {
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
      for (i = 0; i < 4; i++) p.push([r[i], lo, hi]);      // blue -> magenta
      for (i = 0; i < 4; i++) p.push([hi, lo, r[4 - i]]);  // magenta -> red
      for (i = 0; i < 4; i++) p.push([hi, r[i], lo]);      // red -> yellow
      for (i = 0; i < 4; i++) p.push([r[4 - i], hi, lo]);  // yellow -> green
      for (i = 0; i < 4; i++) p.push([lo, hi, r[i]]);      // green -> cyan
      for (i = 0; i < 4; i++) p.push([lo, r[4 - i], hi]);  // cyan -> blue
    });
    while (p.length < 256) p.push([0, 0, 0]);
    return p.map(function (c) { return c.map(function (v) { return Math.round(v * 255 / 63); }); });
  }

  function pack(c) { return (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]; }

  var VGA = vgaPalette();
  var VGA32 = new Uint32Array(VGA.map(pack));

  // ---------------------------------------------------------------------
  // Palette strip: all 256 entries in a row.
  // ---------------------------------------------------------------------
  function paintStrip(canvas) {
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(256, 1);
    new Uint32Array(img.data.buffer).set(VGA32);
    ctx.putImageData(img, 0, 0);
  }

  // ---------------------------------------------------------------------
  // Hero effects, drawn the mode 13h way: a byte-per-pixel buffer pushed
  // through a palette.
  // ---------------------------------------------------------------------
  function initFx(canvas) {
    var W = canvas.width, H = canvas.height;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(W, H);
    var out = new Uint32Array(img.data.buffer);
    var buf = new Uint8Array(W * (H + 2));
    var mask = new Uint8Array(W * H);
    var effects = ['fire', 'plasma', 'palette'];
    var current = 0, tick = 0, last = 0;

    var fire32 = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      fire32[i] = pack([Math.min(255, i * 3), i < 85 ? 0 : Math.min(255, (i - 85) * 3), i < 170 ? 0 : Math.min(255, (i - 170) * 3)]);
    }

    // The site title, rasterised once in the 8x8 BIOS font at 3x.
    function buildMask() {
      var c = document.createElement('canvas');
      c.width = W; c.height = H;
      var m = c.getContext('2d');
      m.font = '24px BIOS';
      m.textBaseline = 'top';
      m.fillStyle = '#fff';
      m.fillText('Mode 13h', (W - 192) / 2, 44);
      var d = m.getImageData(0, 0, W, H).data;
      for (var j = 0; j < W * H; j++) mask[j] = d[j * 4 + 3] > 127 ? 1 : 0;
    }

    function fire() {
      var x, y, j, v;
      for (y = 0; y < H; y++) {
        for (x = 1; x < W - 1; x++) {
          j = y * W + x;
          v = ((buf[j + W - 1] + buf[j + W] + buf[j + W + 1] + buf[j + W + W]) >> 2) - (Math.random() * 18 | 0);
          buf[j] = v < 0 ? 0 : v;
        }
      }
      // The letters are the fuel.
      for (j = 0; j < W * H; j++) if (mask[j]) buf[j] = 150 + (Math.random() * 105 | 0);
      // Draw the letters white-hot so the title stays readable under the flames.
      for (j = 0; j < W * H; j++) out[j] = fire32[mask[j] ? 215 + (Math.random() * 40 | 0) : buf[j]];
    }

    function overlayTitle() {
      var j;
      for (j = 0; j < W * H - W - 1; j++) if (mask[j]) out[j + W + 1] = VGA32[0];
      for (j = 0; j < W * H; j++) if (mask[j]) out[j] = VGA32[15];
    }

    function plasma() {
      var t = tick / 20, x, y, v;
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          v = Math.sin(x / 23 + t) + Math.sin(y / 11 - t) + Math.sin((x + y) / 29 + t / 2) +
              Math.sin(Math.sqrt((x - 160) * (x - 160) + (y - 50) * (y - 50) * 4) / 13 - t);
          // Walk the 24-entry hue ring at 68h (the dim, saturated one) and rotate it.
          out[y * W + x] = VGA32[104 + ((((v + 4) * 6 + tick / 3) | 0) % 24)];
        }
      }
      overlayTitle();
    }

    function palette() {
      var x, y, row;
      for (y = 0; y < H; y++) {
        row = Math.min(15, (y / 6) | 0);
        for (x = 0; x < W; x++) out[y * W + x] = y < 96 ? VGA32[row * 16 + ((x / 20) | 0)] : VGA32[0];
      }
      overlayTitle();
    }

    var draw = { fire: fire, plasma: plasma, palette: palette };

    function render() {
      draw[effects[current]]();
      ctx.putImageData(img, 0, 0);
    }

    function frame(now) {
      requestAnimationFrame(frame);
      if (now - last < 33 || document.hidden || canvas.offsetParent === null) return;
      last = now;
      tick++;
      render();
    }

    function start() {
      buildMask();
      if (reducedMotion) {
        for (var n = 0; n < 60; n++) fire();
        render();
      } else {
        requestAnimationFrame(frame);
      }
    }

    function next() {
      current = (current + 1) % effects.length;
      buf.fill(0);
      if (reducedMotion) { for (var n = 0; n < 60; n++) draw[effects[current]](); render(); }
    }

    canvas.addEventListener('click', next);
    var button = document.querySelector('.fx-next');
    if (button) button.addEventListener('click', next);

    if (document.fonts && document.fonts.load) {
      document.fonts.load('24px BIOS').then(start, start);
    } else {
      start();
    }
  }

  // ---------------------------------------------------------------------
  // "copper" variant: a banded, ordered-dithered sky rendered at 160x100
  // and stretched, so the gradient steps and dither are visible.
  // ---------------------------------------------------------------------
  var skyDone = false;
  function buildSky() {
    if (skyDone) return;
    skyDone = true;
    var W = 160, H = 100, BANDS = 20;
    var stops = [[0, [0, 0, 20]], [0.35, [8, 8, 72]], [0.6, [48, 20, 112]], [0.8, [120, 36, 112]], [0.93, [200, 76, 84]], [1, [240, 150, 80]]];
    var bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(W, H);
    var out = new Uint32Array(img.data.buffer);

    function colorAt(t) {
      for (var s = 1; s < stops.length; s++) {
        if (t <= stops[s][0]) {
          var a = stops[s - 1], b = stops[s], f = (t - a[0]) / (b[0] - a[0]);
          return pack([0, 1, 2].map(function (k) { return Math.round(a[1][k] + (b[1][k] - a[1][k]) * f); }));
        }
      }
      return pack(stops[stops.length - 1][1]);
    }

    var x, y, t, seed = 0x13;
    function rand() {   // mulberry32, so the stars land in the same place on every page
      seed = (seed + 0x6D2B79F5) | 0;
      var r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        t = y / (H - 1) + (bayer[(y & 3) * 4 + (x & 3)] / 16 - 0.5) / BANDS;
        t = Math.round(Math.max(0, Math.min(1, t)) * BANDS) / BANDS;
        out[y * W + x] = colorAt(t);
      }
    }
    // A few fixed stars in the upper sky.
    for (var n = 0; n < 70; n++) {
      x = rand() * W | 0;
      y = rand() * H * 0.6 | 0;
      out[y * W + x] = VGA32[n % 3 === 0 ? 15 : 7];
    }
    ctx.putImageData(img, 0, 0);
    root.style.setProperty('--sky', 'url(' + c.toDataURL() + ')');
  }

  // ---------------------------------------------------------------------
  // "turboc" variant: a Turbo C++ editor window, sized to the viewport,
  // drawn in text behind the page.
  // ---------------------------------------------------------------------
  var SOURCE = [
    '/* MODE13H.CPP -- 320x200, 256 colors, one byte per pixel */',
    '#include <dos.h>',
    '#include <mem.h>',
    '#include <conio.h>',
    '#include <stdlib.h>',
    '',
    '#define SCREEN_W 320',
    '#define SCREEN_H 200',
    '',
    'typedef unsigned char byte;',
    '',
    'byte far *vga = (byte far *)MK_FP(0xA000, 0);',
    'byte buffer[SCREEN_W * SCREEN_H];',
    '',
    'void set_mode(byte mode)',
    '{',
    '    union REGS regs;',
    '    regs.h.ah = 0x00;',
    '    regs.h.al = mode;',
    '    int86(0x10, &regs, &regs);',
    '}',
    '',
    'void set_palette(byte index, byte r, byte g, byte b)',
    '{',
    '    outp(0x3C8, index);',
    '    outp(0x3C9, r);',
    '    outp(0x3C9, g);',
    '    outp(0x3C9, b);',
    '}',
    '',
    'void wait_retrace(void)',
    '{',
    '    while (inp(0x3DA) & 8);',
    '    while (!(inp(0x3DA) & 8));',
    '}',
    '',
    'void fire(void)',
    '{',
    '    int x, y, sum;',
    '    byte *p = buffer + (SCREEN_H - 1) * SCREEN_W;',
    '',
    '    for (x = 0; x < SCREEN_W; x++)',
    '        p[x] = random(256);          // fuel along the bottom row',
    '',
    '    for (y = 0; y < SCREEN_H - 1; y++) {',
    '        p = buffer + (y << 8) + (y << 6);',
    '        for (x = 1; x < SCREEN_W - 1; x++) {',
    '            sum = p[x + 319] + p[x + 320] + p[x + 321] + p[x];',
    '            p[x] = (sum >> 2) ? (sum >> 2) - 1 : 0;',
    '        }',
    '    }',
    '}',
    '',
    'int main(void)',
    '{',
    '    int i;',
    '',
    '    set_mode(0x13);',
    '    for (i = 0; i < 64; i++) {',
    '        set_palette(i, i, 0, 0);            // black to red',
    '        set_palette(i + 64, 63, i, 0);      // red to yellow',
    '        set_palette(i + 128, 63, 63, i);    // yellow to white',
    '        set_palette(i + 192, 63, 63, 63);',
    '    }',
    '',
    '    while (!kbhit()) {',
    '        fire();',
    '        wait_retrace();',
    '        _fmemcpy(vga, buffer, sizeof(buffer));',
    '    }',
    '',
    '    getch();',
    '    set_mode(0x03);',
    '    return 0;',
    '}'
  ];
  var TOKEN = /(\/\*.*?\*\/|\/\/.*$)|("[^"]*")|\b(0x[0-9A-Fa-f]+|\d+)\b|\b(void|int|char|unsigned|byte|far|union|typedef|for|while|if|else|return|sizeof)\b/g;

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function colorize(line) {
    if (line.charAt(0) === '#') return '<i class="pp">' + esc(line) + '</i>';
    var html = '', at = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(line))) {
      html += esc(line.slice(at, m.index));
      html += '<i class="' + (m[1] ? 'cm' : m[2] ? 'st' : m[3] ? 'nu' : 'kw') + '">' + esc(m[0]) + '</i>';
      at = m.index + m[0].length;
    }
    return html + esc(line.slice(at));
  }

  function repeat(ch, n) { return n > 0 ? new Array(n + 1).join(ch) : ''; }

  function buildBackdrop() {
    var pre = document.querySelector('.backdrop .ide');
    if (!pre) return;
    var cols = window.innerWidth < 700 ? 48 : 80;
    var size = window.innerWidth / cols / 0.5625;   // the 9x16 cell is 9/16 em wide
    var rows = Math.ceil(window.innerHeight / size);
    var inner = cols - 2;
    var title = ' MODE13H.CPP ';
    var fill = cols - 12 - title.length;   // what's left of the top edge after the corners, [■] and 1═[↕]
    var left = Math.floor(fill / 2);
    var lines = [''];
    lines.push('<b>╔═[<i class="ok">■</i>]' + repeat('═', left) + title + repeat('═', fill - left) + '1═[<i class="ok">↕</i>]═╗</b>');
    for (var r = 0; r < rows - 4; r++) {
      var src = (SOURCE[r] || '').slice(0, inner - 1);
      var bar = r === 0 ? '▲' : r === rows - 5 ? '▼' : r === 1 ? '■' : '▒';
      lines.push('<b>║</b> ' + colorize(src) + repeat(' ', inner - 1 - src.length) + '<i class="sb">' + bar + '</i>');
    }
    lines.push('<b>╚═</b><i class="ok">☼</i><b>══ 1:1 ══</b><i class="sb">◄■' + repeat('▒', inner - 15) + '►</i><b>─┘</b>');
    pre.style.fontSize = size + 'px';
    pre.innerHTML = lines.join('\n');
  }

  // ---------------------------------------------------------------------
  // Variant handling and the picker in the corner of every page.
  // ---------------------------------------------------------------------
  function applyVariant() {
    if (variant() === 'copper') buildSky();
    if (variant() === 'turboc') buildBackdrop();
    var buttons = document.querySelectorAll('.variant-picker button');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', buttons[i].value === variant() ? 'true' : 'false');
    }
  }

  function setVariant(v) {
    root.setAttribute('data-theme', v);
    try { localStorage.setItem(KEY, v); } catch (e) {}
    applyVariant();
  }

  function buildPicker() {
    var box = document.createElement('div');
    box.className = 'variant-picker';
    box.innerHTML = '<span>theme</span>' + VARIANTS.map(function (v, i) {
      return '<button type="button" value="' + v + '" ">' + v + '</button>';
    }).join('');
    box.addEventListener('click', function (e) {
      if (e.target.value) setVariant(e.target.value);
    });
    document.body.appendChild(box);
    // Number keys switch too, but only under `hugo server`: a visitor should not change the look by typing.
    if (root.hasAttribute('data-preview')) document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= VARIANTS.length) setVariant(VARIANTS[n - 1]);
    });
  }

  var strip = document.querySelector('.palstrip');
  if (strip) paintStrip(strip);
  var fx = document.querySelector('canvas.fx');
  if (fx) initFx(fx);
  buildPicker();
  applyVariant();

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (variant() === 'turboc') buildBackdrop(); }, 100);
  });
})();
