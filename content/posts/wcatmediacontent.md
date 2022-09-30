---
title: "Using WCAT to Simulate Watching Media Content"
date: 2014-11-20
tags: ["performance"]
---

[WCAT](http://www.iis.net/downloads/community/2007/05/wcat-63-%28x64%29) is a powerful, lightweight, 
and free tool for generating HTTP load. Here I will show you how to use it to simulate user traffic 
watching media content served by Azure Media Services.</p>

<!--more-->

Use Fiddler to examine the requests
===================================

First let's start with [Fiddler](http://www.telerik.com/fiddler). Open up Fiddler and navigate to 
http://smf.cloudapp.net/healthmonitor in your browser. This 
is an example Silverlight player provided by Azure Media Services. You can point it to a media asset that you 
have on your own website. Or you can use the example animation: Big Buck Bunny. For this article, I'll use the 
default example.

With Fiddler capturing traffic, start the presentation and let it go for about 30 seconds.

![Graph of 30 seconds of video](/img/WcatMediaContent_BBB.png "Graph of 30 seconds of video")

Let's look at the first few requests that Fiddler captured:

* clientaccesspolicy.xml
* ondemand/Big%20Buck%20Bunny%20Adaptive.ism/Manifest
* ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(300000)/Fragments(video=0)
* ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=0)
* ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=21362358)
* ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(300000)/Fragments(video=20000000)
* ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=41331519)
* ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(866000)/Fragments(video=40000000)
* ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=60371882)
* ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=80805442)
* ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(866000)/Fragments(video=60000000)

Since this is a Silverlight player, the first request is to the clientaccesspolicy.xml. This step isn't important to include in 
the WCAT script so feel free to delete it from Fiddler.

The manifest
============

The next request is to get the manifest. Fiddler should recognize this as an XML. IIS smooth streaming manifests are
in XML format. HLS, HDS, and DASH all use their own formats. They all have similar types of information. Let's look at
the contents of the manifest:

![Contents from smooth streaming manifest](/img/WcatMediaContent_SmoothManifest.png "Contents from smooth streaming manifest")

There are typically two stream indexes. One for video and one for audio. They will have QualityLevel nodes indicating
details about the varying bitrates. Here we can see that 2,436,000 is the top bit rate with 1280x720 resolution.

After the quality levels lie a ton of "c" nodes. The "c" stands for chunk. The StreamIndex node indicates there are 
299 video chunks. The chunk nodes indicate the order number "n" and the duration "d". 
The duration can vary chunk to chunk so the manifest lays them all out explicitly. There is an 
optional attribute to indicate how many times a particular duration is repeated, but that's not used here. The player
will use the offset and not the chunk number when requesting the fragment. Notice how in the list above the video
fragment requests are 20000000, 40000000, and 60000000.

The audio stream index has the same number of chunks but only one bitrate. The audio chunk sizes are inconsistent
compared to the video chunk sizes. The player is responsible for doing the math to determine the right fragment
request URL.

Request patterns
================

Simply viewing what requests were made leaves out an essential component of how a player works. Timing is also
key. If you watched Fiddler while the media was playing you would notice that there is a buffering phase where 
requests seem to be made quickly. Once the buffer is full, requests to get fragments happen on a regular cadence
every two seconds. The request for the audio and video fragment are made at the same time.

Different media formats will have different request behaviors. For instance, smooth streaming starts at a low bitrate
and depending on the response time will gradually increase the bitrate until reaching an optimal level. The optimal 
level can be less than the highest bitrate if the size of the window where the media is played is less than the resolution
of that bitrate. Other formats may stick with one bitrate or may try for the optimal bitrate first and adjust downward
if necessary.

Generate WCAT script with Fiddler
=================================

Trim your Fiddler capture to the sessions you want to keep. Go to the File menu and choose Export Sessions -> All Sessions.
Choose WCAT script as the output format. The script will look something like this:

