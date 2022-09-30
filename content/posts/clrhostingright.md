---
title: "Hosting the CLR the Right Way"
date: 2015-06-03
tags: ["nativecode"]
---

The previous post covered the easy way to host the CLR in a native process by using a 
deprecated API. When you use this API, Visual Studio will print the following warning:

warning C4996: 'ClrCreateManagedInstance': This API has been deprecated. Refer to 
http://go.microsoft.com/fwlink/?LinkId=143720 for more details.

But good luck trying to figure out what you're supposed to do from that page. It
basically tells you to use the hosting APIs or call directly through COM. The call 
directly through COM sounds easy but requires using a TLB export which puts COM stuff
in the registry. ClrCreateManagedInstance did not require that. I'd rather not do that.
So in this post, I go over what it takes to use the hosting APIs in the most basic way. 

I assume you are using Visual Studio. If that is not the case, install the Windows SDK to get access to the
.NET framework libraries. Start by creating a new project: Visual C++ Win32 Console Application. In the main
cpp file, include the <metahost.h> header. Let's walk through the process of hosting the CLR. The 
first step is [CLRCreateInstance](https://msdn.microsoft.com/en-us/library/dd537633%23v=vs.110%24.aspx).

*Note that the metahost header comes from the Windows SDK. You also
need to link in the library file. To do this, open the project properties. Go to
Configuration Properties->Linker->Input. Edit the Additional Dependencies and add
mscoree.lib.*

```c
ICLRMetaHost *pMetaHost = NULL;
HRESULT hr = CLRCreateInstance(CLSID_CLRMetaHost, IID_ICLRMetaHost, (LPVOID*)&pMetaHost);
```

The first two parameters indicate what interface you're looking for. You can load a specific CLR or even 
get a debugging interface. For our case, we want to enumerate the available runtimes. Therefore we chose
[ICLRMetaHost](https://msdn.microsoft.com/en-us/library/dd233134%23v=vs.110%24.aspx).

```c
IEnumUnknown *installedRuntimes;
hr = pMetaHost->EnumerateInstalledRuntimes(&installedRuntimes);

ICLRRuntimeInfo *runtimeInfo = NULL;
ULONG fetched = 0;
while ((hr = installedRuntimes->Next(1, (IUnknown **)&runtimeInfo, &fetched)) == S_OK && fetched > 0) {
    wchar_t versionString[20];
    DWORD versionStringSize = 20;
    hr = runtimeInfo->GetVersionString(versionString, &versionStringSize);

    // Look for the 4.0 runtime
    if (versionStringSize >= 2 && versionString[1] == '4') {
        break;
    }
}
```

This code is a little contrived in that I'm checking the version string to start with "v4" to locate 
the 4.0 runtime. I'm sure you could come up with better ways to find 4.0 out of the enumerated 
runtimes. You also don't have to enumerate them. You could instead call the GetRuntime method 
to get a specific version.

```c
ICLRRuntimeHost *runtimeHost = NULL;
hr = runtimeInfo->GetInterface(CLSID_CLRRuntimeHost, IID_ICLRRuntimeHost, (void **)&runtimeHost);
```

Here we get the [ICLRRuntimeHost](https://msdn.microsoft.com/en-us/library/ms164408%23v=vs.110%24.aspx).
That will allow us to set the host control. The host control has two important functions: setting host 
managers and setting the AppDomain manager. Host managers allow you to customize the CLR runtime. For 
instance, you could have a memory host manager that allows you to change how memory is allocated and freed.
There are a whole set of host managers for categories such as threading, synchronization, assembly loading,
and garbage collection. I'm not interested in customizing the CLR runtime so I won't be going over host 
managers. The area I am interested in is the AppDomainManager. That is essentially my window into the 
CLR AppDomain. Here is a sample implementation of a host control class.

```c
#pragma once

#include "stdafx.h"
#include "_FooInterface.h"
#include <metahost.h>

class SampleHostControl : IHostControl 
{ 
public:
    SampleHostControl()
    {
        m_refCount = 0;
        m_defaultDomainManager = NULL;
    }

    virtual ~SampleHostControl()
    {
        if (m_defaultDomainManager != NULL)
        {
            m_defaultDomainManager->Release();
        }
    }

    HRESULT __stdcall SampleHostControl::GetHostManager(REFIID id, void **ppHostManager)
    {
        *ppHostManager = NULL;
        return E_NOINTERFACE;
    }

    HRESULT __stdcall SampleHostControl::SetAppDomainManager(DWORD dwAppDomainID, IUnknown *pUnkAppDomainManager)
    {
        HRESULT hr = S_OK;
        hr = pUnkAppDomainManager->QueryInterface(__uuidof(_FooInterface), (PVOID*)&m_defaultDomainManager);
        return hr;
    }

    _FooInterface* GetFooInterface()
    {
        if (m_defaultDomainManager)
        {
            m_defaultDomainManager->AddRef();
        }
        return m_defaultDomainManager;
    }

    HRESULT __stdcall QueryInterface(const IID &iid, void **ppv)
    {
        if (!ppv) return E_POINTER;
        *ppv = this;
        AddRef();
        return S_OK;
    }

    ULONG __stdcall AddRef()
    {
        return InterlockedIncrement(&m_refCount);
    }

    ULONG __stdcall Release()
    {
        if (InterlockedDecrement(&m_refCount) == 0)
        {
            delete this;
            return 0;
        }
        return m_refCount;
    }

private:
    long m_refCount;
    _FooInterface* m_defaultDomainManager;
};
```

Notice the implementation of GetHostManager always returns E_NOINTERFACE. This method is called 
for each host manager and you can check the id to see which host manager is being asked for.
Again, since I'm not interested in customizations, I always return nothing to tell the CLR to 
use the default.

The SetAppDomainManager method will be invoked when the AppDomain is created. We don't specify
what the AppDomain manager is in this method. Instead it passes an IUnknown reference to that
object. This is where you can take the opportunity to store it for later. I'm borrowing the 
really simple FooInterface from the last post. Here's the _FooInterface.h contents:

```c
#pragma once

#include "stdafx.h"
#include <unknwn.h>

#define FOO_GUID "A15DDC0D-53EF-4776-8DA2-E87399C6654D"

struct __declspec(uuid(FOO_GUID)) _FooInterface;

struct _FooInterface : IUnknown
{
    virtual
        HRESULT __stdcall HelloWorld(LPWSTR name, LPWSTR* result) = 0;
};
```

Now we go back to main and set the host control on the runtime host.

```c
SampleHostControl* hostControl = new SampleHostControl();
hr = runtimeHost->SetHostControl((IHostControl *)hostControl);
```

The next step is the custom AppDomain manager. It inherits from the 
[AppDomainManager](https://msdn.microsoft.com/en-us/library/system.appdomainmanager%23v=vs.110%24.aspx)
class. Much like the host control it provides customization that we're not going to use.
Add a new project to your solution: Visual C# Class Library using .NET framework 4.5. Add 
a CustomAppDomainManager class to the project:

```csharp
using System;

namespace FunProject1
{
    public sealed class CustomAppDomainManager : AppDomainManager, IFooInterface
    {
        public CustomAppDomainManager() { }

        public override void InitializeNewDomain(AppDomainSetup appDomainInfo)
        {
            base.InitializationFlags = AppDomainManagerInitializationOptions.RegisterWithHost;
        }

        public string HelloWorld(string name)
        {
            return "Hello " + name;
        }
    }
}
```

My custom AppDomainManager implements the FooInterface from the previous post. Here 
is the code for that interface:

```csharp
using System;
using System.Runtime.InteropServices;

namespace FunProject1
{
    [ComImport, Guid("A15DDC0D-53EF-4776-8DA2-E87399C6654D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IFooInterface
    {
        [return: MarshalAs(UnmanagedType.LPWStr)]
        string HelloWorld([MarshalAs(UnmanagedType.LPWStr)] string name);
    }
}
```

When the .NET DLL is built, we want it to show up in the same place as the Win32 application. Go to the
project properties, Build tab, and set the output path to ..\Debug

That's it for the managed assembly side so let's go back to main and set this AppDomainManager on 
our hosted runtime.

```c
ICLRControl *clrControl = NULL;
hr = runtimeHost->GetCLRControl(&clrControl);

hr = clrControl->SetAppDomainManagerType(L"FunProject1", L"FunProject1.CustomAppDomainManager");
```

You can be more specific about the assembly by providing a fully qualified name.

And now for the last bit where we start the runtime, do something with it, then stop it. 

```c
hr = runtimeHost->Start();

LPWSTR text;
_FooInterface* appDomainManager = hostControl->GetFooInterface();
hr = appDomainManager->HelloWorld(L"Player One", &text);

hr = runtimeHost->Stop();

wprintf(text);
```

You should now have a CLR runtime hosted in a native application the right way. It's not intuitive 
having the main interface into the CLR through the AppDomainManager, which is part of the reason
why I found it difficult to understand how to properly host the CLR. The other reason is the lack
of cohesive documentation. The best material I found on this subject is Steven Pratschner's
[Customizing the Microsoft .NET Framework Common Language Runtime](http://www.amazon.com/Customizing-Microsoft%C2%AE-Framework-Developer-Reference/dp/0735619883). This book was printed in 2005 so a lot of the information is outdated since it only deals 
with .NET 2.0. I had to go back and forth between this book and the MSDN documentation to figure 
it all out.
