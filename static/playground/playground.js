/*
 * Playground page: wires the editor, the assembler and the machine together and
 * keeps the emulated display ticking at a fixed rate.
 */
(function () {
  'use strict';

  var EXAMPLES = [
    { file: 'shapes.asm', title: 'Shapes (every routine)' },
    { file: 'putpixel.asm', title: 'Put pixel' },
    { file: 'starfield.asm', title: 'Starfield' },
    { file: 'bounce.asm', title: 'Double buffering' },
    { file: 'palette.asm', title: 'Palette cycling' },
    { file: 'fire.asm', title: 'Fire' },
    { file: 'copper.asm', title: 'Copper bars' },
    { file: 'modex.asm', title: 'Mode X page flipping' }
  ];
  var DEFAULT_EXAMPLE = 'starfield.asm';   // what a first visit starts with

  // The CPU is not held to any period speed: each frame gets as many clock cycles as this
  // browser can emulate in about FRAME_SHARE of the frame time, re-measured as it runs.
  var FRAME_SHARE = 0.6, MIN_BUDGET = 1000000, MAX_BUDGET = 1000000000;

  // KeyboardEvent.code -> PC scancode (set 1).
  var SCAN = {
    Escape: 1, Digit1: 2, Digit2: 3, Digit3: 4, Digit4: 5, Digit5: 6, Digit6: 7, Digit7: 8, Digit8: 9, Digit9: 10, Digit0: 11,
    Minus: 12, Equal: 13, Backspace: 14, Tab: 15, KeyQ: 16, KeyW: 17, KeyE: 18, KeyR: 19, KeyT: 20, KeyY: 21, KeyU: 22, KeyI: 23,
    KeyO: 24, KeyP: 25, Enter: 28, ControlLeft: 29, KeyA: 30, KeyS: 31, KeyD: 32, KeyF: 33, KeyG: 34, KeyH: 35, KeyJ: 36, KeyK: 37,
    KeyL: 38, ShiftLeft: 42, KeyZ: 44, KeyX: 45, KeyC: 46, KeyV: 47, KeyB: 48, KeyN: 49, KeyM: 50, Comma: 51, Period: 52, Slash: 53,
    ShiftRight: 54, AltLeft: 56, Space: 57, ArrowUp: 72, ArrowLeft: 75, ArrowRight: 77, ArrowDown: 80
  };

  var STORE = 'm13h-playground-program';

  function init(el) {
    var base = el.getAttribute('data-base');
    var pinned = el.getAttribute('data-example');   // a page can ask for a particular example
    var store = pinned ? null : STORE;              // and then edits are not remembered
    var $ = function (sel) { return el.querySelector(sel); };
    var canvas = $('.pg-canvas'), status = $('.pg-status'), editor = $('.pg-editor'), output = $('.pg-console');
    var runButton = $('.pg-run'), pauseButton = $('.pg-pause'), exampleSelect = $('.pg-example');
    var refreshSelect = $('.pg-refresh'), tabs = el.querySelectorAll('.pg-tabs button');

    var ctx = canvas.getContext('2d'), image = ctx.createImageData(320, 200), pixels = new Uint32Array(image.data.buffer);

    var machine = new Mode13hMachine();
    var files = { program: '', 'vga.inc': '' };
    var current = 'program';
    var listing = null, paused = false;
    var lastTime = 0, owed = 0, shown = 0, shownAt = 0, rate = 0;
    var budget = 4000000, tally = 0, executed = 0;

    // --- console ------------------------------------------------------------

    function say(text, isError) {
      var span = document.createElement('span');
      if (isError) span.className = 'pg-error';
      span.textContent = text;
      output.appendChild(span);
      output.scrollTop = output.scrollHeight;
    }

    machine.onOutput = function (text) { say(text.replace(/\r/g, ''), false); };

    // --- editor -------------------------------------------------------------

    function showFile(name) {
      files[current] = editor.value;
      current = name;
      editor.value = files[name];
      for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute('aria-selected', tabs[i].getAttribute('data-file') === name ? 'true' : 'false');
    }

    function gotoLine(file, line) {
      var name = file === 'vga.inc' ? 'vga.inc' : 'program', text, start = 0, end, i;
      if (name !== current) showFile(name);
      text = editor.value;
      for (i = 1; i < line; i++) { start = text.indexOf('\n', start) + 1; if (start === 0) return; }
      end = text.indexOf('\n', start);
      if (end < 0) end = text.length;
      editor.focus();
      editor.setSelectionRange(start, end);
      // Scroll the selected line into the middle of the box.
      editor.scrollTop = Math.max(0, (line - 1) * parseFloat(getComputedStyle(editor).lineHeight) - editor.clientHeight / 2);
    }

    function save() {
      if (!store) return;
      try { localStorage.setItem(store, files.program); } catch (e) {}
    }

    editor.addEventListener('input', function () {
      files[current] = editor.value;
      if (current === 'program') save();
    });

    editor.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); return; }
      if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      // Tab moves to the next 8-column stop, the way assembly is usually laid out.
      e.preventDefault();
      var at = editor.selectionStart, col = at - (editor.value.lastIndexOf('\n', at - 1) + 1);
      editor.setRangeText(new Array(8 - (col % 8) + 1).join(' '), at, editor.selectionEnd, 'end');
      editor.dispatchEvent(new Event('input'));
    });

    for (var t = 0; t < tabs.length; t++) {
      tabs[t].addEventListener('click', function () { showFile(this.getAttribute('data-file')); });
    }

    // --- running --------------------------------------------------------------

    function sourceLine(cs, ip) {
      if (!listing || cs !== Mode13hMachine.LOAD_SEG) return null;
      for (var i = 0; i < listing.length; i++) {
        if (ip >= listing[i].addr && ip < listing[i].addr + listing[i].length) return listing[i];
      }
      return null;
    }

    function run() {
      var result, i, e;
      files[current] = editor.value;
      output.textContent = '';
      result = ASM8086.assemble(files.program, {
        file: 'program.asm',
        include: function (name) { return name === 'vga.inc' ? files['vga.inc'] : null; }
      });
      if (result.errors.length) {
        for (i = 0; i < result.errors.length; i++) {
          e = result.errors[i];
          say(e.file + ':' + e.line + ': ' + e.message + '\n', true);
        }
        gotoLine(result.errors[0].file, result.errors[0].line);
        return;
      }
      listing = result.lines;
      machine.setSpeed(budget);
      machine.refresh = +refreshSelect.value;
      machine.loadProgram(result.bytes, result.origin);
      paused = false;
      pauseButton.textContent = 'Pause';
      say('Assembled ' + result.bytes.length + ' bytes.\n', false);
      reported = false;
      owed = 1;
    }

    var reported = false;

    function report() {
      var where, hex = CPU8086.hex;
      if (reported) return;
      if (machine.state === 'fault') {
        where = sourceLine(machine.fault.cs, machine.fault.ip);
        say('\nStopped: ' + machine.fault.message + ' at ' + hex(machine.fault.cs, 4) + ':' + hex(machine.fault.ip, 4) +
          (where ? ' (' + where.file + ' line ' + where.line + ')' : '') + '\n', true);
        if (where) gotoLine(where.file, where.line);
        reported = true;
      } else if (machine.state === 'exited') {
        say('\nProgram ended.\n', false);
        reported = true;
      }
    }

    function registers() {
      var r = machine.cpu.reg, s = machine.cpu.seg, f = machine.cpu.getFlags(), hex = CPU8086.hex;
      var flag = function (bit, name) { return (f >> bit) & 1 ? name : '-'; };
      return 'AX=' + hex(r[0], 4) + ' BX=' + hex(r[3], 4) + ' CX=' + hex(r[1], 4) + ' DX=' + hex(r[2], 4) +
        ' SI=' + hex(r[6], 4) + ' DI=' + hex(r[7], 4) + ' BP=' + hex(r[5], 4) + ' SP=' + hex(r[4], 4) +
        '\nCS:IP=' + hex(s[1], 4) + ':' + hex(machine.cpu.getIP(), 4) + ' DS=' + hex(s[3], 4) + ' ES=' + hex(s[0], 4) + ' SS=' + hex(s[2], 4) +
        ' flags=' + flag(11, 'O') + flag(10, 'D') + flag(7, 'S') + flag(6, 'Z') + flag(4, 'A') + flag(2, 'P') + flag(0, 'C');
    }

    function updateStatus(now) {
      var text;
      if (now - shownAt < 250) return;
      rate = (machine.getFrames() - shown) * 1000 / (now - shownAt);
      executed = tally * 1000 / (now - shownAt); tally = 0;
      shown = machine.getFrames(); shownAt = now;
      if (machine.state === 'idle') text = 'Press Run.';
      else if (paused || machine.state === 'paused') text = 'Paused.\n' + registers();
      else if (machine.state === 'running') {
        text = 'Running: ' + rate.toFixed(0) + ' frames/s, ' + (executed / 1e6).toFixed(1) + ' million cycles/s' +
          (rate >= 1 ? ', ' + Math.round(executed / rate).toLocaleString('en-US') + ' cycles/frame' : '') +
          (machine.getMode() === 0x13 ? '' : ', video mode ' + CPU8086.hex(machine.getMode(), 2) + 'h (set mode 13h to see pixels)');
      } else text = (machine.state === 'fault' ? 'Stopped on an error.' : 'Program ended.') + '\n' + registers();
      status.textContent = text;
    }

    function present() {
      var h = machine.height;
      if (canvas.height !== h) {   // a program in a 240-line mode: same 4:3 screen, more rows
        canvas.height = h;
        image = ctx.createImageData(320, h);
        pixels = new Uint32Array(image.data.buffer);
      }
      pixels.set(machine.frame.subarray(0, 320 * h));
      ctx.putImageData(image, 0, 0);
    }

    // Emulate one frame, then use how long it took to size the next frame's cycle budget.
    function frame(step) {
      var before = performance.now(), ran = machine.cpu.getExecuted(), took, used;
      machine.runFrame();
      took = performance.now() - before;
      used = machine.cpu.getExecuted() - ran;
      tally += used;
      // Only a frame that kept the CPU busy says anything about how fast this browser is.
      if (machine.load > 0.5 && took >= 1) {
        budget = Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, budget * 0.5 + (used / took) * step * FRAME_SHARE * 0.5));
        machine.setSpeed(budget);
      }
    }

    // The display runs at its own fixed rate, whatever the browser's refresh rate is:
    // each animation callback emulates however many whole frames have become due.
    function tick(now) {
      var step = 1000 / machine.refresh, n = 0;
      requestAnimationFrame(tick);
      owed += Math.min(now - lastTime, 100) / step;
      lastTime = now;
      if (paused || machine.state === 'idle') { owed = 0; updateStatus(now); return; }
      while (owed >= 1 && n < 3) { frame(step); owed--; n++; }
      if (owed > 3) owed = 0;   // too far behind to catch up; carry on from here
      if (n) present();
      report();
      updateStatus(now);
    }

    runButton.addEventListener('click', function () { run(); canvas.focus(); });

    pauseButton.addEventListener('click', function () {
      if (machine.state === 'paused') { machine.resume(); paused = false; }
      else paused = !paused;
      pauseButton.textContent = paused ? 'Resume' : 'Pause';
      shownAt = 0;
    });

    refreshSelect.addEventListener('change', function () { machine.refresh = +refreshSelect.value; });

    // --- keyboard -------------------------------------------------------------

    canvas.addEventListener('keydown', function (e) {
      var scan = SCAN[e.code];
      if (!scan || e.ctrlKey || e.metaKey) return;
      if (e.code !== 'Tab') e.preventDefault(); else return;   // Tab still moves focus off the screen
      if (e.repeat) return;
      machine.keyDown(scan, e.key.length === 1 ? e.key.charCodeAt(0) : e.key === 'Enter' ? 13 : e.key === 'Escape' ? 27 : e.key === 'Backspace' ? 8 : 0);
    });

    canvas.addEventListener('keyup', function (e) {
      if (SCAN[e.code]) machine.keyUp(SCAN[e.code]);
    });

    // --- start up -------------------------------------------------------------

    function fetchText(name) {
      return fetch(base + name).then(function (res) {
        if (!res.ok) throw new Error('Could not load ' + name);
        return res.text();
      });
    }

    function loadExample(file) {
      return fetchText('examples/' + file).then(function (text) {
        files.program = text;
        if (current === 'program') editor.value = text; else showFile('program');
        save();
        run();
      });
    }

    var saved = null;
    try { saved = store ? localStorage.getItem(store) : null; } catch (e) {}
    if (saved) {
      var mine = document.createElement('option');
      mine.value = ''; mine.textContent = 'Your last program';
      exampleSelect.appendChild(mine);
    }
    EXAMPLES.forEach(function (ex) {
      var o = document.createElement('option');
      o.value = ex.file; o.textContent = ex.title;
      exampleSelect.appendChild(o);
    });
    exampleSelect.addEventListener('change', function () {
      if (exampleSelect.value) loadExample(exampleSelect.value).catch(function (e) { say(e.message + '\n', true); });
    });

    fetchText('vga.inc').then(function (text) {
      files['vga.inc'] = text;
      if (saved) { files.program = saved; editor.value = saved; run(); return null; }
      exampleSelect.value = pinned || DEFAULT_EXAMPLE;
      return loadExample(pinned || DEFAULT_EXAMPLE);
    }).catch(function (e) {
      status.textContent = e.message;
    });

    lastTime = performance.now();
    requestAnimationFrame(tick);

    el.playground = { machine: machine, run: run };   // handy from the browser console
  }

  var all = document.querySelectorAll('.pg');
  for (var i = 0; i < all.length; i++) init(all[i]);
})();
