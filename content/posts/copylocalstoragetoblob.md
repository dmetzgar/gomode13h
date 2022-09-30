---
title: "Azure Diagnostics: Backup Local Storage to Blob"
date: 2014-11-20
tags: ["azure"]
---

Windows Azure Diagnostics gives you the ability to watch directories on your cloud services and copy the files within to a 
blob container automatically. This is great for archiving things like IIS logs. IIS logs are a special case that you can 
turn on with a switch, but if you have some other custom logs that you would like to persist to blob storage, it's fairly
easy to do this.

# Setup local storage
The place to start is by creating a local storage folder. Add the following in the csdef file for your web/worker role:

```xml
<LocalResources>
  <LocalStorage name="DiagnosticStore" sizeInMB="4096" cleanOnRoleRecycle="false" />
  <LocalStorage name="WcfLogs" sizeInMB="1000" cleanOnRoleRecycle="true" />
</LocalResources>
```

Notice that I set the DiagnosticsStore explicitly. You must do this or Azure will reject this when you try to deploy.

# Azure SDK 2.4 and earlier
If you're using Azure SDK 2.4 and earlier, the diagnostics change is made in code. Add the following method to your 
RoleEntryPoint class.

```csharp
private void ConfigureWcfLogStorage()
{
    LocalResource profileStorage;
    try
    {
        profileStorage = RoleEnvironment.GetLocalResource("WcfLogs");
    }
    catch (RoleEnvironmentException e)
    {
        throw new InvalidOperationException("Local storage \"WcfLogs\" not found.", e);
    }
    var ridm = new RoleInstanceDiagnosticManager(
        CloudConfigurationManager.GetSetting("SomeStorageConnectionString"),
        RoleEnvironment.DeploymentId,
        RoleEnvironment.CurrentRoleInstance.Role.Name,
        RoleEnvironment.CurrentRoleInstance.Id);
    var dmc = ridm.GetCurrentConfiguration() ?? DiagnosticMonitor.GetDefaultInitialConfiguration();
    DirectoryConfiguration directoryConfig;
    directoryConfig = new DirectoryConfiguration()
    {
        Container = "wcflogsblobcontainer",
        Path = profileStorage.RootPath,
    };
    dmc.Directories.DataSources.Add(directoryConfig);
    dmc.Directories.ScheduledTransferPeriod = TimeSpan.FromMinutes(1.0);
    ridm.SetCurrentConfiguration(dmc);
}
```

This will tell Azure Diagnostics to check the WcfLogs local storage path every minute for changes. New or 
updated files will be persisted to the wcflogsblobcontainer container in the storage account you set. You
won't be able to set a faster transfer period than 1 minute.

The only thing left to do is call this method in your RoleEntryPoint's OnStart.

# Azure SDK 2.5 and later
In Azure SDK 2.5, you can no longer make the diagnostics change through code. Now it must be done through 
the diagnostics.wadcfgx file. In the solution explorer, find your Azure cloud project, expand the roles,
right click on the role you want and select Properties. Click on Configure under Diagnostics:

![Configure button in the Diagnostics section of Properties](/img/CopyLocalStorageToBlob_ConfigDiag.png "Configure button in the Diagnostics section of Properties")

From there, go to the Log Directories tab. There is not an option available to log from a local storage
folder, so you have to use an absolute directory. You would think that since it can expand environment
variables that the typical Azure environment variables could be used like this:

```
C:\Resources\Directory\%RoleDeploymentID%.%RoleName%.LocalStorageName
```

However, that's not the case. I tried several different ways to get to the local storage directory but
was unsuccessful. So, you have to use an absolute path. The C: drive is where all the local storage 
goes. So you would have to enter something like C:\WcfLogs to the textbox at the bottom and click 
Add Directory.

![Specifying log directories](/img/CopyLocalStorageToBlob_LogDirectories.png "Specifying log directories")

After it's added, make sure to set the container name.

The next issue is that Azure diagnostics will create the C:\WcfLogs directory for you on startup but
won't add ACLs for the Network Service user. You'll have to do this yourself by adding a startup 
task to your role. Add a .bat file to the web or worker role project that is set to copy always.
The batch file should contain something like:

```
md c:\WcfLogs
icacls c:\WcfLogs /grant "Network Service":(M,WDAC) /T
```

Add a startup task for it in your csdef:
```xml
<Startup>
  <Task commandLine="CreateWcfLogs.bat" executionContext="elevated" taskType="simple" />
</Startup>
```

In case you had the thought of creating a symbolic link from c:\WcfLogs to the 
C:\Resources\Directory\%RoleDeploymentID%.%RoleName%.WcfLogs local storage folder, this won't
work. The problem is that Azure Diagnostics will plow over it and replace it with a regular 
folder.
