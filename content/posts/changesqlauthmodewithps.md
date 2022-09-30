---
title: "Changing SQL Authentication Mode with PowerShell"
date: 2020-06-02
tags: ["powershell", "sqlserver"]
---

A PowerShell script to change the SQL authentication mode and a DevTest Labs artifact built upon it.

<!--more-->

## PowerShell script

We'll start with the basic script.
This script uses the SQL Server Management Objects. SMO is installed with SQL Server Management 
Studio (SSMS) but it can also be installed via the PowerShell **SqlServer** module. If you're 
using an Azure VM with a SQL Server base image, SMO is already available.

```powershell
[CmdletBinding()]
param(
    [Parameter(Mandatory=$True)]
    [ValidateNotNullOrEmpty()]
    [ValidateSet('Integrated','Mixed','Normal')]
    [string] $AuthMode,

    [ValidateNotNullOrEmpty()]
    [string] $Server = 'localhost'
)


# Connect to the local SQL instance using SMO
[System.Reflection.Assembly]::LoadWithPartialName('Microsoft.SqlServer.SMO') | out-null
$s = new-object('Microsoft.SqlServer.Management.Smo.Server') $Server
[string]$nm = $s.Name
[string]$mode = $s.Settings.LoginMode

# Change to Mixed Mode
$s.Settings.LoginMode = [Microsoft.SqlServer.Management.SMO.ServerLoginMode] $AuthMode
$s.Alter()

# Restart SQL Server to apply changes
Restart-Service -Name MSSQLSERVER
```

Since the Microsoft.SqlServer.SMO assembly may not yet be loaded, using the ServerLoginMode enum 
as a parameter type may fail. Hence the use of a string with a ValidateSet. I've no idea what 
"Normal" means and didn't bother trying it. PowerShell can convert the string to an enum by 
casting.

The Restart-Service call will work with a default install of SQL Server but may need to be set 
as a parameter in other instances.

## Creating a custom DTL artifact

I need to use this script to change the SQL Server installed in the base VM images to use mixed 
mode authentication. So I wrote a custom DTL artifact. Here is the artifact file:

```json
{
    "$schema": "https://raw.githubusercontent.com/Azure/azure-devtestlab/master/schemas/2016-11-28/dtlArtifacts.json",
    "title": "Change the SQL Server authentication mode",
    "description": "Change the SQL Server authentication mode",
    "publisher": "Dustin Metzgar",
    "tags": [
        "SQL Server"
    ],
    "targetOsType": "Windows",
    "parameters": {
        "AuthMode": {
            "type": "string",
            "displayName": "Authentication Mode",
            "description": "The authentication mode to set the local SQL Server instance to.",
            "defaultValue": "Mixed",
            "allowedValues": [
              "Integrated",
              "Mixed"
            ]
        },
        "Server": {
          "type": "string",
          "displayName": "Optional server name",
          "description": "Server to apply the authentication mode change to (defaults to localhost).",
          "defaultValue": "",
          "allowEmpty": true
        }
    },
    "runCommand": {
        "commandToExecute": "[concat('powershell.exe -ExecutionPolicy bypass \"& ./SetSqlAuthMode.ps1 ', parameters('AuthMode'), ' ', parameters('Server'), '\"')]"
    }
}
```

Since I don't know what "Normal" does, I dropped it from the list of values in the artifact 
parameter. The PowerShell script has the `[CmdletBinding]` attribute so the parameters don't need
the names in front. That means the Server parameter can be blank in the attribute.

## How to get the script working in DevTest Labs

If you run the script by itself while logged into an Azure VM, it will work. But using it as-is in
a DevTest Labs artifact will fail. I added the snippet below to get more details on the exception:

```powershell
# Handle all script errors
trap
{
    $exc = $Error[0].Exception
    do {
        $message = $exc.Message
        if ($message)
        {
            Write-Host -Object "ERROR: $message" -ForegroundColor Red
        }
        $exc = $exc.InnerException
    } while ($exc)

    Write-Host "`nThe artifact failed to apply.`n"
    exit -1
}
```

