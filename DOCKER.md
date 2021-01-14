# Run this in Docker

## Clone the repo
`git clone https://github.com/ericrigsb/bitl_craig.git`

`cd bitl_craig`

## Create a config.json
`cp config.json.example config.json`

Edit config.json as appropriate.

## Build Docker image

`docker build --no-cache -t bitl_craig .`

## Docker Compose

Edit docker-compose.yml as appropriate (i.e., restart always)

`docker-compose up`