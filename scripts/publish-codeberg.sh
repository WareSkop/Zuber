#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="codeberg.org/waring/knowmesh:latest"

echo "=========================================================="
echo "🚀 Building Knowmesh Docker Image: ${IMAGE_NAME}"
echo "=========================================================="

# Ensure script is run from project root
cd "$(dirname "$0")/.."

# Build Docker Image
docker build -t "${IMAGE_NAME}" .

echo "=========================================================="
echo "📦 Pushing Docker Image to Codeberg Container Registry"
echo "=========================================================="
docker push "${IMAGE_NAME}"

echo "=========================================================="
echo "✅ Successfully published ${IMAGE_NAME}"
echo "=========================================================="
