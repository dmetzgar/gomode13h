; Mode X: 320x240 with square pixels, and page flipping instead of a copy.
; Unchaining mode 13h opens up all 256K of video memory as four planes. Each
; byte at A000h is then four pixels side by side, one per plane, so there is
; room for more than one screen. The program draws on the page that is not
; showing, then tells the card to show it.
; Everything is in this one file; vga.inc assumes plain mode 13h.

        org 100h

BOXES   equ 4
SIZE    equ 28                          ; width and height of a box
PAGE    equ 80 * 240                    ; bytes of each plane that one page uses

start:  call set_mode_x
        mov word [draw_page], PAGE      ; page 0 is showing, so draw on page 1

frame:  mov al, 1                       ; dark blue
        call clear_page

        ; Move every box, reversing its direction at the edges, and draw it.
        xor si, si
.box:   mov ax, [box_x + si]
        add ax, [box_dx + si]
        cmp ax, 320 - SIZE              ; unsigned compare: catches negatives too
        jb .x_ok
        neg word [box_dx + si]
        add ax, [box_dx + si]
.x_ok:  mov [box_x + si], ax
        mov ax, [box_y + si]
        add ax, [box_dy + si]
        cmp ax, 240 - SIZE
        jb .y_ok
        neg word [box_dy + si]
        add ax, [box_dy + si]
.y_ok:  mov [box_y + si], ax

        mov bx, [box_x + si]
        mov dx, [box_y + si]
        mov ax, [box_colour + si]
        call draw_box
        add bx, SIZE / 2                ; a single black pixel in the middle
        add dx, SIZE / 2
        xor al, al
        call put_pixel
        add si, 2
        cmp si, BOXES * 2
        jb .box

        call flip

        mov ah, 1                       ; BIOS: is a key waiting?
        int 16h
        jz frame

        xor ah, ah                      ; BIOS: read the key
        int 16h
        mov ax, 0003h                   ; BIOS: back to text mode
        int 10h
        ret

; set_mode_x: start from mode 13h, then reprogram the card for 320x240 unchained.
set_mode_x:
        mov ax, 0013h                   ; BIOS: set video mode 13h
        int 10h

        mov dx, 3C4h                    ; sequencer
        mov ax, 0604h                   ; memory mode: chain-4 off
        out dx, ax
        mov ax, 0100h                   ; hold the sequencer in reset while the clock changes
        out dx, ax
        mov dx, 3C2h                    ; miscellaneous output:
        mov al, 0E3h                    ; the timing for a 480-line display
        out dx, al
        mov dx, 3C4h
        mov ax, 0300h                   ; let the sequencer run again
        out dx, ax

        mov dx, 3D4h                    ; CRT controller
        mov al, 11h                     ; registers 0 to 7 are write-protected
        out dx, al                      ; by bit 7 of register 11h: clear it
        inc dx
        in al, dx
        and al, 7Fh
        out dx, al
        dec dx
        mov si, crtc_values
        mov cx, CRTC_COUNT
        cld
.crtc:  lodsw                           ; AL = register number, AH = its value
        out dx, ax
        loop .crtc

        mov ax, 0A000h
        mov es, ax                      ; ES stays at A000h for the whole program
        mov dx, 3C4h
        mov ax, 0F02h                   ; map mask: write to all four planes at once
        out dx, ax
        xor di, di
        xor ax, ax
        mov cx, 8000h
        rep stosw                       ; clear all 256K
        ret

; clear_page: fill the page being drawn with colour AL.
; With all four planes enabled, every byte written sets four pixels.
clear_page:
        push ax
        mov dx, 3C4h
        mov ax, 0F02h                   ; map mask: all four planes
        out dx, ax
        pop ax
        mov ah, al
        mov di, [draw_page]
        mov cx, PAGE / 2
        cld
        rep stosw
        ret

; put_pixel: BX = x, DX = y, AL = colour, on the page being drawn.
; The byte is at y * 80 + x / 4, and x mod 4 says which plane it is in.
put_pixel:
        push ax
        push cx
        push dx
        push di
        mov ch, al                      ; keep the colour
        mov di, dx
        shl di, 1
        shl di, 1
        shl di, 1
        shl di, 1                       ; DI = y * 16
        mov dx, di
        shl dx, 1
        shl dx, 1                       ; DX = y * 64
        add di, dx                      ; DI = y * 80
        mov dx, bx
        shr dx, 1
        shr dx, 1                       ; DX = x / 4
        add di, dx
        add di, [draw_page]
        mov cl, bl
        and cl, 3                       ; CL = x mod 4
        mov ax, 0102h                   ; AL = map mask register, AH = plane 0
        shl ah, cl                      ; AH = the one plane this pixel is in
        mov dx, 3C4h
        out dx, ax
        mov [es:di], ch
        pop di
        pop dx
        pop cx
        pop ax
        ret

