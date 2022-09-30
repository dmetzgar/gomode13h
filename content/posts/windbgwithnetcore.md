---
title: "Using WinDBG with .NET Core 3"
date: 2020-07-29
tags: ["debug", "dotnetcore"]
---

How to use WinDBG with .NET Core 3

<!--more-->

You'll need the Windows SDK diagnostic tools. To get this, download and install the 
[Windows 10 SDK](https://developer.microsoft.com/en-us/windows/downloads/windows-10-sdk/). The installer will let you
pick which components to install. The only one need is the Debugging Tools component.

One the install is finished, verify that you have WinDBG by running:
`"C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\windbg.exe"`

Next you'll need to install SOS. This is the essential library for using the CLR commands and having access to managed 
data and threads. Run `dotnet tool install -g dotnet-sos`

If you get an error like the one below, it's because you have internal NuGet feeds.
```
C:\Program Files\dotnet\sdk\3.1.301\NuGet.targets(128,5): error : Unable to load the service index for source https://myinternalnugetfeed/nuget/v3/index.json. [C:\Users\myuser\AppData\Local\Temp\xnipo4ei.gp5\restore.csproj]
C:\Program Files\dotnet\sdk\3.1.301\NuGet.targets(128,5): error :   Response status code does not indicate success: 401 (Unauthorized). [C:\Users\myuser\AppData\Local\Temp\xnipo4ei.gp5\restore.csproj]
The tool package could not be restored.
Tool 'dotnet-sos' failed to install. This failure may have been caused by:

* You are attempting to install a preview release and did not use the --version option to specify the version.
* A package by this name was found, but it was not a .NET Core tool.
* The required NuGet feed cannot be accessed, perhaps because of an Internet connection problem.
* You mistyped the name of the tool.

For more reasons, including package naming enforcement, visit https://aka.ms/failure-installing-tool
```

To get around the above error, go into Visual Studio and disable your custom NuGet feeds, run the `dotnet tool` command 
again, then re-enable the feeds.

After the tool is successfully installed, you'll need to install SOS with the `dotnet-sos install` command.
This will give an instruction to run `.load C:\Users\myuser\.dotnet\sos\sos.dll` within the debugger. You'll have to be
attached to a .NET Core process first.

Note that the `!loadby sos coreclr` command no longer works and is no longer needed.

To confirm that sos is working properly, try a few commands. `!pe` will print an exception if you're setup to break on
exception. One trick I use is to print exception on every CLR exception. You can do this by running this command: 
`sxe -c "!pe;g" clr`. This stops on CLR exceptions, prints the exception, then continues (`g`).

Note that it's `clr` and not `coreclr` for listening for managed exceptions.
