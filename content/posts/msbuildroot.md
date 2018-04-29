---
title: "Finding the Root Build Folder with MSBuild"
date: 2014-10-08
tags: ["MSBuild"]
---

This is a common practice that I find in Microsoft projects. In MSBuild you sometimes want to get to the root folder of where all your projects are checked in. There is no automatic way to do this. However, you can make it happen by doing the following.

First, find the root folder of your build. Add a file there called build.root. The name of the file doesn't matter, but build.root makes it obvious. It also helps to put some text into the file that indicates that it's a placeholder for the root build folder. Be sure to add the file to source control.

Then in your proj file, use the following:

```xml
<PropertyGroup>
  <BuildRoot>$([MSBuild]::GetDirectoryNameOfFileAbove($(MSBuildThisFileDirectory), build.root))</BuildRoot>
</PropertyGroup>
```

Now you have a property called BuildRoot that you can use like this:

```xml
<Import Project="$(BuildRoot)\Build\Common.Build.References.settings" />
```
