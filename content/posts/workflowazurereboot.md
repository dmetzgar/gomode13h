---
title: "Reboot Azure Role Instance Workflow Activity"
date: 2014-10-08
tags: ["Workflow","Azure"]
---

A WF4 activity to reboot a role instance in an Azure cloud service deployment. Note that this method uses the Azure REST API and requires a management certificate to be installed on the machine executing the workflow in the local machine store.

```csharp
public class RebootAzureRoleInstanceActivity : AsyncCodeActivity
{
  [RequiredArgument]
  public InArgument<string> SubscriptionId { get; set; }
  [RequiredArgument]
  public InArgument<string> HostedServiceName { get; set; }
  [RequiredArgument]
  public InArgument<string> DeploymentSlot { get; set; }
  [RequiredArgument]
  public InArgument<string> CertThumbprint { get; set; }
  [RequiredArgument]
  public InArgument<string> RoleInstanceName { get; set; }

  protected override IAsyncResult BeginExecute(AsyncCodeActivityContext context, AsyncCallback callback, object state)
  {
    // X.509 certificate variables.
    X509Store certStore = null;
    X509Certificate2Collection certCollection = null;
    X509Certificate2 certificate = null;
    // Request and response variables.
    HttpWebRequest httpWebRequest = null;
    // URI variable.
    Uri requestUri = null;
    string thumbPrint = context.GetValue<string>(CertThumbprint);
    // Open the certificate store for the current user.
    certStore = new X509Store(StoreName.My, StoreLocation.LocalMachine);
    certStore.Open(OpenFlags.ReadOnly);
    // Find the certificate with the specified thumbprint.
    certCollection = certStore.Certificates.Find(
      X509FindType.FindByThumbprint,
      thumbPrint,
      false);
    // Close the certificate store.
    certStore.Close();
    // Check to see if a matching certificate was found.
    if (0 == certCollection.Count)
    {
      throw new Exception("No certificate found containing thumbprint " + thumbPrint);
    }
    // A matching certificate was found.
    certificate = certCollection[0];
    // Create the request.
    requestUri = new Uri(
      string.Format("https://management.core.windows.net/{0}/services/hostedservices/{1}/deploymentslots/{2}/roleinstances/{3}?comp=reboot",
      context.GetValue<string>(SubscriptionId),
      context.GetValue<string>(HostedServiceName).Split('.')[0],
      context.GetValue<string>(DeploymentSlot).ToLowerInvariant(),
      context.GetValue<string>(RoleInstanceName)
      ));
    httpWebRequest = (HttpWebRequest)HttpWebRequest.Create(requestUri);
    httpWebRequest.Method = "POST";
    httpWebRequest.ContentLength = 0;
    httpWebRequest.ContentType = "application/xml";
    // Add the certificate to the request.
    httpWebRequest.ClientCertificates.Add(certificate);
    // Specify the version information in the header.
    httpWebRequest.Headers.Add("x-ms-version", "2011-10-01");
    // Make the call using the web request.
    context.UserState = httpWebRequest;
    return httpWebRequest.BeginGetResponse(callback, state);
  }

  protected override void EndExecute(AsyncCodeActivityContext context, IAsyncResult result)
  {
    HttpWebRequest httpWebRequest = context.UserState as HttpWebRequest;
    HttpWebResponse httpWebResponse = httpWebRequest.EndGetResponse(result) as HttpWebResponse;
  }
}
```