; draw_box: BX = x, DX = y of the top left corner, AL = colour.
; A box is drawn as three strips of bytes: the left edge, the right edge, and
; the full bytes between them, which take four pixels per write. The map mask
; is set once per strip, not once per pixel.
draw_box:
        push ax
        push bx
        push cx
        push dx
        push si
        push di
        push bp
        mov cl, al                      ; CL = colour, for now

        mov di, dx
        shl di, 1
        shl di, 1
        shl di, 1
        shl di, 1                       ; DI = y * 16
        mov dx, di
        shl dx, 1
        shl dx, 1                       ; DX = y * 64
        add di, dx                      ; DI = y * 80
        mov si, bx
        shr si, 1
        shr si, 1                       ; SI = x / 4: the byte holding the left edge
        add di, si
        add di, [draw_page]             ; DI = offset of the top left byte

        mov bp, bx
        add bp, SIZE - 1                ; BP = x of the right edge
        mov dx, bp
        shr dx, 1
        shr dx, 1
        sub dx, si                      ; DX = bytes from the left edge to the right edge
        mov si, bp
        and si, 3
        mov ch, [right_planes + si]     ; CH = planes the right edge byte uses
        and bx, 3
        mov bh, [left_planes + bx]      ; BH = planes the left edge byte uses
        mov bl, cl                      ; BL = colour
        mov bp, dx
        test bp, bp
        jnz .left
        and bh, ch                      ; a narrow box: both edges are in the same byte

.left:  mov ah, bh
        call box_strip
        test bp, bp
        jz .done

        mov ah, ch                      ; the right edge
        add di, bp
        call box_strip
        sub di, bp

        dec bp                          ; BP = full bytes between the edges
        jz .done
        mov dx, 3C4h
        mov ax, 0F02h                   ; map mask: all four planes
        out dx, ax
        inc di
        mov al, bl
        mov dx, SIZE                    ; rows
        cld
.fill:  mov cx, bp
        rep stosb
        add di, 80
        sub di, bp                      ; the same place on the next row
        dec dx
        jnz .fill

.done:  pop bp
        pop di
        pop si
        pop dx
        pop cx
        pop bx
        pop ax
        ret

; box_strip: write colour BL to one byte on each of SIZE rows, starting at DI,
; in the planes given by AH. Changes AL and DX.
box_strip:
        push cx
        push di
        mov al, 02h                     ; map mask register
        mov dx, 3C4h
        out dx, ax
        mov cx, SIZE
.row:   mov [es:di], bl
        add di, 80
        loop .row
        pop di
        pop cx
        ret

; flip: show the page that was just drawn, and draw on the other one next.
; The card picks up a new start address when the vertical retrace begins, so
; the switch never happens part of the way down the screen.
flip:   mov bx, [draw_page]
        mov dx, 3D4h
        mov al, 0Ch                     ; start address, high byte
        mov ah, bh
        out dx, ax
        mov al, 0Dh                     ; start address, low byte
        mov ah, bl
        out dx, ax

        mov dx, 3DAh                    ; wait for the vertical retrace to start
.in_retrace:
        in al, dx
        test al, 8
        jnz .in_retrace
.drawing:
        in al, dx
        test al, 8
        jz .drawing

        xor word [draw_page], PAGE      ; 0 becomes PAGE, PAGE becomes 0
        ret

; The CRTC changes that turn 200 lines into 240, as register and value pairs.
crtc_values:
        dw 0D06h                        ; vertical total
        dw 3E07h                        ; overflow bits
        dw 4109h                        ; cell height: each line drawn twice
        dw 0EA10h                       ; vertical retrace start
        dw 0AC11h                       ; vertical retrace end, and protect again
        dw 0DF12h                       ; vertical display end: line 479
        dw 0014h                        ; underline location: doubleword mode off
        dw 0E715h                       ; vertical blank start
        dw 0616h                        ; vertical blank end
        dw 0E317h                       ; mode control: byte mode on
CRTC_COUNT equ ($ - crtc_values) / 2

draw_page dw 0                          ; offset of the page being drawn: 0 or PAGE

; Planes covered by an edge byte, by x mod 4. Plane 0 is the leftmost pixel.
left_planes  db 1111b, 1110b, 1100b, 1000b      ; from this pixel rightward
right_planes db 0001b, 0011b, 0111b, 1111b      ; up to and including this pixel

box_x      dw 20, 150, 260, 90
box_y      dw 30, 180, 60, 120
box_dx     dw 2, -3, 1, -2
box_dy     dw 1, 2, -2, -3
box_colour dw 14, 12, 10, 15
