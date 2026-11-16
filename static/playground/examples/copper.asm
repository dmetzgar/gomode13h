; Copper bars: the screen is one solid colour, and the bars come from
; rewriting that colour's palette entry on every scanline, during the
; horizontal blank. Nothing is drawn after the first frame.

        org 100h

start:  call vga_init

        ; Colour 0 fills the screen already. Add something that stays put.
        mov bx, 160
        mov dx, 100
        mov cx, 70
        mov al, 15
.rings: call draw_circle
        sub cx, 12
        jg .rings

frame:  call wait_retrace
        inc byte [phase]
        mov bl, [phase]                 ; BL = position in the bar pattern
        mov cx, SCREEN_H

.line:  mov dx, 3DAh
.blank: in al, dx                       ; bit 0 set: the beam is in a blank
        test al, 1
        jnz .blank                      ; wait for the line to start drawing
.draw:  in al, dx
        test al, 1
        jz .draw                        ; wait for it to reach the right edge

        mov al, bl                      ; a triangle wave: 0..31..0, twice over
        and al, 63
        cmp al, 32
        jb .up
        xor al, 63
.up:    shl al, 1                       ; AL = 0..62
        mov ah, al
        mov dx, 3C8h
        xor al, al
        out dx, al                      ; palette entry 0
        inc dx
        mov al, ah
        out dx, al                      ; red
        shr al, 1
        out dx, al                      ; green
        mov al, 63
        sub al, ah
        out dx, al                      ; blue

        inc bl
        loop .line

        call key_pressed
        jz frame

        call wait_key
        call vga_done
        ret

phase   db 0

%include "vga.inc"
