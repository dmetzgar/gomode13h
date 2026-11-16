---
title: "Mode 13h: how put pixel works"
date: 2026-11-15
draft: false
tags: ["mode13h","assembly"]
---

Drawing a single pixel to the screen is a great starting point for learning 8086 assembly.
You start to learn about the number of cycles per instruction and how to use registers.
And what's really cool is that you can try it out in the browser.

<!--more-->

A long time ago, I sent Epic Megagames a letter and a 3.5" disk with some work I had done.
I really wanted to work on games and didn't care that I was way too young (maybe 13 I think).
Instead of ignoring me, they sent me back this big packet with a thoughtful response letter, some materials about their games, a copy of Jazz Jackrabbit shareware on disk, and a copy of the PCGPE on disk.
The PC Game Programmer's Encyclopedia was full of articles and from it I was able to build my own graphics library using mode 13h and inline assembly in Turbo Pascal and C++.
I'm going to try my best to recreate what I remember from the put pixel article in the PCGPE.
The original is supposed to be here but the site doesn't always work: [Denthor's VGA Trainer, part 1](http://qzx.com/pc-gpe/tut1.txt)

## The screen is 64,000 bytes

Mode 13h is 320 pixels wide, 200 high, and each pixel is one byte.
That byte is not a colour but an index into a palette of 256 colours.
320 × 200 is 64,000 bytes, which fits inside a single 64K segment, and that is most of the reason this mode was so popular: the whole screen can be reached with one 16-bit offset.

The video card maps those bytes into memory at segment `A000h`.
The first byte, at `A000:0000`, is the top-left pixel.
The next 319 bytes are the rest of the top row, and byte 320 starts the second row.

This is a little unintuitive compared to 2D Cartesian coordinates.
(0, 0) is top left; (319, 0) is top right; (0, 199) is bottom left; (319, 199) is bottom right.
CRT monitors typically drew scanlines left to right and top to bottom.
So the video card would read through a memory block in that same left to right, top to bottom order.

So the pixel at (x, y) lives at this offset:

```
offset = y * 320 + x
```

Offset meaning we start at `A000:0000` memory address and add the offset to it to get the right pixel.
Write a byte there and the pixel changes colour.
That's really it!
Let's figure out how to do it with 8086 assembly.

## Getting into mode 13h

This first bit is the magic that selects mode 13h.
We need to put 13h (as in 13 in hexadecimal) into the `AL` register, zero into the `AH` register, and call interrupt `10h`.
We can do that by putting `0013h` into the `AX` register like this:

```nasm
        mov ax, 0013h
        int 10h
```

## Pointing a segment register at the screen

To write to `A000:offset` a segment register has to hold `A000h`.
`ES` is the usual choice, because `DS` is busy pointing at the program's own data.

The 8086 has no instruction to load a constant into a segment register, so the value goes through a general register first.

```nasm
        mov di, 0A000h
        mov es, di
```

## Multiplying by 320 without multiplying

The offset needs `y * 320`.
The 8086 has a `mul` instruction, but it is the slowest thing the processor does short of dividing: over a hundred clock cycles for a 16-bit multiply.
By comparison, a register move takes two clock cycles.
`mul` also insists on using `AX` and wipes out `DX`, which we have to work around.

The way out is that 320 is 256 + 64, and both of those are powers of two:

```
y * 320 = y * 256 + y * 64
```

This was the mind-blowing bit to my young brain.
A bit shift moves the bits left or right.
On 8086, the rightmost bit is the least significant.
If I then shift left on a register, I'm essentially multiplying its value by 2.
`shl` shifts left and `shr` shifts right.
Assuming I have my `y` value in the `DX` register and my 'x' value in the 'BX' register, I can do the following:

```nasm
        shl dx, 1               ; DX = y * 2
        shl dx, 1               ; DX = y * 4
        shl dx, 1               ; DX = y * 8
        shl dx, 1               ; DX = y * 16
        shl dx, 1               ; DX = y * 32
        shl dx, 1               ; DX = y * 64
        mov di, dx              ; DI = y * 64
        shl dx, 1               ; DX = y * 128
        shl dx, 1               ; DX = y * 256
        add di, dx              ; DI = y * 64 + y * 256 = y * 320
        add di, bx              ; DI = y * 320 + x
```

This is still **way** faster than a `mul` but maybe there's a better way to do bit shifts?
The multiple `shl`s can be replaced if we use the `CL` register to tell it how many times to shift.

```nasm
        mov cl, 6
        shl dx, cl              ; DX = y * 64
        mov di, dx              ; DI = y * 64
        shl dx, 1               ; DX = y * 128
        shl dx, 1               ; DX = y * 256
        add di, dx              ; DI = y * 64 + y * 256 = y * 320
        add di, bx              ; DI = y * 320 + x
```

For the two shifts to 128 and then 256, it's the same number of instructions to load `CL` with 2 so we'll leave it as-is.
This is where Denthor introduces an even better optimization: multiplying by 256 needs no shift at all.
All you have to do is move the low byte of a register into the high byte.
As long as y fits in a byte, and it does because it is below 200, this turns `DX` into `y * 256`:

```nasm
        mov dh, dl              ; Copy DL to DH
        xor dl, dl              ; Clear DL
```

From there, `y * 64` is `y * 256` shifted right twice.

```nasm
        mov di, dx              ; DI = y * 256
        shr dx, 1               ; DX = y * 128
        shr dx, 1               ; DX = y * 64
        add di, dx              ; DI = y * 320
        add di, bx              ; DI = y * 320 + x
```

But is it really faster?
The best way to tell is to look at a reference of the Intel 8086 instruction set that includes clock cycles.
I found one at https://www.oocities.org/mc_introtocomputers/Instruction_Timing.PDF that I will use to annotate the cycles for each snippet.
Let's start with the `CL`-based shift:

```nasm
        mov cl, 6               ; 4 (IMM -> REG)
        shl dx, cl              ; 8 + 4 * 6 = 32 !!!
        mov di, dx              ; 2
        shl dx, 1               ; 2
        shl dx, 1               ; 2
        add di, dx              ; 3
        add di, bx              ; 3
```

Wait, why is that first `shl` so expensive?
The documentation says the `shl` that uses CL has a baseline overhead of 8 cycles with an added cost of 4 cycles per bit shift.
Which actually means that our previous version with the mulitple `shl dx, 1` was more efficient.
The above snippet is 48 clock cycles.
So how about the second snippet that uses the low byte/high byte trick?

```nasm
        mov dh, dl              ; 2
        xor dl, dl              ; 3
        mov di, dx              ; 2
        shr dx, 1               ; 2
        shr dx, 1               ; 2
        add di, dx              ; 3
        add di, bx              ; 3
```

That's only 17 clock cycles!

## Drawing the pixel

`AL` holds the color value.
It's only one byte and is an index into the palette.
There is a default palette with a wide array of colors so we won't cover the palette here.
Once we've calculated the offset and stored it in `DI`, we can draw the pixel:

```nasm
        mov [es:di], al
```

If you remember from earlier, `ES` is `A000h`, which points to (0, 0) on the screen.
`DI` is the offset that indicates the specific pixel we're after.

## Staying on the screen

Nothing stops a program asking for a pixel at x = 400.
The offset arithmetic would happily produce an address, and the pixel would land somewhere else on the screen, or wrap around the segment.
The multiply-by-256 trick assumes y is below 256, and anything in the high bit (`DH`) disappears. 

So let's check our inputs first, and there is a neat saving here too.
A negative number, read as unsigned, is a very large number: -1 is 65,535.
One unsigned comparison against 320 therefore rejects both x ≥ 320 and x < 0.

```nasm
        cmp bx, 320
        jae .done               ; "jump if above or equal" is the unsigned test
        cmp dx, 200
        jae .done
```

## The whole routine

`BX` is x, `DX` is y, and `AL` is the colour.
Note that the code that calls the `put_pixel` routine has to load these registers first.
The routine saves (`push` onto stack) and restores (`pop` from stacK) all the registers it changes.
This is so that the registers are restored to their previous values for the caller.

```nasm
put_pixel:
        cmp bx, 320
        jae .done
        cmp dx, 200
        jae .done
        push es                 ; push ES onto stack
        push di                 ; push DI onto stack
        push dx                 ; push DX onto stack
        mov di, 0A000h
        mov es, di
        mov dh, dl
        xor dl, dl
        mov di, dx
        shr dx, 1
        shr dx, 1
        add di, dx
        add di, bx
        mov [es:di], al
        pop dx                  ; pop DX from stack
        pop di                  ; pop DI from stack
        pop es                  ; pop ES from stack
.done:  ret
```

You may already be thinking that a great time savings would be to skip the input checks and not preserve the registers on the stack.
The caller has to know that this is how the routine operates.
The easiest concession we could make is to assume that ES is always set to `A000h`.
But that's only if we stay in assembly.
If I'm making this routine as inline assembly to run inside C++ or Pascal code, then I can't make assumptions about the registers.

## Try it

This is that routine running on an emulated 8086.
Change the coordinates or the colours and press **Run**.

{{< playground example="putpixel.asm" >}}

## Are there any built-in put pixel routines?

The BIOS has its own put pixel: interrupt `10h` with `AH = 0Ch`.
It works in every graphics mode, which is the problem.
It has to work out which mode it is in and how that mode stores pixels before it can write anything, and it does that again for every pixel.
I don't know the exact clock cycle count but it's pretty bad.

## When not to call put pixel

A routine like this is the right tool for scattered points.
But it sucks for shapes.
Once the offset of one pixel is known, you just need to add 1 to move right or add 320 to move down.
The best technique for efficient line and circle drawing that I've come across is Bresenham's algorithms.
I thought about writing a post on it, but Michael Abrash has already done it way better than I could.
Bresenham's line drawing algorithm and subsequent optimizations are covered in chapter 35 of Abrash's *Graphics Programming Black Book*, [Bresenham Is Fast, and Fast Is Good](https://www.phatcode.net/res/224/files/html/ch35/35-01.html).
