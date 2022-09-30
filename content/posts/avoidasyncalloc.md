---
title: "Only make your C# methods async when needed"
date: 2022-07-03
tags: ["csharp","performance"]
---

C# async methods perform an allocation to start the async state machine.
If your code has checks that don't require async, try to separate the method's code into sync and async portions.

<!--more-->

You can follow along with the repro steps and see how this works yourself if you have Visual Studio.
Visual Studio comes with a tool called ildasm that we need to view the generated IL from compiling the code.
If you're using JetBrains, the dotPeek application has the ability to decompile to IL but I haven't tried it.

The first step is to create a new ASP.NET Core Web API application.
Use the Visual Studio new project dialog or the dotnet CLI to create the project.

```shell
dotnet new webapi --name WebApplication1
```

The default webapi template has a WeatherForecastController as an example.
We'll build a service to time how long the request takes and invoke it via middleware.
Create an interface called ITimerService with the following code:

```csharp
namespace WebApplication1;

public interface ITimerService
{
    void StartTimer(string timerName);
    void StopTimer(string timerName);
    void EmitTelemetry();
}
```

We don't need to fill out this interface but we will create the middleware.
Create a new class called TimerMiddleware with the following code:

```csharp
namespace WebApplication1;

public class TimerMiddleware
{
    public const string FullRequest = nameof(FullRequest);
    private readonly RequestDelegate _next;
    private readonly ITimerService _timerService;

    public TimerMiddleware(RequestDelegate next, ITimerService timerService)
    {
        _next = next;
        _timerService = timerService;
    }

    public async Task InvokeAsync(HttpContext httpContext)
    {
        if (!httpContext.Request.Path.StartsWithSegments("/weatherforecast", StringComparison.OrdinalIgnoreCase))
        {
            _timerService.StartTimer(FullRequest);
        }

        try
        {
            await _next(httpContext);
        }
        finally
        {
            if (!httpContext.Request.Path.StartsWithSegments("/weatherforecast", StringComparison.OrdinalIgnoreCase))
            {
                _timerService.StopTimer(FullRequest);
                _timerService.EmitTelemetry();
            }
        }
    }
}
```

We only want this middleware to time calls to the WeatherForecastController.
There's no need to register the middleware as we only need to compile the project to see the IL generated for the middleware class.
Open a **Developer Command Prompt for VS 20xx** and enter the command **ildasm**.
This should bring up a GUI tool.
From the tool, open the new DLL (e.g. WebApplication1.dll) built for the web application (from the /bin/Debug/net6.0 folder).
You can also drag the DLL file onto the ildasm application to open it up.
Find the TimerMiddleware class in the tree.

![](/img/ildasm_timermiddleware_class.png)

Notice that we have a method called InvokeAsync which matches the code.
But there's also an inner class called `<InvokeAsync>d__4`.
If you double-click on the InvokeAsync method, you'll see the IL and it should contain lines similar to:

```nasm {hl_lines=["7-8","28-29"]}
.method public hidebysig instance class [System.Runtime]System.Threading.Tasks.Task 
        InvokeAsync(class [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.HttpContext httpContext) cil managed
{
  .custom instance void [System.Runtime]System.Diagnostics.DebuggerStepThroughAttribute::.ctor() = ( 01 00 00 00 ) 
  // Code size       63 (0x3f)
  .maxstack  2
  .locals init (class WebApplication1.TimerMiddleware/'<InvokeAsync>d__4' V_0)
  IL_0000:  newobj     instance void WebApplication1.TimerMiddleware/'<InvokeAsync>d__4'::.ctor()
  IL_0005:  stloc.0
  IL_0006:  ldloc.0
  IL_0007:  call       valuetype [System.Runtime]System.Runtime.CompilerServices.AsyncTaskMethodBuilder [System.Runtime]System.Runtime.CompilerServices.AsyncTaskMethodBuilder::Create()
  IL_000c:  stfld      valuetype [System.Runtime]System.Runtime.CompilerServices.AsyncTaskMethodBuilder WebApplication1.TimerMiddleware/'<InvokeAsync>d__4'::'<>t__builder'
  IL_0011:  ldloc.0
  IL_0012:  ldarg.0
  IL_0013:  stfld      class WebApplication1.TimerMiddleware WebApplication1.TimerMiddleware/'<InvokeAsync>d__4'::'<>4__this'
  IL_0018:  ldloc.0
  IL_0019:  ldarg.1
  IL_001a:  stfld      class [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.HttpContext WebApplication1.TimerMiddleware/'<InvokeAsync>d__4'::httpContext
  IL_001f:  ldloc.0
  IL_0020:  ldc.i4.m1
  IL_0021:  stfld      int32 WebApplication1.TimerMiddleware/'<InvokeAsync>d__4'::'<>1__state'
  IL_0026:  ldloc.0
  IL_0027:  ldflda     valuetype [System.Runtime]System.Runtime.CompilerServices.AsyncTaskMethodBuilder WebApplication1.TimerMiddleware/'<InvokeAsync>d__4'::'<>t__builder'
  IL_002c:  ldloca.s   V_0
  IL_002e:  call       instance void [System.Runtime]System.Runtime.CompilerServices.AsyncTaskMethodBuilder::Start<class WebApplication1.TimerMiddleware/'<InvokeAsync>d__4'>(!!0&)
  IL_0033:  ldloc.0
  IL_0034:  ldflda     valuetype [System.Runtime]System.Runtime.CompilerServices.AsyncTaskMethodBuilder WebApplication1.TimerMiddleware/'<InvokeAsync>d__4'::'<>t__builder'
  IL_0039:  call       instance class [System.Runtime]System.Threading.Tasks.Task [System.Runtime]System.Runtime.CompilerServices.AsyncTaskMethodBuilder::get_Task()
  IL_003e:  ret
} // end of method TimerMiddleware::InvokeAsync
```

