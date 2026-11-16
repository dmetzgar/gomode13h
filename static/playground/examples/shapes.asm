; Shapes: every routine in vga.inc, drawn straight to the screen.
; Press a key (click the screen first) to finish.

        org 100h

start:  call vga_init

        ; A fan of lines from the bottom-left corner, one colour each.
        xor si, si                      ; SI = x of the far end
        mov al, 32                      ; first colour of the palette's rainbow
.fan:   xor bx, bx
        mov dx, 199
        xor di, di
        call draw_line
        inc al
        add si, 8
        cmp si, 320
        jb .fan

        ; Concentric circles.
        mov bx, 230
        mov dx, 120
        mov cx, 60
        mov al, 40
.rings: call draw_circle
        add al, 2
        sub cx, 10
        jnz .rings

        ; Paint fill: the innermost circle, and the ring around it.
        mov al, 14
        call flood_fill
        mov bx, 245
        mov al, 1
        call flood_fill

        ; Ellipses: one that looks round on a 4:3 monitor, one that is flat.
        mov bx, 230
        mov dx, 120
        mov cx, 78
        mov si, 65                      ; 5/6 of the horizontal radius
        mov al, 11
        call draw_ellipse
        mov bx, 130
        mov dx, 148
        mov cx, 40
        mov si, 6
        mov al, 13
        call draw_ellipse

        ; A box, filled.
        mov al, 15
        mov bx, 100
        mov dx, 160
        mov si, 160
        mov di, 160
        call draw_line                  ; top
        mov bx, 160
        mov di, 185
        call draw_line                  ; right
        mov dx, 185
        mov si, 100
        call draw_line                  ; bottom
        mov bx, 100
        mov di, 160
        call draw_line                  ; left
        mov bx, 130
        mov dx, 170
        mov al, 4
        call flood_fill

        ; All 256 colours as a strip of pixels along the bottom.
        mov dx, 190
.row:   mov bx, 32
        xor al, al
.strip: call put_pixel
        inc bx
        inc al
        jnz .strip
        inc dx
        cmp dx, 198
        jb .row

        ; get_pixel: copy a block of the fan to the top-right corner.
        xor dx, dx
.copy_y:
        xor bx, bx
.copy_x:
        push bx
        push dx
        add dx, 150
        call get_pixel
        pop dx
        pop bx
        add bx, 270
        call put_pixel
        sub bx, 270
        inc bx
        cmp bx, 48
        jb .copy_x
        inc dx
        cmp dx, 40
        jb .copy_y

        call wait_key
        call vga_done
        ret

%include "vga.inc"
