---
title: "WCF Azure Table Transport on Nuget"
date: 2014-10-09
tags: ["Azure","WCF"]
---

The [WCF Azure table transport](/posts/azuretablechannel) is a fun adaptation of 
the original example by Dr. Nick, which used files as a transport layer. I thought I would take it a 
step further and turn it into a [Nuget package](https://www.nuget.org/packages/AzureTableWcfTransport).

To set up a server, you would add the following to your config:

```xml
<system.serviceModel>
  <extensions>
    <bindingExtensions>
      <add 
        name="azureTableTransportBinding" 
        type="AzurePerfTools.TableTransportChannel.AzureTableTransportBindingCollectionElement, AzurePerfTools.TableTransportChannel" />
    </bindingExtensions>
  </extensions>
  <bindings>
    <azureTableTransportBinding>
      <binding 
        name="TestService" 
        deploymentId="00000000000000000000000000000000" 
        role="SomeRole" 
        instance="SomeRole_IN_0" />
    </azureTableTransportBinding>
  </bindings>
  <services>
    <service name="ConsoleApplication1.Service1">
      <endpoint 
        address="azure.table:TestCommands" 
        binding="azureTableTransportBinding" 
        bindingConfiguration="TestService" 
        contract="ConsoleApplication1.IService1" />
    </service>
  </services>
</system.serviceModel>
```

The deploymentId, role, and instance parameters on the binding are optional. They are filled in 
automatically when you're running this on an Azure cloud service. There is another optional 
parameter called connStr that has the table transport connection string. By default this is set 
to development storage. So be sure to have the storage emulator running.

The client will have a similar configuration:

```xml
<system.serviceModel>
  <extensions>
    <bindingExtensions>
      <add
        name="azureTableTransportBinding"
        type="AzurePerfTools.TableTransportChannel.AzureTableTransportBindingCollectionElement, AzurePerfTools.TableTransportChannel" />
    </bindingExtensions>
  </extensions>
  <bindings>
    <azureTableTransportBinding>
      <binding
        name="TestService"
        deploymentId="00000000000000000000000000000000"
        role="SomeRole"
        instance="SomeRole_IN_0"
        closeTimeout="00:10:00"
        openTimeout="00:10:00"
        receiveTimeout="00:10:00"
        sendTimeout="00:10:00" />
    </azureTableTransportBinding>
  </bindings>
  <client>
    <endpoint
      address="azure.table:TestCommands"
      binding="azureTableTransportBinding"
      bindingConfiguration="TestService"
      contract="ConsoleApplication1.IService1"
      name="TestServiceClient" />
  </client>
</system.serviceModel>
```

The above is great for testing locally. However, when you want to embed this transport into 
your Azure cloud service, it's better to stay away from using the config file. Just create
the ServiceHost in code. Here is how I approach that:

```csharp
var serviceHost = new ServiceHost(typeof(Service1));
serviceHost.AddServiceEndpoint(
    typeof(IService1),
    new AzurePerfTools.TableTransportChannel.AzureTableTransportBinding(
        new TableTransportChannel.AzureTableTransportBindingElement()
        {
            ConnectionString = CloudConfigurationManager.GetSetting("Service1TableConnectionString"),
            DeploymentId = RoleEnvironment.DeploymentId,
            RoleName = RoleEnvironment.CurrentRoleInstance.Role.Name,
            InstanceName = RoleEnvironment.CurrentRoleInstance.Id,
        }),
    "azure.table:TestService");
serviceHost.Open();
```

Here you're getting the connection string from the cscfg configuration settings and the 
deployment, role name, and instance name from the role environment.
