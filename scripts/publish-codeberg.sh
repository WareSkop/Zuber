#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
IMAGE_BASE="codeberg.org/waring/knowmesh"
IMAGE_LATEST="${IMAGE_BASE}:latest"
IMAGE_VERSION="${IMAGE_BASE}:v${VERSION}"

echo "=========================================================="
echo "🚀 Building Knowmesh Docker Image: ${IMAGE_LATEST} & ${IMAGE_VERSION}"
echo "=========================================================="

docker build -t "${IMAGE_LATEST}" -t "${IMAGE_VERSION}" .

echo "=========================================================="
echo "📦 Pushing Docker Images to Codeberg Package Registry"
echo "=========================================================="
docker push "${IMAGE_LATEST}"
docker push "${IMAGE_VERSION}"

echo "=========================================================="
echo "✅ Successfully published package:"
echo "   - ${IMAGE_LATEST}"
echo "   - ${IMAGE_VERSION}"
echo "=========================================================="
