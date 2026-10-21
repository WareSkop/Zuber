#!/usr/bin/env bash
set -e
echo "Building and pushing Docker image to GitHub Container Registry..."
docker build -t ghcr.io/wareskop/zuber:latest .
docker push ghcr.io/wareskop/zuber:latest
echo "Successfully published ghcr.io/wareskop/zuber:latest"
