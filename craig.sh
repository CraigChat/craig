#!/bin/sh
while true
do
    node craig-runner.js
    sleep 10
done >> node-log.txt 2>&1
