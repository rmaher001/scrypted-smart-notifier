#!/bin/bash
# Deploy plugins to test server
# Usage: ./deploy-to-test.sh <TEST_SERVER_IP>

set -e

TEST_IP="${1:-localhost:11443}"

echo "🚀 Deploying to test server: $TEST_IP"
echo ""

# Login first
echo "📝 Logging in to Scrypted..."
npx scrypted login "$TEST_IP"

echo ""
echo "📦 Deploying ReID Service (with resource limits)..."
cd /Users/richard/node/scrypted/plugins/reid-service
cp /Users/richard/node/scrypted-smart-notifier/reid-service/src/*.py src/
cp /Users/richard/node/scrypted-smart-notifier/reid-service/package.json .
cp /Users/richard/node/scrypted-smart-notifier/reid-service/requirements.txt .
npm run scrypted-deploy "$TEST_IP"

echo ""
echo "📦 Deploying Smart Notifier..."
cd /Users/richard/node/scrypted/plugins/smart-notifier
cp /Users/richard/node/scrypted-smart-notifier/smart-notifier/src/main.ts src/
cp /Users/richard/node/scrypted-smart-notifier/smart-notifier/package.json .
cp /Users/richard/node/scrypted-smart-notifier/smart-notifier/tsconfig.json .
npm install
npm run build
npm run scrypted-deploy-debug "$TEST_IP"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Open Scrypted UI at https://$TEST_IP"
echo "2. Check ReID Service console for: 'ReID engine initialized with OSNet ONNX model (Single Threaded)'"
echo "3. Monitor system resources (CPU/RAM)"
echo "4. Trigger a detection and watch for stability"
