---
title: "Azure Queue Message Workflow Activity"
date: 2014-10-08
tags: ["Workflow","Azure"]
---

A WF4 activity to queue a message in an Azure Queue.

<!--more-->

```csharp
public sealed class QueueMessageActivity : AsyncCodeActivity
{
  [RequiredArgument]
  public InArgument<string> StorageConnectionString { get; set; }
  [RequiredArgument]
  public InArgument<string> QueueName { get; set; }
  [RequiredArgument]
  public InArgument<string> Message { get; set; }
  protected override IAsyncResult BeginExecute(AsyncCodeActivityContext context, AsyncCallback callback, object state)
  {
    CloudStorageAccount storageAccount = CloudStorageAccount.Parse(context.GetValue<string>(StorageConnectionString));
    CloudQueueClient queueClient = storageAccount.CreateCloudQueueClient();
    CloudQueue queue = queueClient.GetQueueReference(context.GetValue<string>(QueueName).ToLower());
    context.UserState = queue;
    return queue.BeginAddMessage(new CloudQueueMessage(context.GetValue<string>(Message)), callback, state);
  }
  protected override void EndExecute(AsyncCodeActivityContext context, IAsyncResult result)
  {
    CloudQueue queue = (CloudQueue)context.UserState;
    queue.EndAddMessage(result);
  }
}
```
