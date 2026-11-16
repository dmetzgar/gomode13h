; Put pixel test
; Everything is in this one file; it does not use vga.inc.

        org 100h

start:  mov ax, 0013h                   ; BIOS: set video mode 13h
        int 10h
        mov di, 0A000h
        mov es, di                      ; Set ES to A000h

        ; One white pixel in the middle of the screen.
        mov bx, 160
        mov dx, 100
        mov al, 15
        call put_pixel

        ; A diagonal: x = y, and the colour follows y too.
        xor dx, dx
.diag:  mov bx, dx
        mov al, dl
        call put_pixel
        inc dx
        cmp dx, 200
        jb .diag

        ; All 256 colours side by side along row 190.
        mov dx, 190
        xor bx, bx
.row:   mov al, bl
        call put_pixel
        inc bx
        cmp bx, 256
        jb .row

        xor ah, ah                      ; BIOS: wait for a key
        int 16h
        mov ax, 0003h                   ; BIOS: back to text mode
        int 10h
        ret

; put_pixel: BX = x, DX = y, AL = colour. Optimized.
put_pixel:
        push dx
        mov dh, dl                      ; DX = y * 256
        xor dl, dl
        mov di, dx
        shr dx, 1
        shr dx, 1                       ; DX = y * 64
        add di, dx                      ; DI = y * 320
        add di, bx                      ; DI = y * 320 + x
        mov [es:di], al
        pop dx
.done:  ret
