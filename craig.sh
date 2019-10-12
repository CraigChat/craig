#!/bin/sh
while true
do
    taskset -c 8-31 node craig-runner.js
    sleep 10
done >> node-log.txt 2>&1