```cs
scenario
{
  name    = "Fiddler-Generated WCAT Script";
  warmup      = 30;
  duration    = 120;
  cooldown    = 10;
  default
  {
    version = HTTP11;
  }
  transaction                        
  {                                  
    id = "FiddlerScenario";     
    weight = 1;
    request
    {
      id = "3";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/Manifest";
      addheader
      {
        name="Accept";
        value="*/*";
      }
      addheader
      {
        name="Accept-Language";
        value="en-US";
      }
      addheader
      {
        name="Referer";
        value="http://smf.cloudapp.net/ClientBin/HealthMonitor.xap";
      }
      addheader
      {
        name="Accept-Encoding";
        value="identity";
      }
      addheader
      {
        name="User-Agent";
        value="Mozilla/5.0 (Windows NT 6.3; WOW64; Trident/7.0; .NET4.0E; .NET4.0C; .NET CLR 3.5.30729; .NET CLR 2.0.50727; .NET CLR 3.0.30729; Tablet PC 2.0; InfoPath.3; rv:11.0) like Gecko";
      }
      addheader
      {
        name="Host";
        value="video3.smoothhd.com.edgesuite.net";
      }
      addheader
      {
        name="DNT";
        value="1";
      }
      addheader
      {
        name="Connection";
        value="Keep-Alive";
      }
    }
    request
    {
      id = "4";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(300000)/Fragments(video=0)";
      addheader
      {
        name="Accept";
        value="*/*";
      }
      addheader
      {
        name="Referer";
        value="http://smf.cloudapp.net/ClientBin/HealthMonitor.xap";
      }
      addheader
      {
        name="Accept-Language";
        value="en-US";
      }
      addheader
      {
        name="Accept-Encoding";
        value="gzip, deflate";
      }
      addheader
      {
        name="User-Agent";
        value="Mozilla/5.0 (Windows NT 6.3; WOW64; Trident/7.0; rv:11.0) like Gecko";
      }
      addheader
      {
        name="Host";
        value="video3.smoothhd.com.edgesuite.net";
      }
      addheader
      {
        name="DNT";
        value="1";
      }
      addheader
      {
        name="Connection";
        value="Keep-Alive";
      }
    }
```

This is only a piece of the script. Fiddler's generation of the script is brute-force so each request has all the headers listed individually 
instead of being shared across the transaction. Let's try and fix that by pushing most of those headers to the default section.

```cs
scenario
{
  name    = "WCAT Smooth Streaming Media";
  warmup      = 30;
  duration    = 120;
  cooldown    = 10;
  default
  {
    setheader
    {
      name="Accept-Language";
      value="en-US";
    }
    setheader
    {
      name="Referer";
      value="http://smf.cloudapp.net/ClientBin/HealthMonitor.xap";
    }
    setheader
    {
      name="Accept-Encoding";
      value="gzip, deflate";
    }
    setheader
    {
      name="User-Agent";
      value="Mozilla/5.0 (Windows NT 6.3; WOW64; Trident/7.0; .NET4.0E; .NET4.0C; .NET CLR 3.5.30729; .NET CLR 2.0.50727; .NET CLR 3.0.30729; Tablet PC 2.0; InfoPath.3; rv:11.0) like Gecko";
    }
    setheader
    {
      name="Host";
      value="video3.smoothhd.com.edgesuite.net";
    }
    setheader
    {
      name="DNT";
      value="1";
    }
    setheader
    {
      name="Connection";
      value="Keep-Alive";
    }
    version = HTTP11;
  }
  transaction                        
  {                                  
    id = "FiddlerScenario";     
    weight = 1;
    request
    {
      id = "3";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/Manifest";
    }
    request
    {
      id = "4";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(300000)/Fragments(video=0)";
    }
    request
    {
      id = "5";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=0)";
    }
    request
    {
      id = "6";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=21362358)";
    }
    request
    {
      id = "7";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(300000)/Fragments(video=20000000)";
    }
    request
    {
      id = "8";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=41331519)";
    }
    request
    {
      id = "9";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(866000)/Fragments(video=40000000)";
    }
    request
    {
      id = "10";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=60371882)";
    }
    request
    {
      id = "11";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=80805442)";
    }
    request
    {
      id = "12";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(866000)/Fragments(video=60000000)";
    }
    request
    {
      id = "13";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=101239002)";
    }
    request
    {
      id = "14";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(2436000)/Fragments(video=80000000)";
    }
    request
    {
      id = "15";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=121208163)";
    }
    request
    {
      id = "16";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(2436000)/Fragments(video=100000000)";
    }
    request
    {
      id = "17";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=140248526)";
    }
    request
    {
      id = "18";
      url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(2436000)/Fragments(video=120000000)";
    }
  }
}
```

