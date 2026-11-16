; vga.inc -- mode 13h building blocks, written for a plain 8086.
;
; 320x200, 256 colours, one byte per pixel: the pixel at (x, y) is the byte at
; offset y*320 + x of segment A000h.
;
; The drawing routines write to a "target" segment, which is either the visible
; screen or an off-screen back buffer of the same size. Draw a whole frame into
; the back buffer, then copy it to the screen during the vertical retrace, and
; nothing half-drawn is ever seen.
;
; Conventions: BX = x, DX = y, AL = colour. Every routine preserves all
; registers except the ones it returns a value in. DS must equal CS (as it does
; in a .COM program). Palette components are 6-bit: 0..63.
;
; Include this file after your own code, e.g. as the last line of the program.

VGA_SEG         equ 0A000h
SCREEN_W        equ 320
SCREEN_H        equ 200

target_seg      dw VGA_SEG              ; where the drawing routines write
buffer_seg      dw 0                    ; the back buffer (found by vga_init)
rand_seed       dw 1234h

; ---------------------------------------------------------------------------
; vga_init: switch to mode 13h, locate the back buffer, draw to the screen.
; ---------------------------------------------------------------------------
vga_init:
        push ax
        mov ax, 0013h
        int 10h
        mov ax, cs                      ; the 64K above the program is free memory
        add ax, 1000h
        mov [buffer_seg], ax
        mov word [target_seg], VGA_SEG
        pop ax
        ret

; vga_done: back to 80x25 text mode.
vga_done:
        push ax
        mov ax, 0003h
        int 10h
        pop ax
        ret

; target_screen / target_buffer: choose where the drawing routines write.
target_screen:
        mov word [target_seg], VGA_SEG
        ret

target_buffer:
        push ax
        mov ax, [buffer_seg]
        mov [target_seg], ax
        pop ax
        ret

; ---------------------------------------------------------------------------
; wait_retrace: return at the start of the next vertical retrace.
; ---------------------------------------------------------------------------
wait_retrace:
        push ax
        push dx
        mov dx, 3DAh                    ; VGA input status register
.in_retrace:
        in al, dx
        test al, 8
        jnz .in_retrace                 ; already in a retrace: let it finish
.drawing:
        in al, dx
        test al, 8
        jz .drawing                     ; wait for the next one to start
        pop dx
        pop ax
        ret

; ---------------------------------------------------------------------------
; put_pixel: BX = x, DX = y, AL = colour. Points off the screen are ignored.
; ---------------------------------------------------------------------------
put_pixel:
        cmp bx, SCREEN_W                ; unsigned compare: rejects negatives too
        jae .done
        cmp dx, SCREEN_H
        jae .done
        push es
        push di
        push dx
        mov es, [target_seg]
        mov dh, dl                      ; DX = y * 256  (y < 200, so DH was 0)
        xor dl, dl
        mov di, dx
        shr dx, 1
        shr dx, 1                       ; DX = y * 64
        add di, dx                      ; DI = y * 320
        add di, bx
        mov [es:di], al
        pop dx
        pop di
        pop es
.done:  ret

; ---------------------------------------------------------------------------
; get_pixel: BX = x, DX = y. Returns AL = colour (0 if off the screen).
; ---------------------------------------------------------------------------
get_pixel:
        xor al, al
        cmp bx, SCREEN_W
        jae .done
        cmp dx, SCREEN_H
        jae .done
        push es
        push di
        push dx
        mov es, [target_seg]
        mov dh, dl
        xor dl, dl
        mov di, dx
        shr dx, 1
        shr dx, 1
        add di, dx
        add di, bx
        mov al, [es:di]
        pop dx
        pop di
        pop es
.done:  ret

; ---------------------------------------------------------------------------
; clear_buffer: fill the whole target with colour AL.
; ---------------------------------------------------------------------------
clear_buffer:
        push ax
        push cx
        push di
        push es
        mov es, [target_seg]
        mov ah, al                      ; two pixels per word
        xor di, di
        mov cx, SCREEN_W * SCREEN_H / 2
        cld
        rep stosw
        pop es
        pop di
        pop cx
        pop ax
        ret

