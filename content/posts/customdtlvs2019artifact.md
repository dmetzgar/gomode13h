---
title: "Creating a custom DevTest Labs artifact for Visual Studio 2019"
date: 2020-05-28
tags: ["DevTest Labs", "Azure", "Visual Studio"]
---

One way to build a custom DevTest Labs artifact to install Visual Studio 2019.

<!--more-->

The public artifacts repo for DevTest Labs includes a Visual Studio artifact. But it only supports
VS2015 and VS2017. The easiest way to work around this is to use the Chocolatey artifact with the 
"visualstudio2019enterprise" target. This only installs the core editor workload though and the 
Chocolatey artifact doesn't allow specifying options.

For my team's environment, we have a specific set of workloads and individual components that are 
generally needed. Specifying these all on the command line is a lot of text and it's easy to make
mistakes.

The solution I took was to make a custom artifact that uses Chocolatey and passes in a config file
that specifies all the workloads and individual components needed. Here are the steps I took.

## Export the desired Visual Studio 2019 configuration

Get VS2019 configured the way you want first. Then open the Visual Studio Installer.

![Selecting export configuration in VS Installer](/img/customdtlvs2019artifact_exportconfig.png "Selecting export configuration in VS Installer")

Click More next to VS2019 and select Export Configuration. Save the resulting **.vsconfig** file 
to your new artifact folder.

## Create the artifact file

Since my custom artifact doesn't need customization, I used a base **Artifactfile.json** file.

```json
{
  "$schema": "https://raw.githubusercontent.com/Azure/azure-devtestlab/master/schemas/2016-11-28/dtlArtifacts.json",
  "title": "Visual Studio 2019 Enterprise",
  "description": "Installs Visual Studio 2019 Enterprise using the Chocolatey package manager",
  "publisher": "Dustin Metzgar",
  "tags": [
    "Windows",
    "Visual Studio"
  ],
  "iconUri": "https://devblogs.microsoft.com/visualstudio/wp-content/uploads/sites/4/2019/01/visualstudio-1.png",
  "targetOsType": "Windows",
  "runCommand": {
    "commandToExecute": "[concat('powershell.exe -ExecutionPolicy bypass \"& ./install-choco-package.ps1\"')]"
  }
}
```

I use the same iconUri as the public Visual Studio artifact. The command calls a PowerShell script 
to install the Chocolatey package.

## Write the install script

I started by copying the install script from the public Chocolatey artifact. Then I removed the 
script parameters and changed the *Install-Packages* function.

```powershell
function Install-Packages
{
    [CmdletBinding()]
    param(
        [string] $ChocoExePath
    )

    $configFilePath = Get-ChildItem .\my.vsconfig | % { $_.FullName }
    $expression = "$ChocoExePath install -y -f --acceptlicense --no-progress --stoponfirstfailure visualstudio2019enterprise --package-parameters=`"--config $configFilePath`""
    Invoke-ExpressionImpl -Expression $expression
}
```

The config file is passed to the Visual Studio installer via the `--config` option. But this needs
to be wrapped in `--package-parameters` so Chocolatey will send it to the installer.

The full file is in this Gist for convenience:

{{< gist dmetzgar 0d4f9ea93dacf11fe9d545f7e94748a7 >}}
