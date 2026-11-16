; Fire: the classic. Random heat along the bottom row; every pixel above
; becomes the average of the pixels below it, cooled a little.
; The whole effect lives in the back buffer and is copied to the screen each
; frame. On a real 8086 this would crawl; here the CPU runs as fast as your
; browser allows.

        org 100h

TOP     equ 136                         ; the fire occupies rows TOP..199
ROWS    equ SCREEN_H - TOP

start:  call vga_init
        call target_buffer
        xor al, al
        call clear_buffer

        ; Palette: black -> red -> yellow -> white.
        xor al, al
.pal:   xor bx, bx
        mov ah, al
        cmp al, 64
        jb .set                         ; 0..63: red rises
        mov ah, 63
        mov bl, al
        sub bl, 64
        cmp al, 128
        jb .set                         ; 64..127: green rises
        mov bl, 63
        mov bh, al
        sub bh, 128
        shr bh, 1
        cmp al, 192
        jb .set                         ; 128..255: blue rises, half as fast
.set:   and ah, 63
        call set_palette_entry
        inc al
        jnz .pal

frame:  mov es, [buffer_seg]

        ; Fuel: the bottom two rows are randomly hot or cold.
        mov di, (SCREEN_H - 2) * SCREEN_W
        mov cx, SCREEN_W * 2
.fuel:  call random
        mov al, ah
        cbw                             ; AH = 0 or 255 depending on the top bit
        mov al, ah
        stosb
        loop .fuel

        ; Spread upwards.
        push ds
        push es
        pop ds                          ; DS = back buffer for the inner loop
        mov si, TOP * SCREEN_W
        mov cx, (ROWS - 2) * SCREEN_W
        xor dh, dh
        xor ah, ah
.burn:  mov al, [si + SCREEN_W - 1]
        mov dl, [si + SCREEN_W]
        add ax, dx
        mov dl, [si + SCREEN_W + 1]
        add ax, dx
        mov dl, [si + SCREEN_W * 2]
        add ax, dx
        shr ax, 1
        shr ax, 1                       ; average of the four
        sub al, 3                       ; cool down
        jnc .store
        xor al, al
.store: mov [si], al
        inc si
        xor ah, ah
        loop .burn
        pop ds

        call present

        call key_pressed
        jz frame

        call wait_key
        call vga_done
        ret

%include "vga.inc"
