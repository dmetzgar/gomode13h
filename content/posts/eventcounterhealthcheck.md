---
title: "Custom Event Counter-based ASP.NET Core Health Check"
date: 2021-08-10
tags: [".NET Core","ASP.NET", "ETW"]
---

ASP.NET Core has built-in, customizable health check middleware. A utility can
periodically probe the health endpoint to determine the health of the web app, 
which is useful if your web app is load-balanced or hosted in Kubernetes.
This post is about implementing a custom health check that you can configure to 
track any Event Counter.

<!--more-->

## Goodbye, Windows Performance Counters

Windows performance counters are useful. There are all kinds of perf counters 
provided out-of-the-box with the .NET Framework. But this all went away with 
cross platform .NET Core. Microsoft made ETW (Event Tracing for Windows) work 
on other platforms (as 
[EventSource](https://docs.microsoft.com/dotnet/api/system.diagnostics.tracing.eventsource)),
so why not perf counters?

Azure Application Insights 
[documents](https://docs.microsoft.com/azure/azure-monitor/app/performance-counters#performance-counters-in-aspnet-core-applications) 
that support for performance counters is limited (emphasis added) and that 
EventCounters are the way to go: 

> Support for performance counters in ASP.NET Core is limited:
> 
> - SDK versions 2.4.1 and later collect performance counters if the application 
>   is running in Azure Web Apps (Windows).
> - SDK versions 2.7.1 and later collect performance counters if the application 
>   is running in Windows and targets NETSTANDARD2.0 or later.
> - For applications targeting the .NET Framework, all versions of the SDK 
>   support performance counters.
> - SDK Versions 2.8.0 and later support cpu/memory counter in Linux. No other 
>   counter is supported in Linux. **The recommended way to get system counters 
>   in Linux (and other non-Windows environments) is by using EventCounters**

## Hello, Event Counters

[Event Counters](https://docs.microsoft.com/azure/azure-monitor/app/eventcounters) 
are a replacement for Windows performance counters that work cross-platform. 
EventCounters rely on ETW, or EventSource, to emit metrics. Starting with .NET 
Core 3.0, some EventCounters are available out-of-the-box. More counters are 
available in .NET 5. Plus, you can create your own EventCounters.

## Reporting on the health of your ASP.NET Core application

If you're on Azure, Application Insights has a lot of built-in metrics that you 
can build alerts on. If you want to alert on an EventCounter, the quickest 
solution is to use Application 
Insights' 
[EventCounterCollectionModule](https://www.nuget.org/packages/Microsoft.ApplicationInsights.EventCounterCollector). 

If your ASP.NET Core web application runs in 
places other than Azure or if an outside application doesn't have access to 
AppInsights data, you may want to expose a health endpoint. This is part of 
ASP.NET Core in the form of 
[health checks](https://docs.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks).

Adding a health check is simple. ASP.NET Core has a built-in reference to the 
[Microsoft.Extensions.Diagnostics.HealthChecks](https://www.nuget.org/packages/Microsoft.Extensions.Diagnostics.HealthChecks)
package. Add the `AddHealthChecks()` and `MapHealthChecks("/health")` lines
to your startup class:

```csharp
public class Startup
{
    public void ConfigureServices(IServiceCollection services)
    {
        services.AddHealthChecks();
    }

    public void Configure(IApplicationBuilder app)
    {
        app.UseRouting();

        app.UseEndpoints(endpoints =>
        {
            endpoints.MapHealthChecks("/health");
        });
    }
}
```

There are also health checks available for Entity Framework. For instance, the 
DbContext health check:

```csharp
services
    .AddHealthChecks()
    .AddDbContextCheck<AppDbContext>();

services.AddDbContext<AppDbContext>(options =>
{
    options.UseSqlServer(
        Configuration["ConnectionStrings:DefaultConnection"]);
});
```

## Detailed health reporting

The `/health` endpoint by default reports "Healthy", "Degraded", or "Unhealthy" 
but provides no further details. Microsoft's documentation provides examples 
of how to write a custom JSON response with Newtonsoft.JSON:

```csharp
public class Startup
{
    public void Configure(IApplicationBuilder app)
    {
        // ...
        app.UseEndpoints(endpoints =>
        {
            endpoints.MapHealthChecks("/health", new HealthCheckOptions()
            {
                ResponseWriter = CustomHealthResponse
            });
        });
    }

    private static Task CustomHealthResponse(HttpContext context, HealthReport result)
    {
        context.Response.ContentType = "application/json";

        var json = new JObject(
            new JProperty("status", result.Status.ToString()),
            new JProperty("results", new JObject(result.Entries.Select(pair =>
                new JProperty(pair.Key, new JObject(
                    new JProperty("status", pair.Value.Status.ToString()),
                    new JProperty("description", pair.Value.Description),
                    new JProperty("data", new JObject(pair.Value.Data.Select(
                        p => new JProperty(p.Key, p.Value))))))))));

        return context.Response.WriteAsync(
            json.ToString(Formatting.Indented));
    }
}
```

The resulting response would look like this (including the EF DbContext health 
check):

```json
{
  "status": "Healthy",
  "results": {
    "AppDbContext": {
      "status": "Healthy",
      "description": null,
      "data": {}
    }
  }
}
```

There isn't an accepted standard for the content of a health check. A proposal
was submitted some time ago but not adopted as an official RFC. See 
https://tools.ietf.org/id/draft-inadarei-api-health-check-01.html

Kubernetes, and perhaps other software, only checks the HTTP status code 
(see [here](https://kubernetesbyexample.com/healthz/)). The response content is
ignored. ASP.NET Core health checks return a 200 status code for "Healthy" and
"Degraded" statuses and "503" for "Unhealthy" (see 
[here](https://docs.microsoft.com/aspnet/core/host-and-deploy/health-checks#customize-the-http-status-code)).

## Custom health check based on EventCounters

The purpose of this post is on how to listen to EventCounters to create a 
custom health check. EventCounters are emitted through EventSource. To capture 
events from an EventSource, start by creating a subclass of 
[EventListener](https://docs.microsoft.com/dotnet/api/system.diagnostics.tracing.eventlistener).

```csharp
using System.Diagnostics.Tracing;

public class EventCounterHealthCheck : EventListener
{
    protected override void OnEventSourceCreated(EventSource eventSource)
    {
    }

    protected override void OnEventWritten(EventWrittenEventArgs eventData)
    {
    }
}
```

The `OnEventSourceCreated` method is called whenever any code in the process 
creates an event source. This generally happens very early during startup. 
In my experience, this method is called before the constructor. This creates 
a slight problem because if I need something passed in the constructor to 
determine what event sources to listen to, then I
won't have enough information to register as a listener for that event source
when the `OnEventSourceCreated` method is called.

An easy solution to this is to hold on to a list of the EventSources 
until you're ready:

```csharp
public class EventCounterHealthCheck : EventListener
{
    private readonly List<EventSource> _allEventSources = new();

    protected override void OnEventSourceCreated(EventSource eventSource)
    {
        _allEventSources.Add(eventSource);
    }
}
```

We'll need a way to filter down to just the event sources we need later on.
The only interesting thing to check on the event source is the name. This
interface will allow a developer to register a filter with dependency 
injection.

```csharp
public interface IEventCounterFilter
{
    bool ShouldRecordEventSource(string eventSourceName);
}
```

Implementations of this interface will be passed into the constructor:

```csharp
public class EventCounterHealthCheck : EventListener
{
    private readonly IEnumerable<IEventCounterFilter> _filters;

    public EventCounterHealthCheck(IEnumerable<IEventCounterFilter> filters)
    {
        _filters = filters;
    }
}
```

As an example, let's use the thread count on the thread pool. This is in the
`System.Runtime` event source. We'll fill out the rest of this filter later on
in this post.

```csharp
public class ThreadPoolThreadCountFilter : IEventCounterFilter
{
    public bool ShouldRecordEventSource(string eventSourceName) =>
        string.Equals(eventSourceName, "System.Runtime", StringComparison.OrdinalIgnoreCase);
}
```

Add this filter in the `Startup.ConfigureServices` method:

```csharp
services.AddSingleton<IEventCounterFilter, ThreadPoolThreadCountFilter>();
```

The `System.Runtime` event source is
built into .NET Core 3.1 and later. Built-in EventCounters are documented 
[here](https://docs.microsoft.com/en-us/dotnet/core/diagnostics/available-counters).

### Making the health check non-blocking

When a request is made against the health check endpoint, each registered
health check can reactively probe into a system to determine if 
it's healthy. EventCounters are emitting on a regular basis (every 1 
second by default). It's best not to wait until the events are
emitted after the request as a slow response to a health check could
trigger an alert from monitoring infrastructure. 

If the latest value from a counter is cached, then the health check
can respond instantly. My approach is to use an ASP.NET hosted service.
The reason I chose this is to allow the event listener to correctly
unregister from the event sources when the hosted service is shut down.

Here's the code for the hosted service:

```csharp
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using System;
using System.Threading;
using System.Threading.Tasks;

public class EventCounterHealthCheckHost : IHostedService
{
    private readonly IServiceProvider _serviceProvider;
    private EventCounterHealthCheck _eventListener;

    public EventCounterHealthCheckHost(IServiceProvider serviceProvider)
    {
        _serviceProvider = serviceProvider;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _eventListener = _serviceProvider.GetService<EventCounterHealthCheck>();
        Task.Run(_eventListener.RunHealthCheckAsync);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _eventListener?.StopUpdates();
        return Task.CompletedTask;
    }
}
```

The hosted service gets the `EventCounterHealthCheck` object from dependency 
injection using the `IServiceProvider`. We added two methods to the health 
check class: `RunHealthCheckAsync`, which will run continuously until the 
`StopUpdates` method is called. We'll implement these methods later.

`EventCounterHealthCheck` will need to implement the `IHealthCheck` interface.
This has a method to return the HealthCheckResult. This can be constructed 
asynchronously and returned on demand.

```csharp
using Microsoft.Extensions.Diagnostics.HealthChecks;
using System.Threading;
using System.Threading.Tasks;

public partial class EventCounterHealthCheck : EventListener, IHealthCheck
{
    private readonly HealthCheckResult _defaultHealthCheckResult;
    private HealthCheckResult _healthCheckResult;

    public EventCounterHealthCheck(IEnumerable<IEventCounterFilter> filters)
    {
        _defaultHealthCheckResult = new HealthCheckResult(HealthStatus.Unhealthy,
            "EventCounter health check not started");
        _healthCheckResult = _defaultHealthCheckResult;
        _filters = filters;
    }

    public Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, 
        CancellationToken cancellationToken = default)
    {
        return Task.FromResult(_healthCheckResult);
    }
}
```

The default health check result is `Unhealthy`. This is helpful if the health 
check is used for a readiness probe since that will signal when our instance
(process, pod, etc.) is ready to receive traffic.

### Updating the HealthCheckResult

Now that the `IHealthCheck` interface is implemented, we need to update the 
internal `HealthCheckResult`. Let's start with `RunHealthCheckAsync` method 
that is started by the hosted service and runs continuously until the 
`StopAsync` method is called.

```csharp
private bool _isRunning = false;
private readonly CancellationTokenSource _cancellationTokenSource = new();
private readonly ConcurrentDictionary<string, List<IEventCounterFilter>> _activeEventSources = new();
private readonly List<WeakReference<EventSource>> _enabledEventSources = new();

internal async Task RunHealthCheckAsync()
{
    CheckAllEventSources();
    if (_activeEventSources.Count > 0)
    {
        _isRunning = true;

        while (_isRunning)
        {
            UpdateHealthCheckResult();
            await Task.Delay(
                TimeSpan.FromSeconds(1), 
                _cancellationTokenSource.Token);
        }
    }
}
```

The first step is to review all the `EventSource`s to see if any match the
sources we want to listen to. An assumption made here is that all 
the event sources have been registered already. This is true for the built-in
.NET event sources but may not be true for a custom event source. One could 
re-evaluate the event sources periodically but we'll do it once to keep the 
code simple.

The while loop continues running until the boolean flag is set. Since event
counter data is only emitted every one second (configurable), the loop has a
sleep. Adding a 
`CancellationToken` to the delay timer allows us to stop the health check 
loop immediately. This is done in the `StopUpdates` method:

```csharp
internal void StopUpdates()
{
    _isRunning = false;
    _cancellationTokenSource.Cancel();
    _healthCheckResult = _defaultHealthCheckResult;

    ReleaseEventSources();
}
```

Next, let's look into how `CheckAllEventSources` works.


```csharp
private void CheckAllEventSources()
{
    foreach (EventSource eventSource in _allEventSources)
    {
        foreach (IEventCounterFilter filter in _filters)
        {
            if (filter.ShouldRecordEventSource(eventSource.Name))
            {
                var filterList = _activeEventSources.GetOrAdd(eventSource.Name, 
                    _ => new List<IEventCounterFilter>());
                filterList.Add(filter);
                EnableEventSource(eventSource);
            }
        }
    }

    // Strong references to EventSource objects no longer needed
    _allEventSources.Clear();
}
```

The general idea is that when an event is received, we can look up the list of
filters interested in that event source. In order to receive the events, we
have to enable our `EventListener` as a listener for the source. This is done
in the `EnableEventSource` method.

```csharp
private void EnableEventSource(EventSource eventSource)
{
    // Only enable if we haven't already
    if (!_enabledEventSources.Any(e => e.TryGetTarget(out var storedEventSource) && 
        storedEventSource == eventSource))
    {
        var options = new Dictionary<string, string>
        {
            // define time interval, otherwise event counters will not be enabled
            { "EventCounterIntervalSec", "1" }
        };

        // enable for the None keyword
        EnableEvents(eventSource, EventLevel.Informational, EventKeywords.None, options);
        _enabledEventSources.Add(new WeakReference<EventSource>(eventSource));
    }
}
```

Note that we keep a list of weak references to all the `EventSource` objects
we listen to. This will allow the garbage collector to clean them up if nothing
else is using them. When the hosted service is shut down, we stop listening to
those event sources by calling `ReleaseEventSources`.

```csharp
private void ReleaseEventSources()
{
    foreach (WeakReference<EventSource> eventSourceRef in _enabledEventSources)
    {
        if (eventSourceRef.TryGetTarget(out EventSource eventSource))
        {
            DisableEvents(eventSource);
        }
    }
}
```

### Handling events

Now that we're listening to event sources, we'll get events via the 
`OnEventWritten` method. Event source data is written in a particular way into
they payload of the event data. This method grabs the counter name and max 
value from the event payload.

```csharp
private bool TryGetCounter(
    EventWrittenEventArgs eventData, 
    out string counterName, 
    out double counterValue)
{
    counterName = "";
    counterValue = 0d;

    IDictionary<string, object> counterData = eventData.Payload.FirstOrDefault(
        p => p is IDictionary<string, object> x && x.ContainsKey("Name"))
        as IDictionary<string, object>;

    if (counterData != null
        && counterData.TryGetValue("Name", out var name) && name is string
        && counterData.TryGetValue("Max", out var max) && max is double)
    {
        counterName = name as string;
        counterValue = (double)max;
        return true;
    }

    return false;
}
```

If this is an event counter, the payload should contain a dictionary with the
name of the counter. There are a few other fields in this dictionary based on
the counter. For the purposes of this example, we grab the `Max` value.

Now we can fill out the `EventCounterHealthCheck.OnEventWritten` method to call
all the filters.

```csharp
protected override void OnEventWritten(EventWrittenEventArgs eventData)
{
    if (_isRunning 
        && _activeEventSources.TryGetValue(eventData.EventSource.Name, out var filterList)
        && TryGetCounter(eventData, out string counterName, out double counterValue))
    {
        foreach (var filter in filterList)
        {
            filter.OnEventWritten(counterName, counterValue);
        }
    }
}
```

This means the IEventCounterFilter interface changes:

```csharp
public interface IEventCounterFilter
{
    bool ShouldRecordEventSource(string eventSourceName);

    void OnEventWritten(string counterName, double counterValue);
}
```

Let's implement that in `ThreadPoolThreadCountFilter`:

```csharp
public class ThreadPoolThreadCountFilter : IEventCounterFilter
{
    private const string ThreadCountCounterName = "threadpool-thread-count";
    private double lastThreadCount = 0d;

    public bool ShouldRecordEventSource(string eventSourceName) =>
        string.Equals(eventSourceName, "System.Runtime", StringComparison.OrdinalIgnoreCase);

    public void OnEventWritten(string counterName, double counterValue)
    {
        if (string.Equals(counterName, ThreadCountCounterName, StringComparison.OrdinalIgnoreCase))
        {
            lastThreadCount = counterValue;
        }
    }
}
```

We're only interested in the thread pool's thread count counter. We'll get the
updated value for this counter every 1 second (as specified in
`EnableEventSource`). The part that's still missing is updating the health
check result based on the value of this counter.

### Getting health status from each filter

Every second, the main loop in `RunHealthCheckAsync` will update the health
check result by calling `UpdateHealthCheckResult`. This method will go to each
filter to get an updated status. If any status is degraded or unhealthy, that
will be the overall status for the health check.

```csharp
private void UpdateHealthCheckResult()
{
    HealthStatus worstHealthStatus = HealthStatus.Healthy;
    var data = new Dictionary<string, object>();
    foreach (var filter in _filters)
    {
        var filterStatus = filter.UpdateHealthStatus(data);
        if (filterStatus < worstHealthStatus)
        {
            worstHealthStatus = filterStatus;
        }
    }

    _healthCheckResult = new HealthCheckResult(worstHealthStatus, data: data);
}
```

The filter interface gets a new method, `UpdateHealthStatus`:

```csharp
using Microsoft.Extensions.Diagnostics.HealthChecks;
using System.Collections.Generic;

public interface IEventCounterFilter
{
    bool ShouldRecordEventSource(string eventSourceName);

    void OnEventWritten(string counterName, double counterValue);

    HealthStatus UpdateHealthStatus(Dictionary<string, object> data);
}
```

Here is an example implementation for our thread pool thread count filter.

```csharp
public HealthStatus UpdateHealthStatus(Dictionary<string, object> data)
{
    data.Add(ThreadCountCounterName, lastThreadCount + " of 200");
    if (lastThreadCount > 180d)
    {
        return HealthStatus.Degraded;
    }
    else if (lastThreadCount >= 200d)
    {
        return HealthStatus.Unhealthy;
    }

    return HealthStatus.Healthy;
}
```

This filter arbitrarily picks 200 as the threshold. Getting above 180 threads
indicates a "degraded" state. Degraded doesn't change the status code returned
by the "/health" endpoint.

### Adding the custom health check

The `AddHealthChecks` method has a `IHealthChecksBuilder` object that we can
use to add our health check. We'll need an extension method in its own static
class.

```csharp
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;

public static class EventCounterHealthCheckExtension
{
    public static IHealthChecksBuilder AddEventCounterHealthCheck(
        this IHealthChecksBuilder builder)
    {
        builder.Add(new HealthCheckRegistration(
                    "EventCounter health check",
                    sp => sp.GetService<EventCounterHealthCheck>(),
                    default,
                    default));
        return builder;
    }
}
```

This grabs the `EventCounterHealthCheck` object from dependency injection. That
will need to be registered in the `Startup` class.

```csharp
public void ConfigureServices(IServiceCollection services)
{
    services.AddRazorPages();
    services.AddHealthChecks()
        .AddEventCounterHealthCheck();

    services.AddSingleton<IEventCounterFilter, ThreadPoolThreadCountFilter>();
    services.AddSingleton<EventCounterHealthCheck>();
    services.AddHostedService<EventCounterHealthCheckHost>();
}
```

### Testing it out

Assuming you've been following along by starting with the ASP.NET Core template
in Visual Studio and adding the code above, you should be able to hit F5 and
start testing. Add "/health" to the URL in the browser 
(e.g. "https://localhost:44360/health"). You should see a response like this:

```json
{
    "status": "Healthy",
    "results": {
        "EventCounter health check": {
            "status": "Healthy",
            "description": null,
            "data": {
                "threadpool-thread-count": "10 of 200"
            }
        }
    }
}
```

Try setting the threshold lower, clicking around on the website and refreshing
the health check to verify that other statuses and status codes appear.
