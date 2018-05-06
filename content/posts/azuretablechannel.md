---
title: "Azure table storage WCF transport channel"
date: 2014-10-08
tags: ["Azure","WCF"]
---

Communicating with an Azure role through table storage is a common practice. When you setup a worker role, you typically have it watching a 
queue looking for new messages to signal work. You essentially have something that works like a server and is acting on requests. It fits 
with a WCF model so I decided to create a WCF transport channel that uses Azure table storage. Instead of creating your own loop and putting
in logic for handling concurrent messages, faults, etc., you can leverage WCF to do that for you. This implementation uses an Azure table
because I wanted to be able to target specific VM instances. If I didn't care which instance got the message, I could use a queue instead.

> The full code is available here: https://github.com/dmetzgar/azure-table-transport

The design of the service in a nutshell is this:

* Azure table storage is used as a transport channel
* Deployment id, role name, and instance name are acquired from RoleEnvironment and concatenated to create a partition key for the Azure table - note that 
  you could also remove the instance name if you don't care what particular instance you're talking to, but in that case it's better to use a queue
* The service polls the Azure table with the partition key looking for messages
* When a message is received, it is executed and the response is sent to another Azure table - note that it is possible to do one-way messaging but I have
  not implemented it yet

The client works in a similar way where it writes a request message to an Azure table and polls another table for a response. The difference is that it has 
to be pointed to a particular deployment, role, and instance.

# The Code
The code below is using Azure SDK 1.8. The first thing I created was a TableEntity to store the SOAP message. This works for both the request and response.

```csharp
class SoapMessageTableEntity : TableEntity
{
    public SoapMessageTableEntity(string partitionKey)
    {
        this.PartitionKey = partitionKey;
        this.RowKey = Guid.NewGuid().ToString();
    }
    public SoapMessageTableEntity() { }
    public string Message { get; set; }
}
```

The URI for the service endpoint should serve as the name of the Azure table. Since I have two tables, I append Request and Reply to them. The 
ChannelListener seems a good place to create the tables if they do not already exist.

```csharp
protected override void OnOpen(TimeSpan timeout)
{
    this.cloudTableClient = this.storageAccount.CreateCloudTableClient();
    CloudTable requestTable = cloudTableClient.GetTableReference(Uri.AbsolutePath + "Request");
    requestTable.CreateIfNotExists();
    CloudTable replyTable = cloudTableClient.GetTableReference(Uri.AbsolutePath + "Reply");
    replyTable.CreateIfNotExists();
}
```

The lynchpin of the whole system is the code to poll for messages. Both the request and reply channel classes inherit 
from a common base class. This is where I've added the WaitForMessage method.

```csharp
private bool WaitForMessage(string tableName, TimeSpan timeout, TimeSpan sleep, out SoapMessageTableEntity soapMessage)
{
    soapMessage = null;
    if (this.channelClosed)
    {
        return false;
    }
 
    ThrowIfDisposedOrNotOpen();
    try
    {
        CloudTable cloudTable = this.cloudTableClient.GetTableReference(tableName);
        bool foundRecords = false;
        DateTime endTime = timeout == TimeSpan.MaxValue ? DateTime.MaxValue : DateTime.Now + timeout;
        while (!foundRecords && DateTime.Now < endTime && !this.channelClosed)
        {
            IEnumerable<soapmessagetableentity> queryResults = cloudTable.ExecuteQuery<soapmessagetableentity>(
                new TableQuery<soapmessagetableentity>().Where(TableQuery.GenerateFilterCondition("PartitionKey", "eq", this.partitionKey)).Take(1));
            if (queryResults.Count() > 0)
            {
                foundRecords = true;
                soapMessage = queryResults.First();
            }
            else
            {
                Thread.Sleep(sleep);
            }
        }
 
        return foundRecords;
    }
    catch (IOException exception)
    {
        throw ConvertException(exception);
    }
}
```

The partitionKey is stored as a member variable. You can see where it's applied as a filter condition when querying the table. The sleep value 
is passed in to the method. You could make this configurable.

Writing a message to a table is the same for both request and reply.
```csharp
private void WriteMessage(string tableName, Message message)
{
    // Create a new customer entity
    SoapMessageTableEntity soapMessage = new SoapMessageTableEntity(partitionKey);
    ArraySegment<byte> buffer;
    using (message)
    {
        this.address.ApplyTo(message);
        buffer = this.encoder.WriteMessage(message, MaxBufferSize, this.bufferManager);
    }
    soapMessage.Message = Encoding.UTF8.GetString(buffer.Array, buffer.Offset, buffer.Count);
    this.bufferManager.ReturnBuffer(buffer.Array);
 
    CloudTable cloudTable = this.cloudTableClient.GetTableReference(tableName);
    cloudTable.Execute(TableOperation.Insert(soapMessage));
}
```

The code here uses the encoder (which is set to the text encoder) to write the message to a buffer created by the buffer manager. Then it's 
encoded as a UTF8 string. If you were to open the table in a tool like Azure Storage Explorer you would see the text SOAP message. This can 
help for debugging purposes.

Reading the message is split into two methods. This is because there are two code paths for getting the message. In the reply channel, 
WaitForRequest only returns a Boolean indicating whether or not a request was received within the timeout. The other path is 
TryReceiveRequest in the reply channel and the Request method in the request channel that waits for the reply message. This path will use the 
message read from the WaitForMessage method instead of reading again from the table.

```csharp
private Message ReadMessage(string tableName)
{
    CloudTable cloudTable = this.cloudTableClient.GetTableReference(tableName);
    IEnumerable<soapmessagetableentity> result = cloudTable.ExecuteQuery<soapmessagetableentity>(
        new TableQuery<soapmessagetableentity>()
        {
            FilterString = string.Format(@"PartitionKey = ""{0}""", this.partitionKey),
            TakeCount = 1
        });
 
    return this.ReadMessage(tableName, result.First());
}
 
protected Message ReadMessage(string tableName, SoapMessageTableEntity soapMessage)
{
    byte[] data = null;
    int bytesTotal;
    try
    {
 
        bytesTotal = Encoding.UTF8.GetByteCount(soapMessage.Message);
        if (bytesTotal > int.MaxValue)
        {
            throw new CommunicationException(
               String.Format("Message of size {0} bytes is too large to buffer. Use a streamed transfer instead.", bytesTotal)
            );
        }
 
        if (bytesTotal > this.maxReceivedMessageSize)
        {
            throw new CommunicationException(String.Format("Message exceeds maximum size: {0} > {1}.", bytesTotal, this.maxReceivedMessageSize));
        }
 
        data = this.bufferManager.TakeBuffer(bytesTotal);
        Encoding.UTF8.GetBytes(soapMessage.Message, 0, soapMessage.Message.Length, data, 0);
 
        ArraySegment<byte> buffer = new ArraySegment<byte>(data, 0, (int)bytesTotal);
        return this.encoder.ReadMessage(buffer, this.bufferManager);
    }
    catch (IOException exception)
    {
        throw ConvertException(exception);
    }
    finally
    {
        if (data != null)
        {
            this.bufferManager.ReturnBuffer(data);
            CloudTable cloudTable = this.cloudTableClient.GetTableReference(tableName);
            cloudTable.Execute(TableOperation.Delete(soapMessage));
        }
    }
}
```

Notice also that the table entity is deleted in the finally. This is to keep us from reading the same messages over and over. 
You could modify this to update a flag indicating the message was read so you could keep an archive of the messages.