; ---------------------------------------------------------------------------
; copy_buffer: copy the back buffer to the screen.
; ---------------------------------------------------------------------------
copy_buffer:
        push ax
        push cx
        push si
        push di
        push ds
        push es
        mov ax, VGA_SEG
        mov es, ax
        mov ds, [buffer_seg]            ; DS changes last: buffer_seg is read through it
        xor si, si
        xor di, di
        mov cx, SCREEN_W * SCREEN_H / 2
        cld
        rep movsw
        pop es
        pop ds
        pop di
        pop si
        pop cx
        pop ax
        ret

; present: wait for the retrace, then copy the back buffer to the screen.
present:
        call wait_retrace
        jmp copy_buffer

; ---------------------------------------------------------------------------
; draw_line: Bresenham line from (BX, DX) to (SI, DI) in colour AL.
; For how and why this works, see Michael Abrash's Graphics Programming Black
; Book, chapter 35: https://www.phatcode.net/res/224/files/html/ch35/35-01.html
; ---------------------------------------------------------------------------
draw_line:
        push bx
        push cx
        push dx
        push bp

        mov cx, 1                       ; step in x: +1 or -1
        mov bp, si
        sub bp, bx                      ; BP = x1 - x0
        jge .dx_done
        neg bp
        mov cx, -1
.dx_done:
        mov [line_dx], bp               ; |x1 - x0|
        mov [line_sx], cx

        mov cx, 1                       ; step in y
        mov bp, di
        sub bp, dx
        jge .dy_done
        neg bp
        mov cx, -1
.dy_done:
        neg bp
        mov [line_dy], bp               ; -|y1 - y0|
        mov [line_sy], cx

        mov bp, [line_dx]
        add bp, [line_dy]               ; BP = error term

.plot:  call put_pixel
        cmp bx, si
        jne .step
        cmp dx, di
        je .done
.step:  mov cx, bp
        shl cx, 1                       ; CX = 2 * error
        cmp cx, [line_dy]
        jl .no_x
        add bp, [line_dy]
        add bx, [line_sx]
.no_x:  cmp cx, [line_dx]
        jg .plot
        add bp, [line_dx]
        add dx, [line_sy]
        jmp .plot

.done:  pop bp
        pop dx
        pop cx
        pop bx
        ret

line_dx dw 0
line_dy dw 0
line_sx dw 0
line_sy dw 0

; ---------------------------------------------------------------------------
; draw_ellipse: BX, DX = centre, CX = horizontal radius, SI = vertical radius,
; AL = colour. Radii up to 255.
;
; A Bresenham-style ellipse (after Alois Zingl): walk one quadrant from the
; left-most point to the top, mirroring every point into the other three, and
; let an error term decide whether to step in x, in y, or both. With
; x = -a..0 and y = 0..b the error is tracked through two running terms,
;       ex = (2x + 1) * b^2     and     ey = (2y + 1) * a^2,
; which grow by 2b^2 and 2a^2 per step, so the loop only adds and compares.
; The terms run into the millions, so they are kept as 32-bit values and
; handled a word at a time (add / adc).
; ---------------------------------------------------------------------------
draw_ellipse:
        push ax
        push bx
        push cx
        push dx
        push si
        push di
        push bp
        mov [ellipse_x], bx
        mov [ellipse_y], dx
        mov [ellipse_colour], al
        mov [ellipse_b], si

        mov ax, cx
        mul cx                          ; DX:AX = a^2
        mov [ellipse_ey], ax            ; ey starts at (2*0 + 1) * a^2
        mov [ellipse_ey + 2], dx
        shl ax, 1
        rcl dx, 1
        mov [ellipse_2aa], ax           ; 2a^2
        mov [ellipse_2aa + 2], dx

        mov ax, si
        mul si                          ; AX = b^2 (fits in a word for b <= 255)
        mov bp, ax
        shl ax, 1
        rcl dx, 1
        mov [ellipse_2bb], ax           ; 2b^2
        mov [ellipse_2bb + 2], dx

        mov ax, cx                      ; ex starts at (2*(-a) + 1) * b^2
        shl ax, 1
        dec ax                          ; AX = 2a - 1
        jns .wide
        mov ax, bp                      ; a = 0: ex is just +b^2
        xor dx, dx
        jmp .have_ex
.wide:  mul bp                          ; DX:AX = (2a - 1) * b^2
        not dx
        neg ax
        sbb dx, -1                      ; negate the 32-bit value
