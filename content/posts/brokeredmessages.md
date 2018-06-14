---
title: "Checking contents of ServiceBus brokered messages"
date: 2016-09-28
tags: ["Debug"]
---

This post is for those using ServiceBus who would like to see the contents 
of a BrokeredMessage from a live debug session or dump file. 

<!--more-->

Open the dump file in windbg and load SOS. Then execute the following command:

```
!dumpheap -type BrokeredMessage -stat
```

What you're looking for is this:

```
              MT    Count    TotalSize Class Name
000007fe98f5c6a0      150        45600 Microsoft.ServiceBus.Messaging.BrokeredMessage
```

That gives you the MT for BrokeredMessage. If you've enabled `.prefer_dml 1` then you can
click on the MT and get a list of all the objects in memory. If you're in CDB the command
is `!DumpHeap -mt 000007fe98f5c6a0`. If you're in WinDBG but don't have DML on, you
should turn it on. Your life will get much easier.

```
         Address               MT     Size
00000003807279f0 000007fe98f5c6a0      304     
0000000380730470 000007fe98f5c6a0      304     
0000000380738ef0 000007fe98f5c6a0      304     
0000000380741970 000007fe98f5c6a0      304     
```

Now click on one of the addresses or run `!do 0000000380741970` (or whatever equivalent address on your system):

```
    Name:        Microsoft.ServiceBus.Messaging.BrokeredMessage
MethodTable: 000007fe98f5c6a0
EEClass:     000007fe98f6d2f8
Size:        304(0x130) bytes
File:        C:\Program Files\Workflow Manager\1.0\Workflow\Artifacts\Microsoft.ServiceBus.dll
Fields:
            MT    Field   Offset                 Type VT     Attr            Value Name
000007fef745dea0  4001922       d8         System.Int32  1 instance              512 headerStreamInitialSize
000007fef745dea0  400192a       dc         System.Int32  1 instance                3 version
000007fef745f650  400192b        8     System.IO.Stream  0 instance 0000000380727818 bodyStream
000007fef745b0f0  400192c       10        System.String  0 instance 0000000000000000 correlationId
000007fef745b0f0  400192d       18        System.String  0 instance 000000038071f1b0 sessionId
```

What we're interested in is the bodyStream. Find a BrokeredMessage where the bodyStream
is not null and click on it's value:

```
    Name:        Microsoft.ServiceBus.Messaging.BufferedInputStream
MethodTable: 000007fe9907d010
EEClass:     000007fe9906ed00
Size:        64(0x40) bytes
File:        C:\Program Files\Workflow Manager\1.0\Workflow\Artifacts\Microsoft.ServiceBus.dll
Fields:
              MT    Field   Offset                 Type VT     Attr            Value Name
000007fef745b6d0  4000198        8        System.Object  0 instance 0000000000000000 __identity
000007fef74ad740  4001fec       10 ...eam+ReadWriteTask  0 instance 0000000000000000 _activeReadWriteTask
000007fef7465fc0  4001fed       18 ...ing.SemaphoreSlim  0 instance 0000000000000000 _asyncActiveSemaphore
000007fe9907d2e0  4001794       20 ...rManagerByteArray  0 instance 0000000380727858 data
000007fef7458340  4001795       28 ...m.IO.MemoryStream  0 instance 0000000380727880 innerStream
000007fef745c9c8  4001796       30       System.Boolean  1 instance                0 disposed
```

Note that I remove the static fields since they're not useful for this post.

The field that I'm after is the innerStream. This field is the actual MemoryStream
that contains the message. This looks like:

```
    Name:        System.IO.MemoryStream
MethodTable: 000007fef7458340
EEClass:     000007fef6e70548
Size:        80(0x50) bytes
File:        C:\Windows\Microsoft.Net\assembly\GAC_64\mscorlib\v4.0_4.0.0.0__b77a5c561934e089\mscorlib.dll
Fields:
              MT    Field   Offset                 Type VT     Attr            Value Name
000007fef745b6d0  4000198        8        System.Object  0 instance 0000000000000000 __identity
000007fef74ad740  4001fec       10 ...eam+ReadWriteTask  0 instance 0000000000000000 _activeReadWriteTask
000007fef7465fc0  4001fed       18 ...ing.SemaphoreSlim  0 instance 0000000000000000 _asyncActiveSemaphore
000007fef745f268  40020dd       20        System.Byte[]  0 instance 0000000380723800 _buffer
000007fef745dea0  40020de       30         System.Int32  1 instance                0 _origin
000007fef745dea0  40020df       34         System.Int32  1 instance                0 _position
000007fef745dea0  40020e0       38         System.Int32  1 instance             9359 _length
000007fef745dea0  40020e1       3c         System.Int32  1 instance             9359 _capacity
000007fef745c9c8  40020e2       40       System.Boolean  1 instance                0 _expandable
000007fef745c9c8  40020e3       41       System.Boolean  1 instance                1 _writable
000007fef745c9c8  40020e4       42       System.Boolean  1 instance                0 _exposable
000007fef745c9c8  40020e5       43       System.Boolean  1 instance                1 _isOpen
000007fef74865e8  40020e6       28 ...Int32, mscorlib]]  0 instance 0000000000000000 _lastReadTask
```

We want two bits of data from the MemoryStream: buffer and length. The buffer has the
byte[] containing the message. The best way to see the data is to write it out to a file.
In order to do this use the following command:

```
.writemem memorystream.xml 0x0000000380723800+10 L?0n9359
```

Note that I add 16 bytes to get to the content of the byte[] (that's the +10). The
length is written in decimal in the output above so I use 0n to specify decimal.

The XML file will have the contents of the BrokeredMessage object.

I don't have a good way to dump all the BrokeredMessages. Instead what I did was get
the MT for MemoryStream and run the following commands:

```
.foreach (myobj {!dumpheap -mt 000007fef7458340 -short}) { .printf "%p\n", poi(${myobj}+20) }
.foreach (myobj {!dumpheap -mt 000007fef7458340 -short}) { .printf "%i\n", poi(${myobj}+38) }
```

Note that +20 is the offset for the buffer and +38 is the offset for the length.
These statements will dump out the memory addresses and lengths line by line. I then
take the two as input to a linq query that dumps out the .writemem commands and
paste that back into windbg. Once I figure out how to do a poi inside a poi, I can
come up with one command to dump all BrokeredMessage contents to files.
