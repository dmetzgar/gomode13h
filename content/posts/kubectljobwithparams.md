---
title: "Start Kubernetes job from command line with parameters"
date: 2021-10-18
tags: ["Kubernetes"]
---

Create a job in Kubernetes via shell script and pass in parameters from the
command line.

<!--more-->

Let's say you have an executable application in a container. The application
takes some parameters via the command line and writes some output to the
console. And now you want to execute this application on your Kubernetes
cluster.

First, let's clear up the Kubernetes terminology. A job in Kubernetes can
start multiple pods. It is expected to execute and finish. Don't think of the
job as a class, where instances of the job are like objects of that class. A
job in Kubernetes is not meant to be executed again or used as a template for
other jobs. 

Unfortunately, this is the closest construct to executing an application
on-demand in Kubernetes. If this application needs to be run often, consider
exposing it as a service or as a queue consumer instead. If it needs to run on
a regular basis, use a cronjob instead.

But let's say you have a similar situation to mine where you have an
application that needs to run on rare occasion and within the Kubernetes
cluster (perhaps to get access to secrets). First, build the job definition.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: run-console-app
spec:
  template:
    spec:
      containers:
        - name: console-app-container
          image: "myregistry.azurecr.io/my-console-app:1.0.0"
          imagePullPolicy: IfNotPresent
          env:
          - name: ARG1
            valueFrom:
              secretKeyRef:
                name: passed-in-args
                key: arg1
          - name: ARG2
            valueFrom:
              secretKeyRef:
                name: passed-in-args
                key: arg2
          - name: CONN_STRING
            valueFrom:
              secretKeyRef:
                name: my-db-conn-strings
                key: SqlConnectionString
          command: ["/app/my-console-app-exe"]
          args:
            - -c 
            - "$(CONN_STRING)"
            - --arg1 
            - "$(ARG1)"
            - --arg2 
            - "$(ARG2)"
```

Now you can execute this job with a few kubectl commands. If you know the
arguments you want to pass, you don't need a script. First, start by creating
a secret to hold the arguments you'll be passing in from your terminal
(arg1 and arg2) from above.

```bash
kubectl create secret generic passed-in-args \
  --from-literal=arg1="abc" \
  --from-literal=arg2="123"
```

Then create the job.

```bash
kubectl create -f myjobtemplate.yaml
```

This will start the job. Before you can get logs for it, you need to wait for
it to start. This waits for the Ready condition or 10 seconds, whichever comes
first.

``bash
kubectl wait --for=condition=Ready job/run-console-app --timeout=10s
```

Once the pods are started for the job, you can follow the console output logs
until the pods complete.

```bash
kubectl logs job/run-console-app --follow --pod-running-timeout=20s
```

When the pods are complete, you may want to delete the job and secrets.

```bash
kubectl delete -f myjobtemplate.yaml
kubectl delete secret passed-in-args
```

## Executing the job with a bash script

Here is a bash script that takes the arguments passed to it and executes the
commands above.

```bash
#!/bin/bash
set -e

#GLOBALS
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [[ -z "${SCRIPT_DIR}" ]]; then
  error "Could not determine script path"
fi

readonly SCRIPT_DIR

function display_usage() {
  echo
  echo "********************************************************************************"
  echo
  echo "Execute console app in Kubernetes cluster"
  echo 
  echo "Usage:"
  echo "  exec-console-app [flags]"
  echo 
  echo "Flags:"
  echo "  -a|--arg1                       Argument 1"
  echo "  -b|--arg2                       Argument 2"
  echo "  -h|--help                       Display help"
  echo 
  echo "********************************************************************************"
  echo
}

function parse_args() {
  while (("$#")); do
    case "$1" in
    -h | --help)
      display_usage
      shift
      exit 0
      ;;
    
    -a | --arg1)
      if [ -n "$2" ]; then
        ARG1="$2"
        shift 2
      else
        display_usage
        error "Argument for $1 is missing"
        shift 2
      fi
      ;;
    
    -b | --arg2)
      if [ -n "$2" ]; then
        ARG2="$2"
        shift 2
      else
        display_usage
        error "Argument for $1 is missing"
        shift 2
      fi
      ;;

    -*|*) # unsupported flags
      display_usage
      error "Error: Unsupported flag $1"
      exit 1
      ;;
    esac
  done
}

function call_console_app() {
  kubectl create secret generic passed-in-args \
    --from-literal=arg1="${ARG1}" \
    --from-literal=arg2="${ARG2}" >/dev/null
  kubectl create -f "${SCRIPT_DIR}/myjobtemplate.yaml" >/dev/null

  # Ignore exit codes for the wait command
  set +e
  kubectl wait --for=condition=Ready job/run-console-app --timeout=10s 2>/dev/null
  set -e

  kubectl logs job/run-console-app --follow --pod-running-timeout=20s --ignore-errors=true
  kubectl delete -f "${SCRIPT_DIR}/myjobtemplate.yaml" >/dev/null
  kubectl delete secret passed-in-args >/dev/null
}

function main() {
  parse_args "$@"
  
  call_console_app
}

main "$@"
```

### Understanding the script

Let's break down this script a bit. First, is the way the script directory is
determined:

```bash
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [[ -z "${SCRIPT_DIR}" ]]; then
  error "Could not determine script path"
fi
```

To understand this, take a look at
https://www.ostricher.com/2014/10/the-right-way-to-get-the-directory-of-a-bash-script/

At the bottom of the script is the main method to call the functions.

```bash
function main() {
  parse_args "$@"
  
  call_console_app
}

main "$@"
```

The `parse_args` method reads the command line parameters and puts their values
into variables. The `call_console_app` method makes all the calls to `kubectl`
that we looked at before. Some differences here is that a lot of the command
output is ignored, especially errors and invalid exit codes. This reduces the
output of the script to just the output of the console application (if
successful).

It is possible that the script errors in the middle and leaves the job and/or
secrets defined. This prevents the script from being run again because a new
job or secret cannot be created with the same name as an existing one.