.have_ex:
        mov [ellipse_ex], ax
        mov [ellipse_ex + 2], dx
        add ax, [ellipse_ey]
        adc dx, [ellipse_ey + 2]
        mov [ellipse_err], ax           ; error = ex + ey
        mov [ellipse_err + 2], dx

        mov si, cx
        neg si                          ; SI = x, from -a up to 0
        xor di, di                      ; DI = y, from 0 up to b

.next:  mov al, [ellipse_colour]
        mov bx, [ellipse_x]
        sub bx, si
        mov dx, [ellipse_y]
        add dx, di
        call put_pixel                  ; right, below
        add bx, si
        add bx, si
        call put_pixel                  ; left, below
        sub dx, di
        sub dx, di
        call put_pixel                  ; left, above
        sub bx, si
        sub bx, si
        call put_pixel                  ; right, above

        mov cx, [ellipse_err]
        mov bp, [ellipse_err + 2]
        shl cx, 1
        rcl bp, 1                       ; BP:CX = 2 * error

        cmp bp, [ellipse_ex + 2]        ; if 2*error >= ex: step in x
        jl .no_x
        jg .step_x
        cmp cx, [ellipse_ex]
        jb .no_x
.step_x:
        inc si
        mov ax, [ellipse_ex]
        mov dx, [ellipse_ex + 2]
        add ax, [ellipse_2bb]
        adc dx, [ellipse_2bb + 2]
        mov [ellipse_ex], ax
        mov [ellipse_ex + 2], dx
        add [ellipse_err], ax
        adc [ellipse_err + 2], dx
.no_x:
        cmp bp, [ellipse_ey + 2]        ; if 2*error <= ey: step in y
        jg .no_y
        jl .step_y
        cmp cx, [ellipse_ey]
        ja .no_y
.step_y:
        inc di
        mov ax, [ellipse_ey]
        mov dx, [ellipse_ey + 2]
        add ax, [ellipse_2aa]
        adc dx, [ellipse_2aa + 2]
        mov [ellipse_ey], ax
        mov [ellipse_ey + 2], dx
        add [ellipse_err], ax
        adc [ellipse_err + 2], dx
.no_y:
        or si, si
        jg .tips
        jmp .next                       ; until x passes 0

.tips:  cmp di, [ellipse_b]             ; a very flat ellipse stops early:
        jae .done                       ; finish its top and bottom points
        inc di
        mov al, [ellipse_colour]
        mov bx, [ellipse_x]
        mov dx, [ellipse_y]
        add dx, di
        call put_pixel
        sub dx, di
        sub dx, di
        call put_pixel
        jmp .tips

.done:  pop bp
        pop di
        pop si
        pop dx
        pop cx
        pop bx
        pop ax
        ret

ellipse_x       dw 0
ellipse_y       dw 0
ellipse_b       dw 0
ellipse_colour  db 0
ellipse_ex      dd 0
ellipse_ey      dd 0
ellipse_err     dd 0
ellipse_2aa     dd 0
ellipse_2bb     dd 0

; ---------------------------------------------------------------------------
; draw_circle: BX, DX = centre, CX = radius, AL = colour.
; A circle is an ellipse with both radii equal. Mode 13h pixels are 1.2 times
; taller than wide on a 4:3 monitor, so for a circle that looks round use
; draw_ellipse with a vertical radius 5/6 of the horizontal one.
; ---------------------------------------------------------------------------
draw_circle:
        push si
        mov si, cx
        call draw_ellipse
        pop si
        ret

; ---------------------------------------------------------------------------
; flood_fill: paint fill. Starting at (BX, DX), replace the connected area of
; one colour with colour AL. Works a scanline at a time, keeping the spans
; still to be visited on the stack.
; ---------------------------------------------------------------------------
flood_fill:
        push ax
        push bx
        push cx
        push dx
        push di
        push bp
        push es
        cmp bx, SCREEN_W                ; .exit is too far for a conditional jump
        jb .x_ok
        jmp .exit
.x_ok:  cmp dx, SCREEN_H
        jb .y_ok
        jmp .exit
.y_ok:  mov es, [target_seg]
        mov ah, al                      ; AH = new colour for the moment
        call get_pixel                  ; AL = the colour being replaced
        cmp al, ah
        je .exit                        ; already that colour: nothing to do
        xchg al, ah                     ; AL = new colour, AH = old colour

        xor bp, bp                      ; BP = number of seeds on the stack
        push bx
        push dx
        inc bp

