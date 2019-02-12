---
title: "Cadence Java Samples on Windows"
date: 2019-02-12
tags: ["Cadence","Workflow"]
---

This post covers how to run the Cadence Java sample workflows on Windows. 

First, you'll need the JDK installed. If you're using Java 11, you
may run into [this issue](https://github.com/facebook/react-native/issues/22487), which prints *Could not determine java version from 
'11.0.1'* when you attempt to build the samples. The TLDR is that you should just downgrade to 
[Java 8](https://www.oracle.com/technetwork/java/javase/downloads/jdk8-downloads-2133151.html).

The [Cadence Java samples](https://github.com/uber/cadence-java-samples) use Gradle. The installation instructions for Gradle are 
[here](https://gradle.org/install/). I recommend the Chocolatey option as that's used in the instructions for running the Cadence 
server locally. You'll want to install Gradle before using IntelliJ so that Gradle is discoverable from the 
environment. Before building with Gradle on Windows, be sure to set your JAVA_HOME environment variable using 
[these instructions](https://javatutorial.net/set-java-home-windows-10).

For these samples, I used [IntelliJ](https://www.jetbrains.com/idea/) community edition.

Clone the Cadence Java samples repo with this command:

```
git clone https://github.com/uber/cadence-java-samples
```

Open IntelliJ and navigate to **File**->**New**->**Project from Existing Sources**. 
Select the *cadence-java-samples* directory. In the **Import Project page**, select **Import project from external model**,
choose **Gradle** and then click **Next**->**Finish**.

Next, launch a Cadence server on your local machine. You can use the instructions covered in my 
[earlier post](https://www.mode19.net/posts/cadenceonwin/).

Before running the samples, you need a sample domain. The Java samples' 
[instructions](https://github.com/uber/cadence-java-samples#register-the-domain) work well on Mac/Linux but may fail on Windows. To 
get it working, you'll need to set a USER environment variable.

```
set USER=myname
gradlew.bat -q execute -PmainClass=com.uber.cadence.samples.common.RegisterDomain
```

This will register a domain called **sample** on your local Cadence instance. All workflows and activities are run within a domain. This 
is also a good test to make sure the Cadence server and client are working properly. 

With the domain created, it's now possible to run the samples. There are instructions for running these from the command line 
included in the [sample repo's readme](https://github.com/uber/cadence-java-samples/blob/master/README.md#run-the-samples). 
You can also run the samples from IntelliJ directly. 

Before the samples will work in IntelliJ, the same USER environment variable will need to be set in your run/debug configuration. But 
the configurations need to be created first so you can modify them. The easiest way I found to do this is to attempt to run one 
of the samples. The configuration is created and you can then modify it by going to **Run**->**Edit Configurations** and adding the 
USER environment variable for that application. To run/debug a sample, find the sample classes under 
*src/main/java/com.uber.cadence.samples/hello*. Right click on one of the sample classes and choose **Run '-classname-.main()'** or
**Debug '-classname-.main()'**. The first time it's run, there will be a null pointer exception in the console. Add the environment 
variable, run again, and it should work.
