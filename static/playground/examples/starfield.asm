; Starfield: stars fly out of the middle of the screen and past the camera.
; There is no back buffer. Once the frame has been drawn, every star is painted
; over in black, moved, and drawn again before the next frame starts.
; Everything is in this one file; it does not use vga.inc.

        org 100h

STARS   equ 120                         ; how many stars
SPEED   equ 2                           ; how far each star moves toward the camera per frame

MAX_Z   equ 255                         ; distance at which a new star appears
MID_Z   equ 180                         ; closer than this, a star is a 2x2 box
NEAR_Z  equ 110                         ; closer than this, a star is a 3x3 plus
COLOUR  equ 15                          ; white

start:  mov ax, 0013h                   ; BIOS: set video mode 13h
        int 10h
        mov di, 0A000h
        mov es, di                      ; ES stays at A000h for the whole program

        xor ah, ah                      ; BIOS: read the clock, to seed the random numbers
        int 1Ah
        mov [seed], dx

        ; Scatter the stars through the whole depth, so they do not arrive in a wave.
        xor si, si
.init:  call new_star
        mov cx, MAX_Z
        call random_below
        inc ax                          ; 1..MAX_Z
        mov [star_z + si], ax
        mov word [star_size + si], 0    ; not on the screen yet
        add si, 2
        cmp si, STARS * 2
        jb .init

frame:  mov dx, 3DAh                    ; wait for the vertical retrace to start
.in_retrace:
        in al, dx
        test al, 8
        jnz .in_retrace
.drawing:
        in al, dx
        test al, 8
        jz .drawing

        ; Paint over every star in black. This has to finish before any star is
        ; redrawn, or erasing one star could punch a hole in a neighbour.
        xor si, si
.erase: mov cx, [star_size + si]
        jcxz .gone
        mov di, [star_at + si]
        xor al, al
        call draw_star
.gone:  add si, 2
        cmp si, STARS * 2
        jb .erase

        ; Move every star and draw it in its new place.
        xor si, si
.move:  mov word [star_size + si], 0    ; until it is drawn again
        sub word [star_z + si], SPEED
        jg .project
        call new_star                   ; it passed the camera: start again far away

        ; Perspective: screen position = position * 64 / distance, from the centre.
.project:
        mov ax, [star_y + si]
        mov cl, 6
        shl ax, cl
        cwd
        idiv word [star_z + si]
        add ax, 100
        cmp ax, 200 - 2                 ; unsigned compare: rejects negatives too
        jae .lost
        mov bp, ax                      ; BP = screen y

        mov ax, [star_x + si]
        shl ax, cl
        cwd
        idiv word [star_z + si]
        add ax, 160
        cmp ax, 320 - 2
        jae .lost
        mov bx, ax                      ; BX = screen x
        mov dx, bp
        call pixel_offset
        mov [star_at + si], di

        mov cx, 1                       ; the closer the star, the bigger it is
        cmp word [star_z + si], MID_Z
        jae .sized
        inc cx
        cmp word [star_z + si], NEAR_Z
        jae .sized
        inc cx
.sized: mov [star_size + si], cx
        mov al, COLOUR
        call draw_star
        jmp .next

.lost:  call new_star                   ; it left the screen: start again far away

.next:  add si, 2
        cmp si, STARS * 2
        jb .move

        mov ah, 1                       ; BIOS: is a key waiting?
        int 16h
        jnz .quit
        jmp frame                       ; too far back for a conditional jump

.quit:  xor ah, ah                      ; BIOS: read the key
        int 16h
        mov ax, 0003h                   ; BIOS: back to text mode
        int 10h
        ret

; pixel_offset: BX = x, DX = y. Returns DI = y * 320 + x. Changes DX.
; This is put_pixel without the write.
pixel_offset:
        mov dh, dl                      ; DX = y * 256
        xor dl, dl
        mov di, dx
        shr dx, 1
        shr dx, 1                       ; DX = y * 64
        add di, dx                      ; DI = y * 320
        add di, bx                      ; DI = y * 320 + x
        ret

; draw_star: DI = offset of the star's top left corner, CX = size (1 to 3),
; AL = colour. Changes AH.
;
;       1: #    2: ##   3: .#.
;                  ##      ###
;                          .#.
draw_star:
        cmp cx, 2
        jb .dot
        je .box
        mov ah, al
        mov [es:di + 1], al             ; top
        mov [es:di + 320], ax           ; left and middle
        mov [es:di + 322], al           ; right
        mov [es:di + 641], al           ; bottom
        ret
.box:   mov ah, al
        mov [es:di], ax
        mov [es:di + 320], ax
        ret
.dot:   mov [es:di], al
        ret

; new_star: give star SI a random place, as far away as stars go. Changes AX, CX, DX.
; At that distance the whole range fits in the middle half of the screen.
new_star:
        mov cx, 640
        call random_below
        sub ax, 320
        mov [star_x + si], ax           ; -320..319
        mov cx, 400
        call random_below
        sub ax, 200
        mov [star_y + si], ax           ; -200..199
        mov word [star_z + si], MAX_Z
        ret

; random_below: CX = n. Returns AX = a random number from 0 to n - 1. Changes DX.
random_below:
        mov ax, [seed]
        mov dx, 25173
        mul dx
        add ax, 13849
        mov [seed], ax
        mul cx                          ; DX = seed * n / 65536
        mov ax, dx
        ret

seed    dw 0

; One word per star in each table.
star_x: resw STARS                      ; position, with 0, 0 in the middle of the view
star_y: resw STARS
star_z: resw STARS                      ; distance from the camera
star_at: resw STARS                     ; where it was drawn: an offset into the screen
star_size: resw STARS                   ; how big it was drawn; 0 if it was not
