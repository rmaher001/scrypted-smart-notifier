# Deployment Guide for Scrypted Smart Notifier

## Current Status: Proof of Concept

The system is currently deployed using a **standalone ReID service** to prove that ReID can effectively reduce notifications without risking Proxmox server stability.

## Current Deployment Architecture

### 1. Smart Notifier (TypeScript Scrypted Plugin)
Deployed to Scrypted server at `192.168.86.74`

### 2. ReID Service (Standalone Python HTTP Service)
Runs independently at `192.168.86.84:8765`

## Deployment Instructions

### Smart Notifier (TypeScript Plugin)

**Production deployment:**
```bash
cd /Users/richard/node/scrypted/plugins/smart-notifier
npm run build
npm run deploy  # Deploys to 192.168.86.74 (hardcoded in package.json)
```

**From this repo:**
```bash
cd smart-notifier
npm run build
npm run deploy  # Deploys to 192.168.86.74
```

### ReID Service (Standalone Python)

The standalone service runs on a separate server (192.168.86.84):

```bash
# On the ReID server (192.168.86.84)
cd /path/to/reid-service-standalone
./run-reid-standalone.sh
```

**Or manually:**
```bash
cd reid-service-standalone
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn pydantic numpy onnxruntime Pillow
python app.py  # Starts on port 8765
```

**Service endpoint:** `http://192.168.86.84:8765/process`

**Health check:** `curl http://192.168.86.84:8765/health`

### Test Deployment Script

For deploying to test server:
```bash
./deploy-to-test.sh [TEST_SERVER_IP]
# Example: ./deploy-to-test.sh 192.168.86.75:11443
```

This script:
1. Copies files from this repo to `/Users/richard/node/scrypted/plugins/`
2. Builds the TypeScript plugin
3. Deploys to the test Scrypted server
4. Does NOT deploy the standalone ReID service (must be started separately)

## Configuration

### Smart Notifier Environment Variables

The TypeScript plugin looks for the ReID service URL:

```typescript
const reidServiceUrl = process.env.REID_SERVICE_URL || 'http://192.168.86.84:8765/process';
```

**To change the ReID service location:**
1. Set `REID_SERVICE_URL` environment variable in Scrypted
2. Or update the default URL in `smart-notifier/src/main.ts:218`

## File Sync Workflow

If editing in this GitHub repo:

```bash
# Sync smart-notifier to Scrypted plugins directory
cp /Users/richard/node/scrypted-smart-notifier/smart-notifier/src/main.ts \
   /Users/richard/node/scrypted/plugins/smart-notifier/src/main.ts

# Then deploy from plugins directory
cd /Users/richard/node/scrypted/plugins/smart-notifier
npm run build
npm run deploy
```

## Important Notes

### Smart Notifier (TypeScript)
- Uses `npx scrypted-deploy-debug` under the hood
- Default server: `192.168.86.74:10443`
- Requires build step before deployment
- Calls ReID service via HTTP POST

### ReID Service (Standalone Python)
- **Must be running** before Smart Notifier sends detections
- Auto-downloads ONNX model (8.3MB) on first run from GitHub releases
- Python dependencies: `fastapi`, `uvicorn`, `pydantic`, `numpy`, `onnxruntime`, `Pillow`
- Startup can take significant time on first run (model download + dependency install)
- Runs independently - isolated from Scrypted/Proxmox server
- No crash risk to production Scrypted server

### Server IP Addresses
- **Scrypted Server**: `192.168.86.74` (port 10443 for debug deployment)
- **ReID Service Server**: `192.168.86.84:8765`

## Troubleshooting

### ReID Service Not Responding
1. Check if service is running: `curl http://192.168.86.84:8765/health`
2. Check service logs on the ReID server
3. Verify firewall allows port 8765
4. Restart the service if needed

### Smart Notifier Not Processing Detections
1. Check ReID service URL is correct in logs
2. Verify cameras have ObjectDetector interface enabled
3. Check Smart Notifier mixin is enabled on cameras
4. Look for HTTP errors in Scrypted console logs

### Performance Issues
- ReID service processes detections synchronously
- High detection rate may cause backlog
- Consider reducing camera detection sensitivity
- Monitor ReID service CPU/RAM usage

## Future: Plugin Deployment

Once ReID proves reliable at reducing notifications, the Python service can be deployed as a Scrypted plugin:

```bash
# Future deployment method (not currently used)
cd /Users/richard/node/scrypted/plugins/reid-service
npm run scrypted-deploy 192.168.86.74
```

The `reid-service/` directory contains the Scrypted plugin version. This approach was causing Proxmox server crashes, which is why the standalone service is being used for proof of concept.
