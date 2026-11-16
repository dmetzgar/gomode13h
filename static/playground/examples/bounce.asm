; Double buffering: a triangle bounces around the screen.
; Each frame is drawn into the back buffer, then copied to the screen during
; the vertical retrace. Try replacing "call target_buffer" with
; "call target_screen" (and removing "call copy_buffer") to see why.

        org 100h

POINTS  equ 3

start:  call vga_init
        call target_buffer

frame:  mov al, 1                       ; dark blue background
        call clear_buffer

        ; Move every point, reversing its direction at the edges.
        xor si, si
.move:  mov ax, [px + si]
        add ax, [vx + si]
        cmp ax, SCREEN_W - 1
        jb .x_ok
        neg word [vx + si]
        add ax, [vx + si]
.x_ok:  mov [px + si], ax
        mov ax, [py + si]
        add ax, [vy + si]
        cmp ax, SCREEN_H - 1
        jb .y_ok
        neg word [vy + si]
        add ax, [vy + si]
.y_ok:  mov [py + si], ax
        add si, 2
        cmp si, POINTS * 2
        jb .move

        ; Join each point to the next, with a circle on each corner.
        xor bp, bp
.side:  mov bx, [px + bp]
        mov dx, [py + bp]
        mov cx, 6
        mov al, 14
        call draw_circle
        mov si, bp
        add si, 2
        cmp si, POINTS * 2
        jb .wrap
        xor si, si
.wrap:  mov di, [py + si]
        mov si, [px + si]
        mov al, 15
        call draw_line
        add bp, 2
        cmp bp, POINTS * 2
        jb .side

        call wait_retrace
        call copy_buffer

        call key_pressed
        jz frame

        call wait_key
        call vga_done
        ret

px      dw 40, 160, 280
py      dw 30, 170, 60
vx      dw 2, -3, 1
vy      dw 1, 2, -2

%include "vga.inc"
