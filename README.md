# gomode13h

This is the source code for my blog at https://mode19.net

Originally I wrote a custom ASP.NET application for my blog.
Later I converted that to ASP.NET Core.
But I've never needed anything server side for the site, so a static site seemed more appealing.
That's why a static site generator like [Hugo](https://gohugo.io/) makes more sense.
This repo contains the source code, posts, and images for my blog using Hugo.

## Building

1. Install Hugo (`sudo apt install hugo`)
2. Update the submodules (`git submodule update --init`)
3. Run the server (`hugo server -D`)

Hugo will watch for file changes in the directory and recompile the site.
The `-D` flag is to show posts that are marked with `draft: true`.

## Theme

The site uses the `mode13h` theme in `themes/mode13h`, which has four looks: `copper`, `turboc`, `vga`, and `turbo`.
Set the one to publish with `params.variant` in `config.toml`.
Under `hugo server` a picker in the corner of each page (or the keys `1` and `2`) switches between `copper` and `turboc`.
`vga` and `turbo` are hidden from the picker for now; add `?theme=vga` or `?theme=turbo` to a URL to see them.
The previous look is still available by setting `theme = "base16"`.

## Content

Blog posts live in `content/posts`.
Permanent pages live at the top level of `content` and join the menu bar by adding `menu: main` to their front matter.
The games page (`content/games.md`) renders its table from `data/games.yaml`.

## Playground

The playground page (`content/playground.md`) embeds an 8086 emulator and a mode 13h display with the `playground` shortcode.
Everything it needs is in `static/playground`: the CPU core, a NASM-style assembler, the machine (VGA, timing, BIOS and DOS calls), the page script, the `vga.inc` library and the example programs.

Its tests run under Node, with no dependencies:

```
node tests/playground/cpu.test.js
node tests/playground/examples.test.js
node tests/playground/asm-vs-nasm.js
```

The last one compares the assembler's output with real NASM and is skipped if `nasm` is not installed.
