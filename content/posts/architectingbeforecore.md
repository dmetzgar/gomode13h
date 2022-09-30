---
title: "Architecting enterprise applications before .NET Core"
date: 2017-01-06
tags: ["dotnetcore"]
---

_An excerpt from my new book: [.NET Core in Action](https://manning.com/books/dotnet-core-in-action)_

Early in my career, I worked for a car insurance company. Its developers were attempting to improve
the efficiency of claims adjusters. When you get into a car accident, a representative of the 
insurance company - a claims adjuster - will sometimes go directly to the scene of the accident and 
assess the damage. The adjuster collects information, usually on paper, then heads back to the 
office where the data can be entered into an application on a desktop or laptop computer. The 
process is slow and requires a lot of manual work.

The insurance company wanted to enable claims adjusters to enter the data directly into the claims 
system from the scene. They could get cost estimates and access the car owner’s insurance policy 
on the spot. For the insurance company, this means quicker claim resolution and less cost. One of 
the secrets I learned is that the car insurance industry wants to get a disbursement to the 
claimant quickly. The less time the claimant has to reflect on the estimate, the less likely 
they’ll negotiate for a higher payout.

Accessing the claims system from the scene meant changing the architecture to incorporate mobile 
devices. Here's an example high-level design:

![](/img/chapter1_a.png)

In the past, implementing this kind of architecture resulted in substantial costs. Cell phone and 
tablet applications require either hiring developers for both iOS and Android ports, or 
standardizing on hardware to limit the number of platforms. An adjuster might travel to a remote 
location with poor or nonexistent cellular service and the application would have to have offline 
functionality. The different languages and platforms used in each piece of architecture made 
integration and maintenance difficult. Changes in business logic meant rewriting the logic in 
several languages. At the time, scaling was too slow to adjust for demand during the workday, and 
the hardware requirements were based on peak load. The expenses kept piling up.

What if you could use not only the same code, but the same libraries across the applications, 
website, and services? What if you built one app and it worked on iOS, Android, and Windows? What 
if your website and services could fit into small containers and elastically scale in response to 
demand? If all that were possible, it would dramatically reduce the cost to build and maintain 
systems like the claims architecture.

These questions are no longer hypothetical. .NET Core is a software framework that makes all of 
this possible. Developers aren’t confined to one language or operating system or form factor. 
.NET Core is engineered to be small and modular, making it perfect for containers. It’s built 
and supported by Microsoft, but also open source with an active community. Having participated 
in software projects like the claims application, I’m excited about the possibilities 
introduced by .NET Core.

To learn more, download the free first chapter of 
[.NET Core in Action](https://manning.com/books/dotnet-core-in-action) and see 
this [Slideshare presentation](http://www.slideshare.net/ManningBooks/net-core-in-action)
for a discount code.