This is definitely much cleaner but there is a problem. The way a transaction works in WCAT is that each request is 
performed serially waiting for the response each time. So we couldn't do something like request video and audio
at the same time. To achieve that, let's split the requests into two equally-weighted transactions. Also, the requests 
don't need ids so let's remove that as well.

```cs
transaction                        
{                                  
  id = "Video and manifest";     
  weight = 1;
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/Manifest";
  }
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(300000)/Fragments(video=0)";
  }
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(300000)/Fragments(video=20000000)";
  }
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(866000)/Fragments(video=40000000)";
  }
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(866000)/Fragments(video=60000000)";
  }
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(2436000)/Fragments(video=80000000)";
  }
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(2436000)/Fragments(video=100000000)";
  }
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(2436000)/Fragments(video=120000000)";
  }
}
transaction                        
{                                  
  id = "Audio";     
  weight = 1;
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=0)";
  }
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=21362358)";
  }
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=41331519)";
  }
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=60371882)";
  }
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=80805442)";
  }
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=101239002)";
  }
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=121208163)";
  }
  request
  {
    url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=140248526)";
  }
}
```

This will work decently well but there is no way to synchronize transactions in WCAT. Another problem is that while 
the above may work for simulating the buffering a media player will do, it doesn't simulate what happens after the 
buffer is full and the user is watching the content. If your media content is relatively short then this isn't much of an 
issue. However, if you're trying to simulate streaming a movie or television show, the majority of users are requesting 
fragments on a cadence of two requests every two seconds (or whatever the fragment duration is).

You could try to handle this with a sleep:

```cs
request
{
  url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=80805442)";
}
sleep
{
  delay = 2000;
}
request
{
  url     = "/ondemand/Big%20Buck%20Bunny%20Adaptive.ism/QualityLevels(64000)/Fragments(audio=101239002)";
}
```

The problem here is that the sleep is not executed until the prior request receives a response. So if the prior 
request gets a response in 150ms, the next request is 150ms later than it would be with a real player. Unfortunately
there is no way for WCAT to sleep a dynamic period of time.

Throttling
==========

One way to get around the lack of dynamic sleep periods is to calculate the total traffic generated by your target number of users. Then do some 
tests to figure out what your throughput is like with a single WCAT virtual client. Then do the math to figure out how
many virtual clients will be needed to simulate the target user load. Or just use as many virtual clients as you can and
see what your server can handle.

In either approach, the load generated will be inconsistent from run to run. It would be much better if the load
could be throttled somehow. Luckily there is an undocumented feature of WCAT that allows you to throttle the 
requests per second. WCAT will automatically sleep between requests to keep the rps from going too high.

```cs
scenario
{
  name        = "WCAT Smooth Streaming Media";
  warmup      = 30;
  duration    = 120;
  cooldown    = 10;
  throttlerps = 100;
```

If you are targeting a specific network bandwidth like 200 Mbps you might be tempted to try using "throttlebps" 
since the WCAT documentation has a throttle and minbps attribute on the scenario element. However, "throttle" is
invalid and "throttlebps", while a valid attribute, doesn't work. In my testing "throttlerps" works pretty well. 
Unfortunately throttlerps applies to the whole scenario and not to a particular transaction. So if you want to keep
audio and video requests to a particular rate you could either figure out a workable average or have separate 
WCAT client machines for each track. Then you would also need to coordinate the machines since the scenario 
file is pushed by the WCAT controller and to run separate scenario files you'd have to use separate controllers.