In the highlighted lines and in between you can see that a new `<InvokeAsync>d__4` object is being created (`newobj`).
The new objects fields are populated and then the `get_Task` method is called.
What you won't see is the code that checks the path segments for "weatherforecast".
The inner class with the strange name implements an interface called IAsyncStateMachine.
The `async` and `await` keywords are signals to the compiler that it needs to create one of these state machines.
The actual code for the method is contained within the `MoveNext` method in the state machine.

We can rewrite the middleware code to only use the async state machine when the path segment matches.
Any other routes can therefore avoid the state machine altogether.
Try rewriting the middleware as shown below:

```csharp
namespace WebApplication1;

public class TimerMiddleware
{
    public const string FullRequest = nameof(FullRequest);
    private readonly RequestDelegate _next;
    private readonly ITimerService _timerService;

    public TimerMiddleware(RequestDelegate next, ITimerService timerService)
    {
        _next = next;
        _timerService = timerService;
    }

    public Task InvokeAsync(HttpContext httpContext)
    {
        if (!httpContext.Request.Path.StartsWithSegments("/weatherforecast", StringComparison.OrdinalIgnoreCase))
        {
            return _next(httpContext);
        }

        return TimeRequestAsync(httpContext);
    }

    private async Task TimeRequestAsync(HttpContext httpContext)
    {
        _timerService.StartTimer(FullRequest);

        try
        {
            await _next(httpContext);
        }
        finally
        {
            _timerService.StopTimer(FullRequest);
            _timerService.EmitTelemetry();
        }
    }
}
```

Notice that the `InvokeAsync` method is not marked with the `async` keyword.
It returns the Task object from other methods.
Build this and load the assembly in ildasm.
The middleware class's structure should look similar.
The inner class for the async state machine will be named after the `TimeRequestAsync` method.
The most significant difference is in the IL for the `InvokeAsync` method.

```nasm {hl_lines=["18-20"]}
.method public hidebysig instance class [System.Runtime]System.Threading.Tasks.Task 
        InvokeAsync(class [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.HttpContext httpContext) cil managed
{
  // Code size       66 (0x42)
  .maxstack  3
  .locals init (bool V_0,
           valuetype [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.PathString V_1,
           class [System.Runtime]System.Threading.Tasks.Task V_2)
  IL_0000:  nop
  IL_0001:  ldarg.1
  IL_0002:  callvirt   instance class [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.HttpRequest [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.HttpContext::get_Request()
  IL_0007:  callvirt   instance valuetype [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.PathString [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.HttpRequest::get_Path()
  IL_000c:  stloc.1
  IL_000d:  ldloca.s   V_1
  IL_000f:  ldstr      "/weatherforecast"
  IL_0014:  call       valuetype [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.PathString [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.PathString::op_Implicit(string)
  IL_0019:  ldc.i4.5
  IL_001a:  call       instance bool [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.PathString::StartsWithSegments(
                                          valuetype [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.PathString,
                                          valuetype [System.Runtime]System.StringComparison)
  IL_001f:  ldc.i4.0
  IL_0020:  ceq
  IL_0022:  stloc.0
  IL_0023:  ldloc.0
  IL_0024:  brfalse.s  IL_0036
  IL_0026:  nop
  IL_0027:  ldarg.0
  IL_0028:  ldfld      class [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.RequestDelegate WebApplication1.TimerMiddleware::_next
  IL_002d:  ldarg.1
  IL_002e:  callvirt   instance class [System.Runtime]System.Threading.Tasks.Task [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.RequestDelegate::Invoke(class [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.HttpContext)
  IL_0033:  stloc.2
  IL_0034:  br.s       IL_0040
  IL_0036:  ldarg.0
  IL_0037:  ldarg.1
  IL_0038:  call       instance class [System.Runtime]System.Threading.Tasks.Task WebApplication1.TimerMiddleware::TimeRequestAsync(class [Microsoft.AspNetCore.Http.Abstractions]Microsoft.AspNetCore.Http.HttpContext)
  IL_003d:  stloc.2
  IL_003e:  br.s       IL_0040
  IL_0040:  ldloc.2
  IL_0041:  ret
} // end of method TimerMiddleware::InvokeAsync
```

On lines 18-20 you can see the call to `PathString::StartsWithSegments` to check for `"/weatherforecast"`.
What you don't see is the creation of a new object (`newobj`) in this code.
That happens in the `TimeRequestAsync` method so that it can start the async state machine.
Since the `InvokeAsync` method doesn't use the `await` keyword and returns the Task objects from other method calls, it avoids an allocation and the execution of an async state machine if the path segments don't match.

The impact of avoiding a single allocation is very small.
But the cumulative effect in performance-sensitive areas of your service (like in middleware) can reduce the amount of time spent in garbage collection.
