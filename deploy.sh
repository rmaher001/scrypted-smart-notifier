#!/bin/bash

# Smart Notifier Plugin - Remote Debug Deployment Script
# Default server: 192.168.86.74

DEFAULT_IP="192.168.86.74"
SERVER_IP="${1:-$DEFAULT_IP}"

echo "🚀 Deploying Smart Notifier Plugin to Scrypted Server"
echo "Server: $SERVER_IP"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Run this script from the plugin directory."
    exit 1
fi

# Check if plugin name matches
if ! grep -q "@scrypted/smart-notifier" package.json; then
    echo "❌ Error: This doesn't appear to be the smart-notifier plugin directory."
    exit 1
fi

echo "📦 Building plugin..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Please fix compilation errors."
    exit 1
fi

echo "✅ Build successful!"
echo ""

echo "🔗 Deploying to remote server..."
npx scrypted-deploy-debug $SERVER_IP

if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 Deployment successful!"
    echo ""
    echo "📋 Next steps:"
    echo "1. Open Scrypted Management Console: http://$SERVER_IP:10443"
    echo "2. Go to Plugins → Smart Notifier"
    echo "3. Check logs for constructor and ReID service timing"
    echo ""
    echo "🔧 For VS Code debugging:"
    echo "1. Open this folder in VS Code"
    echo "2. Select 'Attach to Scrypted (No Deploy)' from the dropdown"
    echo "3. Press F5 or click the green play button"
    echo "4. Console logs will appear in Debug Console panel"
    echo ""
else
    echo "❌ Deployment failed. Check authentication with 'npx scrypted login'"
    echo "💡 Make sure you can access: http://$SERVER_IP:10443"
fi