---
title: "Workflow Manager Internals - Topics"
date: 2018-06-14
tags: ["Workflow", "Workflow Manager", "Service Bus"]
---

In this post, I'll explain how [Workflow Manager](https://msdn.microsoft.com/library/jj193528.aspx) handles messages through Service Bus topics.

<!--more-->

Workflow Manager (WFM) organizes data into scopes. Scopes can have child scopes, which allows the user to create a hierarchy. For SharePoint, there 
is a top-level scope with child scopes for each site collection. Site collections have child scopes for each site. A workflow is only allowed to 
operate on the data within a particular site. If the site uses workflow, WFM will create a Service Bus topic underneath.

Suppose there is a site collection for human resources with a subsite for timesheets. SharePoint will use GUIDs to refer to the site collection 
and site, but we'll use the names to make it easier to read. 

The scope path for the timesheets site could look like this `/HumanResources/Timesheets`

If the site uses SharePoint 2013 workflows, WFM will create a Service Bus topic called `HumanResources/Timesheets/wftopic`. It will also add one subscription 
to this topic called `MTW`, which is short for Multi-Tenant Workflow (WFM's original name).

SharePoint, whether a site is using workflows or not, will publish all events about what's going on with a site to WFM. If the site's scope has a 
topic, WFM will send the message to the Service Bus topic. Otherwise, WFM drops the message. 

A message sent to a topic is uninteresting unless the subscription picks it up. Normally, subscriptions have a default rule that matches all 
incoming messages. The subscription WFM creates does not have this default rule. Rules are created only under certain circumstances. The first of which 
is when a user publishes a workflow. 

# Activation rules

In order to create a new instance of a workflow, an activation rule is created when the workflow definition is published. All rules consist of a filter
and an action. The filter for an activation rule would look something like this:

```
(Topic = <guid> AND Subject = WorkflowStart)
  OR (Topic = <guid> AND Subject = ItemAdded) 
  OR (Topic = <guid> AND Subject = ItemUpdated)
```

This filter correlates to what a user would pick in SharePoint designer when choosing the start options:

![SharePoint designer with workflow open and some start options checked](/img/spd_startuptypes.png "SharePoint designer workflow start options")

There is more content to the actual filter in the Service Bus rule. For instance, if the item add or update was caused by a workflow, we 
don't want another workflow instance to start because of that action. I left out those filter conditions for brevity.

The next part of the activation rule is the action. If the message sent to the subscription matches the filter, the action will be executed. Here 
is a sample action from an activation rule:

```
SET sys.SessionId = <WorkflowNameHash> + '_' + P(ActivationKey);
SET sys.MessageId = NEWID();
SET X_MS_WF_ActionName = Activate;
SET X_MS_WF_WorkflowId = <guid>;
SET X_MS_WF_WorkflowNameHash = <WorkflowNameHash>;
SET X_MS_WF_InstanceId = NEWID();
SET X_MS_WF_CorrelationKey = ActivationKey;
```

The message that matches the filter gets copied to a session. The ID of the session is determined by a hash of the workflow name and whatever 
activation key that SharePoint passes in the message. The activation key is a GUID that sometimes refers to a specific item in a list. This is done 
so that only one workflow instance can run on a particular item at a time. 

The **ActionName** parameter tells WFM what this message is for. The message is now on the subscription in a session. This diagram will help in 
understanding what a session is:

![Diagram showing messages in a queue being organized into separate sessions](https://docs.microsoft.com/en-us/azure/service-bus-messaging/media/message-sessions/sessions.png "Diagram of message sessions")

In this diagram, messages have arrived in the queue (or subscription) and they have session ids. A client can then get the messages that 
are on a particular session instead of having to sort through everything in the subscription. The session does not need to be created ahead of time. 
In the case of WFM, the session is created as a result of the activation rule action setting a session id on a message. The purpose of these sessions
is to organize all the messages for a given workflow instance into the same session.

# Management rules

As soon as a new workflow instance is created, another rule is added to the subscription to handle management events like cancel, resume, or terminate. 

```
Filter: 
sys.CorrelationId = 'M.<guid>'

Action:
SET sys.SessionId = <sessionid>;
SET sys.MessageId = NEWID();
SET X_MS_WF_InstanceId = <instanceid>
```

This allows WFM to send a message to a session to tell an individual workflow instance to perform a management operation. What's confusing about this 
is that the message goes on to the end of the session. So the other messages in the session have to process before the management operation. If a 
message in the session is poison, you cannot perform any management operations on the workflow instance until the poison message is removed.

Another interesting point about management rules is that the correlation id is based on the workflow version. This is because all instances of a 
workflow version may need to be contacted at the same time. This would happen if the workflow version is being removed and all its instances need to 
be terminated. That one terminate message sent to the Service Bus topic will match several management rules and a copy of the message will be placed 
in each workflow instance's session. 

# Bookmark rules

One of the advantages of dividing a subscription into sessions is to handle [bookmarks](https://docs.microsoft.com/en-us/dotnet/framework/windows-workflow-foundation/bookmarks). 
Bookmarks are a core Windows Workflow Foundation (WF) concept. They allow a workflow instance to be unloaded from memory and persisted while waiting 
for some action. The action, in the case of SharePoint, is a message sent to the topic that matches a certain criteria. In SharePoint, a bookmark 
would be used to handle a "Wait" such as this:

![Image of a SharePoint Designer with a stage that waits for a field change](/img/spd_wait.png "Workflow stage with Wait")

When the workflow instance gets to the wait step, WFM will create a bookmark rule in the Service Bus subscription, persist, and unload. A bookmark 
rule has a filter that's specific to the action that the instance is waiting on.

```
Topic = <guid> 
AND Subject = 'ItemUpdated' 
AND Microsoft.SharePoint.ActivationProperties.ItemId = '1234' 
```

The Topic in this case is not the Service Bus topic but a SharePoint artifact such as a list. In this case, the filter will match an event that 
indicates item 1234 was updated. When a message matches the filter, the action is executed to deliver the message to the workflow instance's
session:

```
SET sys.SessionId = <sessionid>;
SET sys.MessageId = NEWID();
SET X_MS_WF_ActionName = ReceiveCurrentNotification;
SET X_MS_WF_BookmarkKey = <guid>;
SET X_MS_WF_InstanceId = <instanceid>
```

Since workflows can have multiple parallel branches, they can also have multiple bookmarks. The "BookmarkKey" field tells WFM which of the workflow 
instance's bookmarks the message is for.

## Deferred messages

In the earlier image, the stage emails a set of users and then waits for a change on the item. If the Finance department sees the item and changes 
the field before the email is sent, then the workflow instance may not have created the rule by the time the item updated message was sent. This 
would cause the workflow to wait indefinitely until the item is updated again. A way to get around this is to setup the bookmark rule early, 
before sending the email, so that the message goes to the session right away.

In this case, WFM will receive the message and understand that it's for a particular bookmark. However, the workflow instance is not ready to 
process the message. In this case, the message's state is changed from "Active" to "Deferred". The workflow instance state records the sequence number of the 
message. When receiving messages from a session, Service Bus will only deliver the active messages. In order to retrieve the message, WFM will 
have to request the message by its sequence number. The next time the workflow instance is loaded, the deferred messages will be checked to see if any match 
the bookmark(s) the instance is waiting on. 

Message deferral is documented [here](https://docs.microsoft.com/en-us/azure/service-bus-messaging/message-deferral).

# Common issues with WFM topics

The use of Service Bus topics and subscriptions is very powerful, but not bulletproof. Here are some of the issues that can arise with WFM due 
to this design.

* __Rule limit exceeded__ - Each workflow instance creates a management rule. Typically, that workflow will set up a bookmark rule and go idle. There 
  is a limit on the number of rules for a subscription that defaults to 100,000. If a site has 50,000 workflow instances in progress at the same time, 
  WFM will no longer be able to create rules. This means no new instances can be created. 
  * Jose Pendao shows how to [increase the rule limit](https://blogs.msdn.microsoft.com/whereismysolution/2017/04/03/maximum-allowed-correlation-filter-have-been-reached-or-exceeded/) 
    for on-premises WFM installations. This won't work for SharePoint Online.
  * The most common reason this issue occurs is because the workflow design does not allow the instance to complete.
* __Topic size exceeded__ - WFM sets the topic size to 6GB. The most common cause is that workflows setup overly broad filters like "if any item 
  in a list is updated". If there are 100 bookmark rules that have the same filter, 100 copies of the same message will be stored in the subscription. 
  If these messages then get deferred, they start to pile up fast.
  * It may be possible to use Jose's approach for the rule limit here to run __Set-SBRuntimeSetting -Name MaximumTopicSizeInMegabytes -Value 10240__
    but this cannot be done in SharePoint Online.
  * Cleaning this up once the topic exceeds the size limit in SharePoint Online cannot be done by the user. Customer support will need to remove 
    messages from the subscription directly. This means the customer will need to identify what workflows/instances to delete.
* __Instances get stuck indefinitely__ - This can happen when a bookmark rule was created after the message it's interested in was sent. While creating 
  the bookmark earlier can help reduce this issue, it doesn't cover 100% of cases. In SharePoint Online, throttling is in place for how many messages 
  are processed for a given scope in a time window. If the throttle kicks in, that will delay the workflow instance from creating the bookmark.
* __Orphaned rules__ - This bug was fixed in SharePoint Online (fix will ship with next WFM release) but it can occur if you're running an older 
  version of WFM. WFM would create the rule with an asynchronous call to Service Bus. If the workflow created and then immediately deleted a rule, the 
  delete would sometimes get processed before the create. The delete rule doesn't return anything and doesn't indicate a fault if the rule didn't 
  exist. Once the rule is assumed deleted, the name of the rule, which is the name of the bookmark, is removed from the workflow instance state. After 
  that, it's very difficult to track down which rules are orphaned.
  * Service Bus APIs around rules don't help. There is a method that [gets all the rules](https://docs.microsoft.com/en-us/dotnet/api/microsoft.servicebus.namespacemanager.getrules?view=azure-dotnet) 
    but doesn't allow any filter except created date after a timestamp. There is also no API to get a specific rule. It's the responsibility of the 
    client to remember the rule name.
  * Orphaned rules can result in exceeding the rule limit or the topic limit.
