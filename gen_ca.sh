#!/bin/sh

openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout selfsigned.key -out selfsigned.crt -subj '/CN=localhost /C=US'
mkdir certs/
