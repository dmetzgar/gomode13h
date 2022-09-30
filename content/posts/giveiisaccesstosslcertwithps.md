---
title: "Give IIS access to an SSL Certificate with PowerShell"
date: 2020-06-11
tags: ["powershell", "iis"]
---

A PowerShell script to allow the "IIS_IUSRS" group to get access to a certificate's private key. 
This is needed if you plan to use the cert for SSL.

<!--more-->

I had to cobble together many different answers and blog posts to get this script. Use this if you 
already created a site in IIS, have a certificate installed for SSL, and set the binding for 
SSL (https) in IIS to that certificate. IIS needs access to the private key of the certificate in 
order to work. Otherwise, you may see a "Keyset does not exist" error when attempting to browse 
the site.

```powershell
$siteName = 'My site name'
$binding = (Get-ChildItem -Path IIS:SSLBindings | Where Sites -eq $siteName)[0]
$certLoc = "cert:\LocalMachine\MY\$($binding.Thumbprint)"
$cert = Get-Item $certLoc
$keyPath = $env:ProgramData + "\Microsoft\Crypto\RSA\MachineKeys\"
$keyName = $cert.PrivateKey.CspKeyContainerInfo.UniqueKeyContainerName
$keyFullPath = $keyPath + $keyName
$acl = (Get-Item $keyFullPath).GetAccessControl("Access")
$permission="IIS_IUSRS","Full","Allow"
$accessRule = New-Object -TypeName System.Security.AccessControl.FileSystemAccessRule -ArgumentList $permission
$acl.AddAccessRule($accessRule)
Set-Acl -Path $keyFullPath -AclObject $acl
```

Change the `$siteName` to the site name in IIS (e.g. "Default Web Site").
