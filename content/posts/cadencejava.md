---
title: "Cadence Java Client Starter"
date: 2019-02-10
tags: ["Cadence","Workflow"]
---

In this post, I'll be covering how to build Cadence workflows in Java. First, you'll need the JDK installed. If you're using Java 11, you
may run into [this issue](https://github.com/facebook/react-native/issues/22487), which prints *Could not determine java version from 
'11.0.1'* when you attempt to build the samples. The TLDR is that you should just downgrade to 
[Java 8](https://www.oracle.com/technetwork/java/javase/downloads/jdk8-downloads-2133151.html).

The [Cadence Java samples](https://github.com/uber/cadence-java-samples) use Gradle. The installation instructions for Gradle are 
[here](https://gradle.org/install/). You'll want to install Gradle before using IntelliJ so that Gradle is discoverable from the 
environment. Before building with Gradle on Windows, be sure to set your JAVA_HOME environment variable using 
[these instructions](https://javatutorial.net/set-java-home-windows-10).

For this client, I used [IntelliJ](https://www.jetbrains.com/idea/). The community edition is free and has all the features needed for 
this tutorial.

To launch a Cadence server on your local machine, you can use the instructions covered in my 
[earlier post](https://www.mode19.net/posts/cadenceonwin/).

Before running the samples, we need a sample domain. The Java samples' 
[instructions](https://github.com/uber/cadence-java-samples#register-the-domain) work well on Mac/Linux but may fail on Windows. To 
get it working, you'll need to set a USER environment variable.

```
set USER=myname
gradlew.bat -q execute -PmainClass=com.uber.cadence.samples.common.RegisterDomain
```

This will register a domain called **sample** on your local Cadence instance. All workflows and activities are run within a domain. This 
is also a good test to make sure the Cadence server and client are working properly.
