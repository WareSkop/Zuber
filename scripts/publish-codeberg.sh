#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
IMAGE_BASE="codeberg.org/waring/knowmesh"
IMAGE_LATEST="${IMAGE_BASE}:latest"
IMAGE_VERSION="${IMAGE_BASE}:v${VERSION}"
IMAGE_V22="${IMAGE_BASE}:v2.2"

echo "=========================================================="
echo "🚀 Building Knowmesh Docker Image: ${IMAGE_LATEST}, ${IMAGE_VERSION} & ${IMAGE_V22}"
echo "=========================================================="

docker build -t "${IMAGE_LATEST}" -t "${IMAGE_VERSION}" -t "${IMAGE_V22}" .

echo "=========================================================="
echo "📦 Pushing Docker Images to Codeberg Package Registry"
echo "=========================================================="
docker push "${IMAGE_LATEST}"
docker push "${IMAGE_VERSION}"
docker push "${IMAGE_V22}"

echo "=========================================================="
echo "✅ Successfully published package:"
echo "   - ${IMAGE_LATEST}"
echo "   - ${IMAGE_VERSION}"
echo "   - ${IMAGE_V22}"
echo "=========================================================="
