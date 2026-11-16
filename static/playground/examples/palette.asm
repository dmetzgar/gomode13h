; Palette cycling: the picture is drawn once and never touched again.
; All the movement comes from rotating the palette.

        org 100h

start:  call vga_init

        ; Colours 1..255: a smooth loop black -> red -> yellow -> blue -> black.
        mov al, 1
.ramp:  mov cl, al
        dec cl                          ; CL = 0..254
        mov ch, cl
        and ch, 63                      ; CH = position inside a quarter, 0..63
        mov dl, 63
        sub dl, ch                      ; DL = 63 - CH
        xor bx, bx
        mov ah, bl
        cmp cl, 64
        jae .q2
        mov ah, ch                      ; black to red
        jmp .set
.q2:    cmp cl, 128
        jae .q3
        mov ah, 63                      ; red to yellow
        mov bl, ch
        jmp .set
.q3:    cmp cl, 192
        jae .q4
        mov ah, dl                      ; yellow to blue
        mov bl, dl
        mov bh, ch
        jmp .set
.q4:    mov bh, dl                      ; blue to black
.set:   call set_palette_entry
        inc al
        jnz .ramp

        ; The picture: diamonds. colour = 1 + (|x - 160| + |y - 100|) mod 255
        mov ax, VGA_SEG
        mov es, ax
        xor di, di
        xor dx, dx                      ; DX = y
.row:   mov bp, dx
        sub bp, 100
        jns .y_abs
        neg bp
.y_abs: xor bx, bx                      ; BX = x
.col:   mov ax, bx
        sub ax, 160
        jns .x_abs
        neg ax
.x_abs: add ax, bp
        mov cl, 255
        div cl                          ; AH = distance mod 255
        mov al, ah
        inc al
        stosb
        inc bx
        cmp bx, SCREEN_W
        jb .col
        inc dx
        cmp dx, SCREEN_H
        jb .row

        ; Animate: read the palette, rotate colours 1..255 by one place, write it back.
        push ds
        pop es
cycle:  call wait_retrace
        mov di, colours
        call save_palette
        mov ax, [colours + 3]           ; remember colour 1...
        mov [first], ax
        mov al, [colours + 5]
        mov [first + 2], al
        mov si, colours + 6             ; ...move 2..255 down one place...
        mov di, colours + 3
        mov cx, 254 * 3
        cld
        rep movsb
        mov ax, [first]                 ; ...and put the old colour 1 at the end
        stosw
        mov al, [first + 2]
        stosb
        mov si, colours
        call load_palette

        call key_pressed
        jz cycle

        call wait_key
        call vga_done
        ret

first   db 0, 0, 0
colours times 768 db 0

%include "vga.inc"
