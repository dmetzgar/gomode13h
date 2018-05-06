---
title: "Hosting the CLR the Old Way"
date: 2015-06-02
tags: ["Native"]
---

Your native C++ Windows application can load the CLR in its process. This is easier than you think. Sometimes 
rewriting code in .NET is just not a good option. If you want to get the CLR up and running in your application
quickly, here's how to do it. The next post will go over the preferred way to host the CLR.

I assume you are using Visual Studio. If that is not the case, install the Windows SDK to get access to the 
.NET framework libraries. Start by creating a new project: Visual C++ Win32 Console Application. In the project
creation wizard, uncheck the box for Security Development Lifecycle checks. The API we will use is deprecated
and will give compilation errors if SDL is checked.

The next step is to add a new project to your solution: Visual C# Class Library. I set the .NET framework to 4.5
which adds an extra step later on. The next thing to do is create an interface that will be the primary means 
of communication from native to managed code. I use a simple Hello World example.

```csharp
using System;
using System.Runtime.InteropServices;

namespace ClassLibrary1
{
    [ComImport, Guid("9A96F42A-31BC-4899-AC30-FC6A016704EE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IFooInterface
    {
        [return: MarshalAs(UnmanagedType.LPWStr)]
        string HelloWorld([MarshalAs(UnmanagedType.LPWStr)] string name);
    }
}
```

Don't worry if you don't know much about COM. If you know a little bit about COM, you might think you need to 
create a TLB export but don't worry because that's not necessary. The GUID can be any random GUID. I created
this with Tools->Create Guid.

Now create an implementation of the above interface:

```csharp
namespace ClassLibrary1
{
    public class Foo : IFooInterface
    {
        public string HelloWorld(string name)
        {
            return "Hello " + name;
        }
    }
}
```

When the .NET DLL is built, we want it to show up in the same place as the Win32 application. Go to the 
project properties, Build tab, and set the output path to ..\Debug

One more important item is the application config. The CLR will look for the default application config 
based on the name of the native application. For instance, my Win32 application is named 
ConsoleApplication22 so I added a ConsoleApplication22.exe.config file to my .NET project. All you need
in the config file is the following if you chose .NET 4.0 or later. Earlier versions don't require this
file.

```xml
<configuration>
  <startup useLegacyV2RuntimeActivationPolicy="true">
    <supportedRuntime version="v4.0" />
  </startup>
</configuration>
```

In the solution explorer be sure to set the following properties for ConsoleApplication22.exe.config file:

* Build Action - None
* Copy to Output Directory - Copy if newer

Now it's time to create an interface in the native C++ project that matches the IFooInterface. Add a header
called _FooInterface and insert the following code:

```c
#pragma once

#include "stdafx.h"
#include <unknwn.h>

#define FOO_GUID "9A96F42A-31BC-4899-AC30-FC6A016704EE"

struct __declspec(uuid(FOO_GUID)) _FooInterface;

struct _FooInterface : IUnknown
{
    virtual
        HRESULT __stdcall HelloWorld(LPWSTR name, LPWSTR* result) = 0;
};
```

Note that the GUID defined above matches the GUID from the IFooInterface in the .NET assembly. The 
return type is always the HRESULT so the return value from the managed side is put into the 
parameter list.

The next step is to create the managed object from native code and try it out. Here are the 
contents of main:

```c
#include "stdafx.h"
#include "_FooInterface.h"
#include <mscoree.h>

int _tmain(int argc, _TCHAR* argv[])
{
    _FooInterface * pFoo = NULL;
    _FooInterface ** ppFoo = NULL;
    ppFoo = &pFoo;
    HRESULT hr = ClrCreateManagedInstance(
        L"ClassLibrary1.Foo, ClassLibrary1, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null",
        __uuidof(_FooInterface),
        (LPVOID*)ppFoo
        );

    if (!SUCCEEDED(hr))
        return 1;

    LPWSTR text;
    hr = pFoo->HelloWorld(L"Player One", &text);
    
    if (!SUCCEEDED(hr))
        return 1;

    wprintf(text);
    return 0;
}
```

One of the includes above is for mscoree.h. That header comes from the Windows SDK. You also
need to link in the library file. To do this, open the project properties. Go to 
Configuration Properties->Linker->Input. Edit the Additional Dependencies and add
mscoree.lib. You should now be able to build and run the solution.
 
Tip: If you want to debug into the managed assembly, go to the project properties for the 
native assembly, Configuration Properties->Debugging and set Debugger Type to Mixed. Be 
sure to build the solution before running since F5 tends to only build the native assembly.

In [the next post](/posts/clrhostingright), I'll go over how to host the CLR the right way since the 
ClrCreateManagedInstance is deprecated and unsafe.
