---
title: "Editing Azure Cloud Service csdef Files with NuGet"
date: 2014-10-08
tags: ["azure","nuget"]
---

If you want to edit a csdef file in a cloud project from your NuGet package, this can be done using the install.ps1 PowerShell script in the tools directory.
Note that you cannot add NuGet packages directly to a cloud project. Most likely the user will be adding your package to a web or worker role. The 
install script will then have to search the solution for csdef files. You will also want to put in a uninstall script to remove the changes your NuGet package
made.

Let's start with the install.ps1. In the NuGet Package Explorer tool, you can add a tools directory and then an optional subdirectory for the target 
framework. From there, right click on the folder and you should see an option to add install.ps1 to that folder.

The first step is to find the csdef by searching for a file name ServiceDefinition.csdef:

```powershell
param($installPath, $toolsPath, $package, $project)

$sdnamespace = 'http://schemas.microsoft.com/ServiceHosting/2008/10/ServiceDefinition'

$svcConfigFile = $DTE.Solution.Projects|Select-Object -Expand ProjectItems|Where-Object{$_.Name -eq 'ServiceDefinition.csdef'}
$ServiceDefinitionConfig = $svcConfigFile.Properties.Item("FullPath").Value
[xml] $xml = gc $ServiceDefinitionConfig
$nsmgr = New-Object System.Xml.XmlNamespaceManager -ArgumentList $xml.NameTable
$nsmgr.AddNamespace('a',$sdnamespace)
```

Note that the namespace manager is optional depending on what you're doing with the csdef. At this point the csdef has been loaded into an xml
object and we can freely traverse the roles. Let's try to add a configuration setting.

```powershell
#Create configuration setting
$configSettingsNode = $xml.CreateElement('ConfigurationSettings',$sdnamespace)
$settingNode = $xml.CreateElement('Setting',$sdnamespace)
$settingNode.SetAttribute('name','mynewconfigsetting')
$configSettingsNode.AppendChild($settingNode)

foreach($role in $xml.ServiceDefinition.ChildNodes){
    #Check to see if the config settings node exists
    $modified = $role.ConfigurationSettings
    if($modified -eq $null){
        $role.PrependChild($configSettingsNode)
    }
    else{
        $nodeExists = $false
        foreach ($setting in $role.ConfigurationSettings.Setting){
            if ($setting.name -eq 'mynewconfigsetting'){
                $nodeExists = $true
            }
        }
        if ($nodeExists -eq $false){
            $role.ConfigurationSettings.AppendChild($settingNode)
        }
    }
}
```

This loops through all the roles. You could use foreach($role in $xml.ServiceDefinition.WebRole) if you want to target only web roles. 
If there is no ConfigurationSettings node in the role, the code will create one, otherwise it just adds to an existing one.

One particularly weird problem comes up when you try to add to an empty ConfigurationSettings node. It just doesn't work. And due to the 
fact the node is under a namespace, it's tricky to remove the empty node and add your own. Hence the namespace manager that I added 
earlier. The strategy I came up with to fix this problem is to look for the empty node. Here's how that loop looks with this fix:

```powershell
#Create configuration setting
$configSettingsNode = $xml.CreateElement('ConfigurationSettings',$sdnamespace)
$settingNode = $xml.CreateElement('Setting',$sdnamespace)
$settingNode.SetAttribute('name','mynewconfigsetting')
$configSettingsNode.AppendChild($settingNode)

foreach($role in $xml.ServiceDefinition.ChildNodes){
    #Check to see if the config settings node exists
    $modified = $role.ConfigurationSettings
    if($modified -eq $null){
        $role.PrependChild($configSettingsNode)
    }
    elseif(-not $modified.HasChildNodes){
        $removeNode = $role.SelectSingleNode('a:ConfigurationSettings', $nsmgr)
        $role.RemoveChild($removeNode)
        $role.PrependChild($configSettingsNode)
    }
    else{
        $nodeExists = $false
        foreach ($setting in $role.ConfigurationSettings.Setting){
            if ($setting.name -eq 'mynewconfigsetting'){
                $nodeExists = $true
            }
        }
        if ($nodeExists -eq $false){
            $role.ConfigurationSettings.AppendChild($settingNode)
        }
    }
}
```

In this case I explicitly SelectSingleNode with the namespace and remove that node from the role node.

Don't forget that there is a final step to save the altered csdef file:

```powershell
$xml.Save($ServiceDefinitionConfig)
```

That's it for the install script. Let's add an uninstall script to remove the configuration setting.

```powershell
param($installPath, $toolsPath, $package, $project)

$svcConfigFile = $DTE.Solution.Projects|Select-Object -Expand ProjectItems|Where-Object{$_.Name -eq 'ServiceDefinition.csdef'}
$ServiceDefinitionConfig = $svcConfigFile.Properties.Item("FullPath").Value
[xml] $xml = gc $ServiceDefinitionConfig

foreach($role in $xml.ServiceDefinition.ChildNodes){
    $removeSetting = $null
    foreach ($setting in $role.ConfigurationSettings.Setting){
        if ($setting.name -eq 'mynewconfigsetting'){
            $removeSetting = $setting
        }
    }
    if ($removeSetting -ne $null){
        $role.ConfigurationSettings.RemoveChild($removeSetting)
    }
}
$xml.Save($ServiceDefinitionConfig);
```

In the removal script I don't want to bother determining if the node I remove makes the ConfigurationSettings node empty
since I've already dealt with that in the install script.
