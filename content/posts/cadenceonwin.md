---
title: "Running Cadence on Windows"
date: 2019-02-09
tags: ["Cadence","Workflow"]
---

[Uber Cadence](https://cadenceworkflow.io) is a powerful tool for writing long-running applications. It's used at Uber for many scenarios
because of its consistency guarantees and simple programming model. At Uber, we use Mac and Linux so all the instructions for running 
Cadence locally are geared toward Mac. I have mostly Windows machines but would still like to experiment with it at home. Fortunately, 
the Cadence server is a Docker container so it can be run on Windows.

The instructions for running the Cadence server on Mac are:

```bash
mkdir docker
cd docker
curl -s -L https://github.com/uber/cadence/releases | egrep -m 1 -o '/uber/cadence/releases/download/v[0-9]+.[0-9]+.[0-9]+/docker.tar.gz' | wget --base=https://github.com/ -i -
tar -xzvf docker.tar.gz
docker-compose up
```

This looks for the link to the latest release using curl and egrep then calls wget to download the package. Then it decompresses the 
package and starts the container. We can do the same thing with PowerShell (3.0 or higher) on Windows except we'll need something to handle
the tar. Here are the steps:

1. Install Docker: https://docs.docker.com/docker-for-windows/install/
2. Install Chocolatey: https://chocolatey.org/install
3. Open an admin PowerShell command window
4. Run `choco install 7zip.install` and follow the prompts to install 7zip
5. Run the following PowerShell commands

```PowerShell
mkdir docker
cd docker
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$R = wget https://github.com/uber/cadence/releases -UseBasicParsing
$L = $R.Links | where {$_.href -match '/uber/cadence/releases/download/v[0-9]+.[0-9]+.[0-9]+/docker.tar.gz'} | select href -First 1
$U = 'https://github.com' + $L.href
wget $U -OutFile docker.tar.gz
7z x .\docker.tar.gz
docker-compose up
```

Some quick explanation of what this does. First is the weird ServicePointManager statement:

```PowerShell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
```

This is needed because PowerShell defaults to TLS 1.0. Read more about this solution on 
[Stack Overflow](https://stackoverflow.com/questions/41618766/powershell-invoke-webrequest-fails-with-ssl-tls-secure-channel).

The script uses wget, which is actually a 
[shortcut](https://superuser.com/questions/362152/native-alternative-to-wget-in-windows-powershell) for 
[Invoke-WebRequest](https://docs.microsoft.com/en-us/powershell/module/Microsoft.PowerShell.Utility/Invoke-WebRequest?view=powershell-5.1).
I added the `-UseBasicParsing` parameter to the first command since it skips DOM parsing and without it the next line will hang.

There was [some indication](https://superuser.com/questions/80019/how-can-i-unzip-a-tar-gz-in-one-step-using-7-zip) that 7zip requires 
two steps, one for gz and the next for tar. But this appears to have been fixed.