.next_seed:
        or bp, bp
        jz .exit
        pop dx
        pop bx
        dec bp
        push dx                         ; DI = y * 320 + x
        mov dh, dl
        xor dl, dl
        mov di, dx
        shr dx, 1
        shr dx, 1
        add di, dx
        add di, bx
        pop dx
        cmp [es:di], ah
        jne .next_seed

.left:  or bx, bx                       ; walk left to the start of this run
        jz .run
        cmp [es:di-1], ah
        jne .run
        dec di
        dec bx
        jmp .left

.run:   xor cx, cx                      ; CL / CH: a seed is already queued above / below
.fill:  mov [es:di], al

        or dx, dx                       ; look at the row above
        jz .below
        cmp [es:di-SCREEN_W], ah
        jne .above_gap
        or cl, cl
        jnz .below
        mov cl, 1
        dec dx
        push bx
        push dx
        inc dx
        inc bp
        jmp .below
.above_gap:
        xor cl, cl

.below: cmp dx, SCREEN_H - 1            ; and the row below
        jae .advance
        cmp [es:di+SCREEN_W], ah
        jne .below_gap
        or ch, ch
        jnz .advance
        mov ch, 1
        inc dx
        push bx
        push dx
        dec dx
        inc bp
        jmp .advance
.below_gap:
        xor ch, ch

.advance:
        inc bx
        inc di
        cmp bx, SCREEN_W
        jae .next_seed
        cmp [es:di], ah
        je .fill
        jmp .next_seed

.exit:  pop es
        pop bp
        pop di
        pop dx
        pop cx
        pop bx
        pop ax
        ret

; ---------------------------------------------------------------------------
; set_palette_entry: AL = index, AH = red, BL = green, BH = blue.
; ---------------------------------------------------------------------------
set_palette_entry:
        push ax
        push dx
        mov dx, 3C8h                    ; DAC write index
        out dx, al
        inc dx                          ; 3C9h: DAC data, three writes per colour
        mov al, ah
        out dx, al
        mov al, bl
        out dx, al
        mov al, bh
        out dx, al
        pop dx
        pop ax
        ret

; ---------------------------------------------------------------------------
; get_palette_entry: AL = index. Returns AH = red, BL = green, BH = blue.
; ---------------------------------------------------------------------------
get_palette_entry:
        push dx
        mov dx, 3C7h                    ; DAC read index
        out dx, al
        mov dx, 3C9h
        mov bl, al                      ; keep the index
        in al, dx
        mov ah, al                      ; red
        in al, dx
        xchg al, bl                     ; BL = green, AL = index again
        push ax
        in al, dx
        mov bh, al                      ; blue
        pop ax
        pop dx
        ret

; ---------------------------------------------------------------------------
; load_palette: set all 256 colours from the 768 bytes at DS:SI
; (red, green, blue for colour 0, then colour 1, ...).
; ---------------------------------------------------------------------------
load_palette:
        push ax
        push cx
        push dx
        push si
        mov dx, 3C8h
        xor al, al
        out dx, al                      ; start at colour 0; the index advances by itself
        inc dx
        mov cx, 768
        cld
.next:  lodsb
        out dx, al
        loop .next
        pop si
        pop dx
        pop cx
        pop ax
        ret

; ---------------------------------------------------------------------------
; save_palette: store all 256 colours into the 768 bytes at ES:DI.
; ---------------------------------------------------------------------------
save_palette:
        push ax
        push cx
        push dx
        push di
        mov dx, 3C7h
        xor al, al
        out dx, al
        mov dx, 3C9h
        mov cx, 768
        cld
.next:  in al, dx
        stosb
        loop .next
        pop di
        pop dx
        pop cx
        pop ax
        ret

; ---------------------------------------------------------------------------
; random: returns AX = the next pseudo-random number. AH is the better byte.
; ---------------------------------------------------------------------------
random:
        push dx
        mov ax, [rand_seed]
        mov dx, 25173
        mul dx
        add ax, 13849
        mov [rand_seed], ax
        pop dx
        ret

; key_pressed: ZF clear if a key is waiting.  wait_key: returns AX = the key.
key_pressed:
        push ax
        mov ah, 1
        int 16h
        pop ax
        ret

wait_key:
        xor ah, ah
        int 16h
        ret
