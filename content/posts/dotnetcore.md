---
title: "Why choose .NET Core?"
date: 2016-09-28
tags: [".NET Core"]
---

*An excerpt from my new book: [.NET Core in Action](https://manning.com/books/dotnet-core-in-action)*

Learning a new development framework is a big investment. You need to learn how to write,
build, test, deploy, and maintain applications in the new framework. For developers, there
are many frameworks to choose from, and it’s difficult to know which is the best for the job.
What makes .NET Core worth the investment?

To answer this question, it helps to know where you’re starting from. If you’re
completely new to .NET, welcome! If you’re already a .NET developer, I’ll provide some
guidance as to whether .NET Core is right for you at this time. .NET Core is still
evolving to meet customer demands, so if there is a critical piece of the .NET Framework you
need, it may be good to wait a few releases. Whether you are familiar with .NET or are
just learning about it, [.NET Core in Action](https://manning.com/books/dotnet-core-in-action) 
will get you writing professional applications with .NET Core in short time.

# Architecting enterprise applications before .NET Core
Early in my career, I worked for a car insurance company. Its developers were attempting
to improve the efficiency of claims adjusters. When you get into a car accident, a
representative of the insurance company—a claims adjuster—will sometimes go directly
to the scene of the accident and assess the damage. Adjustors would collect information, usually on
paper, and then head back to the office where they could enter the data into an application on
a desktop or laptop computer. The process was slow and required a lot of manual work.

The insurance company wanted to enable claims adjusters to enter the data directly into
the claims system from the scene. They would then be able to get cost estimates and access the
car owner’s insurance policy on the spot. For the insurance company, this meant quicker
claim resolution and less cost. One of the secrets I learned about the car insurance
industry is that they want to get a disbursement to the claimant quickly. The less time
the claimant has to reflect on the estimate, the less likely they’ll negotiate for a
higher payout.

Accessing the claims system from the scene meant changing the architecture to incorporate
mobile devices. The below figure shows the high-level design.

![Claims application high-level diagram](/img/chapter1_a.png "Claims application high-level diagram")

In the past, implementing this kind of architecture equated to substantial costs. Creating cell
phone and tablet applications required either hiring developers for both iOS and Android
ports or standardizing on hardware to limit the number of platforms. An adjuster might
travel to a remote location with poor or nonexistent cellular service, so the application
needed to operate offline. The different languages and platforms used in each piece of
the architecture made integration and maintenance difficult. Changes in business logic
meant rewriting the logic in several languages. At the time, scaling was too slow to
adjust for demand during the workday, so the hardware requirements were based on peak load.
The expenses kept piling up.

What if you could use not just the same code but the same libraries across the
applications, website, and services? What if you built one app and it worked on iOS,
Android, and Windows? What if your website and services could fit into small containers
and elastically scale in response to demand? If all that were possible, it would
dramatically reduce the cost of building and maintaining systems like the claims architecture.

These questions are no longer hypothetical. .NET Core is a software framework that makes
all of this possible. Developers are not confined to a particular language, operating
system, or form factor. .NET Core is engineered to be small and modular, making it perfect
for containers. It is built and supported by Microsoft but is also open source, with an active
community. Having participated in software projects like the claims application, I’m
excited about the possibilities introduced by .NET Core.

# If you are a .NET Framework developer
For some .NET Framework components, .NET Core is a reboot, and for others it’s a chance to work
cross-platform. Because the .NET Framework was built mostly in managed (C#) code, those
portions didn’t need code changes to move to .NET Core. But there are libraries that depend
on Windows-specific components, and they had to either be removed or refactored to use
cross-platform alternatives. The same will apply to your applications.

## Your .NET apps can be cross-platform
Once they’re ported to .NET Core, your existing .NET Framework applications can now work on other operating systems. This
is great for library authors who want to expand their audience or developers who want to
use the same code in different parts of a distributed application. It’s also great if you’d just
like to develop in .NET on your shiny new MacBook without having to dual boot to Windows.

Although
not all of the Framework has been ported to .NET Core, major portions have. There are also
some API differences. For example, if you use a lot of reflection, you may need to
refactor your code to work with .NET Core. Section <<DifferencesFromNetFramework>> provides more information on the differences,
which can help you determine if it’s feasible to port to .NET Core.

## ASP.NET Core outperforms ASP.NET in the .NET Framework 
The ASP.NET team built a new version of ASP.NET for .NET Core called ASP.NET Core. 
The difference in performance between ASP.NET Core and Framework ASP.NET is many orders
of magnitude. Much of ASP.NET was built on the legacy System.Web library, and the .NET
Framework supports older versions of ASP.NET projects. That constraint has restricted
ASP.NET’s evolution. With .NET Core, Microsoft decided to rewrite the whole stack. Although this
does mean breaking changes, the gains are worth the effort of migrating.

## .NET Core is the focus for innovation
One of the critical principles of the .NET Framework is that new releases shouldn’t 
break existing applications. But this backwards compatibility 
is a double-edged sword. A lot of effort goes into making sure that changes made in new
releases of the .NET Framework usually won’t break existing applications. But this goal 
of avoiding breaking changes restricts innovation. Changes
to the .NET Framework need thorough justification (usually from customers), exhaustive testing,
and approval from many levels of product groups. I’ve been in meetings where people argued
over one- or two-line code fixes, which caused me to reconsider my life choices.

With .NET Core, it’s much easier for internal Microsoft teams to work on their library independent of the
core libraries. Changes to core libraries, like System.Collections, still require the same
rigor as with .NET Framework, but it’s easier to make substantial changes to ASP.NET Core or Entity
Framework Core without being constrained by backwards
compatibility. This allows for greater innovation.

.NET Framework ships as one product, whereas Core is broken up into pieces.
Developers can now choose which version of a library they want to use, as long as it’s
outside the .NET Standard Library, and .NET Core teams can innovate with less difficulty.
This is why, in the future, you’ll see only bug fixes for the Framework. Core will
get all the new features.

## Release cycles are faster
If you’ve ever encountered a bug in the .NET Framework and reported it to Microsoft, you’re
aware of how long it takes for a fix to be released. The Framework has long release
cycles, usually measuring at least a year, and there are tiny windows during these
cycles for feature work. Each code change can cause issues in unexpected places
elsewhere in the Framework. To give each team enough time to test,
there are many times when code changes are restricted or heavily scrutinized. If you find
a bug in .NET, you’re better off finding a workaround than waiting for an update.

.NET Core follows a faster release cadence. Developers can use nightly builds
to test early. Libraries that aren’t part of the .NET Standard Library can release
at their own pace. Because everything is open source, any developer can propose a fix if
Microsoft doesn’t respond quickly enough. If the fix isn’t accepted, the discussion is
held in public so everyone can see why that decision was made.

# If you are new to .NET
On Windows platforms, the .NET Framework hasn’t had much competition. Microsoft could
make changes to everything from the OS kernel layers up through the high-level .NET
libraries. By taking .NET to other platforms, the playing field has changed. .NET must
now compete with all the other development frameworks out there. Here are some things that
set .NET apart.

## C# is an amazing language
The flagship language of .NET, C#, has many distinguishing features, such as Language
Integrated Query (LINQ) and asynchronous constructs, which make it powerful and easy to use.
C# also continues to innovate. The C# team designs the language openly so that anyone can
make suggestions or participate in the discussion. The compiler (Roslyn) is entirely
modular and extensible. I recommend picking up another Manning book, _C# in Depth_ by Jon Skeet, to
learn more.

## .NET Core is not starting from scratch
.NET has been around since before 2000. The Framework code has been hardened over
the years, and its developers have benefited from the experience. Much of the Framework
code that has been ported to Core is untouched. This gives .NET Core a head start in
terms of having a reliable framework for building applications. .NET Core is also completely
supported by Microsoft. A lack of support can keep some organizations from adopting open
source software. Microsoft’s support decreases the risk of using Core for your applications.

## Focus on performance 
The Common Language Runtime (CLR) team at Microsoft has been optimizing garbage 
collection and just-in-time (JIT) compilation since the beginning of .NET, and they’re 
bringing this highly tuned engine to .NET Core. They also have projects underway to 
perform native compilation of .NET Core applications, which will significantly reduce 
startup times and the size on disk—two important characteristics for fast scaling in 
container environments. 

# What is .NET Core?
To understand .NET Core, it helps to understand the .NET Framework.
Microsoft released the .NET Framework in the early 2000s. The .NET Framework is a
Windows-only development framework that, at its lowest level, provides memory management,
security, exception handling, and many other features. It comes with an
extensive set of libraries that perform all kinds of functions, from XML parsing to HTTP
requests. It also supports several languages and compiles them into the same common
intermediate language, so any language can use a library built in any other language.
These key concepts are also present in .NET Core.

In 2016, Microsoft acquired Xamarin and released .NET Core 1.0. Xamarin was responsible for
porting large parts of the .NET Framework to run on Linux/Unix-based operating systems in
the past. Although some of the code could be shared between the .NET Framework, Xamarin, and
the new .NET Core, the compiled binaries could not. Part of the effort of building .NET Core was to
standardize so that all .NET implementations could share the same
libraries. The figure below shows what this standardization looks like.

![.NET Framework, .NET Core, and Xamarin all implement the same standard called the .NET Standard Library](/img/dotnet_core_architecture2.png ".NET Framework, .NET Core, and Xamarin all implement the same standard called the .NET Standard Library")

Xamarin and the .NET Framework were previously silos, where binaries could not be shared
between them. With the introduction of the .NET Standard Library and the common
infrastructure, these two frameworks are now part of a unified .NET ecosystem.

So what is .NET Core then? In figure <<DotnetCoreArchitecture>> it appears that .NET Core is just another
framework that includes UWP (Universal Windows Platform) and ASP.NET Core. In order to
make .NET Core a reality, however, the authors also created the .NET Standard Library and the common
infrastructure. .NET Core is really all three of these things. 

# Key .NET Core features
.NET Core borrows the best from the .NET Framework and incorporates the latest
advancements in software engineering. The following sections identify a few of the distinguishing features of
.NET Core.

## Expanding the reach of your libraries
With .NET Core you can write your application or library using the .NET Standard Library.
Then it can be shared across many platforms. In the figure below, `MyLibrary` is
deployed across cloud services, web servers, and many client platforms.

![.NET Core development](/img/chapter1_b.png ".NET Core development")

The same library can work in your backend service on your premises or in the cloud and also in your
client application running on a cell phone, tablet, or desktop. Instead of building
separate apps for iOS, Android, and Windows, you can build one app that works on all
platforms. .NET Core is small and perfect for use in containers, which scale easily and
reduce development time.

.NET Core and the .NET Standard Library establish a common standard. In the past
when a new version of an operating system or a new
device came along, it was the responsibility of the developer to rebuild their application
or library for that new runtime or framework and distribute the update. With .NET Core there is no
need to rebuild and redistribute. As long as the new runtime or framework supports all of your
dependent libraries, it will support your application. 

## Simple deployment on any platform
Microsoft products tend to have complex installation processes. COM components, registry
entries, special folders, GAC—all are designed to take advantage of Windows-only
features. The .NET Framework relies on these constructs, which makes it unsuitable for
other operating systems.

When shipping an application that relies on the .NET Framework, the installer has to be
smart enough to detect whether the right .NET Framework version is installed, and if not, provide a
way for the user to get it. Most modern Windows versions include the .NET Framework, and this
makes certain applications easier to install, but it can cause complications if the
application uses features that are not installed by default, such as ASP.NET integration
with IIS or WCF components.

Another complication comes from patches. Patches that include bug fixes or security
updates can be distributed to customers via Windows update or through the Microsoft
Download Center. But the .NET Framework you test your application on may have different
patches than the ones customers are using. It is often difficult to determine what causes
strange behavior in an application if you assume that the .NET Framework is the same
for all customers.

.NET Core’s modular design means that you only include the dependencies you need,
and all of those dependencies go into the same folder as your application. Deploying an
application is now as simple as copying a folder—what Microsofties refer to as
“xcopy-deployable” (xcopy being a Windows tool for copying files and folders). Another
advantage to this approach is that you can have multiple versions running side by side.
This strategy is key to making the deployment experience consistent on all platforms.

## Clouds and containers
In cloud systems, it’s important to drive for higher density—serving more 
customers with less hardware. The smaller the footprint of an application, the higher the
density. 

The most common approach to deploying an application in cloud systems has been the 
virtual machine. A virtual machine allows an operating system to be installed on virtual 
hardware. The virtual machine is stored in a small number of files that can be easily 
replicated. But virtual machines have several problems:

* __Size__ — A typical virtual machine file is gigabytes, if not tens of gigabytes. This makes
it time-consuming to transfer them across networks, and it has significant requirements on disk
space.
* __Startup times__ — Starting a virtual machine means starting an operating system. For
Windows, this presents a challenge, because it may take minutes to start a new machine. This
can make handling sudden bursts of traffic difficult.
* __Memory__ — The virtual machine needs to load an entire operating system into memory, along
with the applications. This means a lot of a host’s memory can be redundant and therefore
wasted.
* __Inconsistency__ — Although the same virtual machine can be copied to multiple hosts, the
hosts have to provide the same virtualized hardware, which can be dependent on the
physical hardware. There is no guarantee that a virtual machine will operate the same way,
if at all, on any given host.

Containers solve the issues of virtual machines by also virtualizing the operating system—
the container only holds the application and its dependencies. File sizes are many times
smaller, startup times are measured in seconds, only the application is loaded in memory, and the
container is guaranteed to work the same on any host.

The .NET Framework was designed to be built into Windows, and it doesn’t fit well into
containers. A Framework application depends on the Framework being installed. Given the
clear advantages of containers, one of the design decisions of .NET Core was to make it
modular. This means that your .NET Core application can be “published” so that it
and all of its dependencies are in one place, which makes it easy to put into a container.

## ASP.NET performance
ASP.NET is a set of libraries built into the .NET Framework for creating web applications. 
It 
was released in 2002 with the first version of the .NET Framework, and it has continued to 
evolve. Despite its success (being used by many high-profile organizations, including Stack Overflow), there was a feeling among the ASP.NET team that they were 
losing developers because ASP.NET performance is not competitive, and because it only works on the 
Windows platform.

A company called TechEmpower runs a benchmark of web application frameworks every few
months and provides a ranking in several categories. The benchmarks are run on
Linux, so Windows-only frameworks are not included. For the ASP.NET team, this was
a problem. There are many frameworks for writing cross-platform web applications,
and their performance numbers are impressive. Some Java frameworks, like Rapidoid and
Undertow, were posting astronomical numbers: Rapidoid with 3.7 million plaintext requests 
per second and Undertow with 2.9 million.

![TechEmpower benchmark round 14, May 2017](/img/techempower.png "TechEmpower benchmark round 14, May 2017")

On round 11 of the TechEmpower benchmark, ASP.NET MVC on the Mono framework was included in
the testing. The results were not good. ASP.NET on Mono produced a paltry 2,000 plaintext
requests per second. But because Mono wasn’t created by Microsoft, it wouldn’t have
received the same amount of performance tuning as the regular .NET Framework. To get a
fairer comparison, the ASP.NET team decided to run a benchmark with .NET 4.6 on the same
hardware as TechEmpower. The result was around 50,000 requests per second, not even
close to NodeJS (320,000 requests per second) or any of the other top frameworks on the
TechEmpower list.

The pitifully low score wasn’t exactly a surprise. As mentioned before, the ASP.NET team
knew some of the hurdles that stood in the way of being competitive with frameworks like
NodeJS. These hurdles could only be cleared by rewriting the whole thing. One major
difficulty with ASP.NET was that it needed to support customers’ legacy code, including
“classic ASP,” which preceded .NET. The only way to free ASP.NET from the legacy code
burden was to start over.

The ASP.NET team embarked on building ASP.NET Core, and many months later they 
celebrated crossing the 1 million requests per second mark. 
There is a team dedicated to pushing that number even higher, as well 
as to improving the performance of many other real-world scenarios.

Improving the performance of ASP.NET is indicative of a shift in Microsoft’s thinking.
Microsoft realizes that it has to be competitive to win developers. It also has to compete
on platforms other than Windows. ASP.NET was the driving force behind the creation of .NET
Core.

## Open source
Historically, Microsoft has been very tight-lipped about new products and features under
development. There are
good reasons for this: First, the competition has less time to respond if they first find out
about a feature on the day it ships. Also, if a feature was targeted for a particular release
date and wasn’t done on time, it could be postponed without much issue, because customers
didn’t know about it. Plus, it always helps to have new stuff to announce at conferences.

But modern software developers are not content to ask for a feature and hope it is delivered
in the next release, which could be a year away. This is especially true when there may be
an open source project that could fulfill their needs. As large companies warm to open source
software, even the most faithful Microsoft developers turn to other frameworks and
libraries to get their own projects done on time and within budget. Microsoft needed to make a change.

Exposing the source for the .NET Framework was the first step. The .NET Framework source
code has been publicly available for years at referencesource.microsoft.com and also on
GitHub. The Reference Source website makes it easy to search the source code of the .NET
Framework.

It is one thing to expose the source and quite a different thing to accept external
contributions. The .NET Core developers not only wanted to allow external contributions,
they wanted to include the community in the design and development. This led to a lot more
transparency. Every week, the ASP.NET Core team holds a live community standup meeting at
http://live.asp.net. The code for .NET Core has been available publicly on GitHub from the
start, and anyone can make a pull request. Community members can also create bugs and
feature requests in GitHub. .NET Core marked a significant change in direction for
Microsoft regarding open source.

## Bring your own tools
Because .NET Core works on many platforms, command-line functionality is crucial for .NET 
Core tooling. For some Linux variants, or when working with Docker containers, a terminal 
may be all that’s available. The .NET Command-Line Interface (CLI) was designed for this 
purpose. 

I can’t make any assumptions about what
kind of editor you’ll use to write your code. You can use an integrated development
environment like Visual Studio or a simple text editor like vi or emacs. There are also
plenty of tools that feature syntax highlighting, like Notepad2 or Sublime. 

# Applying .NET Core to real-world applications
What sets .NET Core apart from other frameworks when it comes to building real-world applications?
Let’s look back at the claims architecture diagram from earlier. A claims adjuster goes to the
scene of an accident and enters the evidence (notes and photos, for example)
into a software application that generates the estimate. In order to determine what evidence needs to be
collected, the software may use complex, proprietary business logic. The adjuster needs to
gather this information regardless of connectivity, so it will be helpful to have the business logic
available in the mobile application.

Rewriting all the business logic in a language suitable for a mobile application
introduces a maintenance issue. Both the team working on the server side and the team 
writing the mobile application must update their codebases with
any changes to the business logic. Ownership gets split between teams, and keeping in sync
becomes difficult. With Xamarin support for the .NET Standard library, web services and
mobile applications alike can use the same business logic library. Claims adjusters get
consistent behavior, and maintenance costs go down.

> ## Scaling in response to demand
> In the case of a natural disaster, such as a hurricane or flood, claims adjusters will
> be working overtime, increasing demand. The claims architecture needs to scale to meet
> this demand. With the improved performance of ASP.NET Core and the ability to deploy
> .NET Core applications to containers, adjusters can rely on the claims system to
> handle the workload. This is important to the insurance company, because downtime of
> backend systems directly affects customer experience and slows down adjusters.

## Differences from the .NET Framework
.NET Core is not simply the .NET Framework for Linux and Mac. Rather than port all
of the .NET Framework, Microsoft has taken the approach of waiting to see what customers
want. There has to be enough customer interest in a framework feature to persuade
Microsoft to allocate the resources to do a port. One of the obstacles to porting is that
the teams that originally built these features have almost completely moved on.
Luckily for ASP.NET customers, the ASP.NET team was the driver behind .NET Core. MVC,
Web API, and SignalR are either all available in .NET Core or are on the roadmap.

## Framework features not ported to Core
The following list identifies Framework features not currently ported to .NET 
Core, but I provide this with the knowledge that things can change. Some 
features don’t apply to non-Windows platforms. There are other features that 
Microsoft doesn’t want to carry forward into the future, either because there 
are better replacements or because
the feature was problematic in some way (insecure, hard to maintain, etc.).

* __WPF/XAML__ — The Windows Presentation Foundation is only meant for user interfaces. The
.NET Standard Library does not include UI libraries, and .NET Core does
not attempt to provide a cross-platform UI framework.
* __Transactions__ — This library made it easy to create distributed transactions, but it relies
on Windows-specific components, so it’s not readily portable to .NET Core.
* __AppDomains__ — These were useful for isolating assemblies so they could be unloaded without
killing the process, which is great for applications that allow plugins. They rely on some
Windows-specific constructs that would not work on other operating systems.
* __.NET remoting__ — Remote objects have been succeeded by REST services.
* __ASMX__ — This was an old way of writing web services that has been replaced by Web API.
* __Linq to SQL__ — This has been replaced by Entity Framework.
* __WCF services__ — Windows Communication Foundation client capabilities are available in
.NET Core, but you can’t create services.
* __WF__ — Windows Workflow Foundation depends on XAML, WCF services, and transactions, among
other .NET Framework-only features.

## Subtle changes for .NET Framework developers
Experienced .NET Framework developers may encounter a few surprises when working in .NET
Core. Writing new code should be relatively straightforward, because you’re unlikely to use
older constructs like `HashTable` or `ArrayList`. Visual Studio’s Intellisense will also
indicate whether a type, method, property, and so on, is supported in .NET Core. In 
the figure below, you can see the auto-completion window flagging members that are 
different in .NET Core.

![Visual Studio Intellisense indicates whether a class or member is available in .NET Core](/img/intellisense_annotated.png "Visual Studio Intellisense indicates whether a class or member is available in .NET Core")

1. Target Framework
2. Member not available in some frameworks
3. Lists availability of member by framework

### .NET Portability Analyzer
If you’re attempting to convert an existing .NET application to .NET Core, the best place
to start would be the .NET Portability Analyzer. It’s available both as a command-line
application and a Visual Studio plugin. This tool creates a detailed report with useful
suggestions wherever possible. 

## Changes to .NET reflection
Reflection works differently in .NET Core than in the .NET Framework. The most noticeable
difference is that a lot of the operations normally available in the `Type` class are no
longer available. Some have been moved to a new class called `TypeInfo`. 

# Additional resources 
To find out more about .NET Core and C#, try the following resources:

* Microsoft’s .NET Core Guide: https://docs.microsoft.com/en-us/dotnet/core/
* _C# in Depth_, fourth edition, by Jon Skeet (Manning, 2018): http://mng.bz/6yPQ
* ASP.NET Core Community Standups: http://live.asp.net

# Summary
The software development industry is constantly evolving. Everything is challenged and
improved, from languages to frameworks to tools to methodologies. The .NET Framework has
reached a point where it is too rigid and monolithic to keep up with its competitors. .NET
Core is the necessary next step in the evolution of .NET. It combines the best of the .NET
Framework with the practices used in modern software development.

Learning a new software development framework requires an investment of time and resources. Even
if you’re familiar with the .NET Framework, there is much to learn about .NET Core.
With .NET Core you can write code that’s portable across all platforms, use containers to
control scaling, and build high-performance web applications. 
