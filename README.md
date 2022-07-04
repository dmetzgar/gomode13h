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