This allows me to see the root cause:

```
ERROR: Exception calling "Alter" with "0" argument(s): "Alter failed for Server 'myvmname'. "

ERROR: Alter failed for Server 'myvmname'. 

ERROR: An exception occurred while executing a Transact-SQL statement or batch.

ERROR: The EXECUTE permission was denied on the object 'xp_instance_regwrite', database 'mssqlsystemresource', schema 'sys'.

The artifact failed to apply.
```

The reason for this has to do with the user account that is applying the artifacts. It's not an 
actual user that you can grant sysadmin privileges to. An artifact has admin rights on the Azure VM
but not admin rights to SQL Server.

Luckily there is a way to get around this. SQL Server has a way to allow an admin on the host 
machine access called single-user mode. See [this article](https://docs.microsoft.com/sql/database-engine/configure-windows/connect-to-sql-server-when-system-administrators-are-locked-out)
for more information on how it works.

The first step is to shut down the database server. Since only a single user can access the server
at a time, any services that could connect to it should be shut down as well.

```powershell
Stop-Service -Name MSSQLFDLauncher
Stop-Service -Name MsDtsServer150
Stop-Service -Name MSSQLSERVER
```

The next step is to start the server with the "-m" option:

```powershell
$sqlJob = Start-Job -Name Sql -ScriptBlock {
  & 'C:\Program Files\Microsoft SQL Server\MSSQL15.MSSQLSERVER\MSSQL\Binn\sqlservr.exe' -m
}
```

The SQL Server stays alive as long as the process is running so I need to start it in a separate
job. I hold onto the job object so I can stop it after making the changes. Then I can turn the 
services back on.

```powershell
$sqlJob.StopJob()

Start-Service -Name MSSQLSERVER
Start-Service -Name MsDtsServer150
Start-Service -Name MSSQLFDLauncher
```

## The full script

```powershell
[CmdletBinding()]
param(
    [Parameter(Mandatory=$True)]
    [ValidateNotNullOrEmpty()]
    [ValidateSet('Integrated','Mixed','Normal')]
    [string] $AuthMode,

    [ValidateNotNullOrEmpty()]
    [string] $Server = 'localhost'
)

# Handle all script errors
trap
{
    $exc = $Error[0].Exception
    do {
        $message = $exc.Message
        if ($message)
        {
            Write-Host -Object "ERROR: $message" -ForegroundColor Red
        }
        $exc = $exc.InnerException
    } while ($exc)

    Write-Host "`nThe artifact failed to apply.`n"
    exit -1
}

Stop-Service -Name MSSQLFDLauncher
Stop-Service -Name MsDtsServer150
Stop-Service -Name MSSQLSERVER

$sqlJob = Start-Job -Name Sql -ScriptBlock {
  & 'C:\Program Files\Microsoft SQL Server\MSSQL15.MSSQLSERVER\MSSQL\Binn\sqlservr.exe' -m
}

try {
    Write-Host 'Sql Server status'
    $sqlJob.JobStateInfo

    # Connect to the local SQL instance using SMO
    [System.Reflection.Assembly]::LoadWithPartialName('Microsoft.SqlServer.SMO') | out-null
    $s = new-object('Microsoft.SqlServer.Management.Smo.Server') $Server
    [string]$nm = $s.Name
    [string]$mode = $s.Settings.LoginMode

    # Change to Mixed Mode
    $s.Settings.LoginMode = [Microsoft.SqlServer.Management.SMO.ServerLoginMode] $AuthMode
    $s.Alter()
}
finally {
    $sqlJob.StopJob()

    Start-Service -Name MSSQLSERVER
    Start-Service -Name MsDtsServer150
    Start-Service -Name MSSQLFDLauncher
}
```
