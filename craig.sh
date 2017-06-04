#!/bin/sh
while true
do
    node craig.js
    sleep 10
done >> node-log.txt 2>&1
