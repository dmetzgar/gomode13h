---
title: "Mode 13h playground"
description: "An 8086 with VGA card emulator"
menu:
  main:
    name: Play
    weight: 40
---

This is an in-browser emulator of an 8086, with 1 megabyte of memory and a VGA card that supports mode 13h.
Edit the assembly file, press **Run**, and it is assembled and executed: the pixels you see are the bytes in the memory page starting at `A000:0000`.

{{< playground >}}

## What is included in the emulator

- **CPU:** the full documented 8086 instruction set.
  Nothing from the 80186 onwards, so no `shl ax, 4`, `push 5` or `pusha`.
- **Assembler:** NASM-style syntax, with labels, `.local` labels, `equ`, `db`/`dw`/`dd`, `times`, `%include` and expressions.
- **Video:** mode 13h only, 320×200 with 256 colours, through `int 10h` and the palette ports `3C7h`–`3C9h`.
  Mode X and the other register tricks are not emulated.
- **Two buffers:** the screen at segment `A000h`, and a back buffer in the 64K above your program.
  Check the *Show back buffer* option to watch it.
- **Timing:** a fixed 60 frames a second (or 70, which is what a real VGA did in this mode).
  The CPU itself is not slowed down.
  It runs as fast as your browser allows.
  Use `wait_retrace` to wait for the frame to be drawn.
- **Raster effects:** each scanline is read from video memory as the beam reaches it, so changing the palette while the frame is drawing can have interesting effects.
- **Program format:** a `.COM` file.
  Start with `org 100h`, and end with `ret` or `int 20h`.
- **Keyboard:** click the screen first, then `int 16h` and port `60h` see your keys.
- **`hlt`** sleeps until the next vertical retrace, and **`int 3`** pauses and shows the registers.

## The library

`vga.inc` is ordinary source in the second tab; read it, change it, or ignore it and write your own.
Coordinates go in `BX` (x) and `DX` (y), the colour in `AL`, and every routine preserves the registers it does not return a value in.

| Routine | Inputs | What it does |
|---|---|---|
| `vga_init` | | Enter mode 13h and find the back buffer |
| `vga_done` | | Return to text mode |
| `target_screen`, `target_buffer` | | Choose where the drawing routines write |
| `put_pixel` | `BX`, `DX`, `AL` | Plot a point, ignoring anything off-screen |
| `get_pixel` | `BX`, `DX` | Return the colour in `AL` |
| `draw_line` | `BX`, `DX` to `SI`, `DI`, `AL` | Bresenham line |
| `draw_ellipse` | `BX`, `DX`, radii `CX` (horizontal) and `SI` (vertical), `AL` | Bresenham-style ellipse |
| `draw_circle` | `BX`, `DX`, radius `CX`, `AL` | An ellipse with equal radii |
| `flood_fill` | `BX`, `DX`, `AL` | Paint fill of the area around a point |
| `clear_buffer` | `AL` | Fill the whole target |
| `copy_buffer` | | Copy the back buffer to the screen |
| `wait_retrace` | | Wait for the next vertical retrace |
| `present` | | `wait_retrace`, then `copy_buffer` |
| `set_palette_entry` | index `AL`, red `AH`, green `BL`, blue `BH` | Change one colour (components are 0–63) |
| `get_palette_entry` | index `AL` | Return red `AH`, green `BL`, blue `BH` |
| `load_palette` | `DS:SI` | Set all 256 colours from 768 bytes |
| `save_palette` | `ES:DI` | Store all 256 colours into 768 bytes |
| `random` | | Return a pseudo-random number in `AX` |
| `key_pressed`, `wait_key` | | Check for a key (`ZF` clear if one is waiting), or wait for one |

## Further reading

- [The 8086 Family User's Manual](http://bitsavers.org/components/intel/8086/9800722-03_The_8086_Family_Users_Manual_Oct79.pdf) (Intel, October 1979) is the original reference for every instruction, flag and addressing mode.
  It is a 63 MB scanned PDF.
  - A more succinct guide to 8086 instructions can be found under this old [Intro to Computers](https://www.oocities.org/mc_introtocomputers/) course: [8086 Family Users Manual](https://bitsavers.org/components/intel/8086/9800722-03_The_8086_Family_Users_Manual_Oct79.pdf)
  - [Intel Op Codes](http://qzx.com/pc-gpe/intel.doc) from the PC Game Programmer's Encyclopedia is a much shorter plain-text list of the instructions but the site is often down.
- [The NASM manual](https://www.nasm.us/doc/) covers the assembler syntax used here.
- Michael Abrash's *Graphics Programming Black Book*, [chapter 35](https://www.phatcode.net/res/224/files/html/ch35/35-01.html), covers Bresenham's line algorithm on the VGA in depth.
- Alois Zingl's [A Rasterizing Algorithm for Drawing Curves](https://zingl.github.io/Bresenham.pdf) is the source of the ellipse routine in `vga.inc`.
- [The PC Game Programmer's Encyclopedia](http://qzx.com/pc-gpe/) is I first learned this, including Denthor's [mode 13h tutorial](http://qzx.com/pc-gpe/tut1.txt) and Mark Feldman's [Bresenham's Line and Circle Algorithms](http://qzx.com/pc-gpe/bres.txt).
