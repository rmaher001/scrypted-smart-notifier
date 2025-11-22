#!/bin/bash
# Run ReID service standalone with resource limits

set -e

echo "🐳 Building ReID service Docker image..."
docker build -t reid-service:latest reid-service-standalone/

echo ""
echo "🚀 Starting ReID service with resource limits..."
docker run -d \
  --name reid-service \
  --cpus="1.0" \
  --memory="2g" \
  -p 8765:8765 \
  --restart unless-stopped \
  reid-service:latest

echo ""
echo "✅ ReID service started!"
echo ""
echo "Service URL: http://localhost:8765"
echo "Health check: curl http://localhost:8765/health"
echo "Logs: docker logs -f reid-service"
echo "Stop: docker stop reid-service && docker rm reid-service"
