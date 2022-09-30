---
title: "How to hash passwords in PowerShell with ASP.NET Core Identity PasswordHasher"
date: 2021-10-14
tags: ["powershell", "aspnet"]
---

Calling .NET types from PowerShell is not always as straightforward as it
seems. Here's how I was able to use the
[PasswordHasher](https://docs.microsoft.com/dotnet/api/microsoft.aspnetcore.identity.passwordhasher-1)
to generate a hash compatible with ASP.NET Core Identity's AspNetUsers table.

<!--more-->

First, gather the NuGet package for Microsoft.Extensions.Identity.Core and all
of its dependencies.

- [Microsoft.Extensions.Identity.Core](https://www.nuget.org/packages/Microsoft.Extensions.Identity.Core)
- [Microsoft.Extensions.Options](https://www.nuget.org/packages/Microsoft.Extensions.Options)
- [Microsoft.Extensions.Logging.Abstractions](https://www.nuget.org/packages/Microsoft.Extensions.Logging.Abstractions)
- [Microsoft.Extensions.DependencyInjection.Abstractions](https://www.nuget.org/packages/Microsoft.Extensions.DependencyInjection.Abstractions)
- [Microsoft.Extensions.Primitives](https://www.nuget.org/packages/Microsoft.Extensions.Primitives)
- [System.Memory](https://www.nuget.org/packages/System.Memory)

Pick a runtime and gather the DLLs into a folder called "References" under the
folder with your PowerShell script. I chose net461 but it depends on your
platform.

Here's the function to get a password hash:

```powershell
<#
    .SYNOPSIS
    Gets the hashed password.

    .DESCRIPTION
    Hashes the password with the same class used by ASP.NET Core Identity.

    .PARAMETER Password
    The new password.

    .OUTPUTS
    string. The hashed password.
#>
function Get-PasswordHash {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Password
    )

    [string]$assemblyBasePath = "$PSScriptRoot\References"

    Add-Type -Path "$assemblyBasePath\System.Memory.dll"
    Add-Type -Path "$assemblyBasePath\Microsoft.Extensions.Primitives.dll"
    Add-Type -Path "$assemblyBasePath\Microsoft.Extensions.DependencyInjection.Abstractions.dll"
    Add-Type -Path "$assemblyBasePath\Microsoft.Extensions.Logging.Abstractions.dll"
    Add-Type -Path "$assemblyBasePath\Microsoft.Extensions.Options.dll"
    Add-Type -Path "$assemblyBasePath\Microsoft.Extensions.Identity.Core.dll"

    $hasherOptions = New-Object Microsoft.AspNetCore.Identity.PasswordHasherOptions
    $createMethod = [Microsoft.Extensions.Options.Options].GetMethod("Create").MakeGenericMethod([Microsoft.AspNetCore.Identity.PasswordHasherOptions])
    $hasherIOptions = $createMethod.Invoke($null, ($hasherOptions)) 
    $hasher = New-Object -TypeName 'Microsoft.AspNetCore.Identity.PasswordHasher[System.String]' -ArgumentList ($hasherIOptions)
    return $hasher.HashPassword($null, $Password)
}
```

The constructor for `PasswordHasher` defaults the options to `null`. However,
PowerShell kept complaining it couldn't find a constructor. So the code creates
a `PasswordHasherOptions` instance and calls
[Options.Create](https://docs.microsoft.com/dotnet/api/microsoft.extensions.options.options.create).
Also note that the generic for `PasswordHasher` is `string`. This is the type
of the user. A brief look at
[the code](https://github.com/dotnet/aspnetcore/blob/main/src/Identity/Extensions.Core/src/PasswordHasher.cs)
shows that the default implementation doesn't use the user type/object for
anything.

When it comes to adding the types, they have to be added in the right order.
PowerShell was not able to automatically pull in other assemblies in the same
path based on dependencies.

If you're using Visual Studio Code, it may suggest using `SecureString` for the
Password parameter.
[The .NET SecureString is being retired though.](https://github.com/dotnet/platform-compat/blob/master/docs/DE0001.md)
