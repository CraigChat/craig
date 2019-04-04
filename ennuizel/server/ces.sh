#!/bin/sh
while true
do
    node ces.js
    sleep 10
done >> node-log.txt 2>&1
