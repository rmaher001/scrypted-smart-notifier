# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Scrypted Smart Notifier is a cross-camera person deduplication system using ReID (Person Re-Identification) technology. It eliminates duplicate notifications by tracking persons across multiple cameras within a 60-second window.

## Architecture

### Two-Component System

1. **smart-notifier** (TypeScript Scrypted plugin)
   - Camera mixin that listens to ObjectDetector events
   - Filters for person/face detections
   - Sends detection data to ReID service via HTTP
   - Manages notification logic with cooldowns and buffering

2. **reid-service-standalone** (Python FastAPI service)
   - Standalone HTTP service (runs independently from Scrypted)
   - Uses OSNet AIN ONNX model for person re-identification
   - Generates 512-dimensional embeddings for person matching
   - Maintains 60-second temporal cache of tracked persons
   - Endpoint: `http://192.168.86.84:8765/process`

### Communication Flow

```
Camera Detection → Smart Notifier (TypeScript) → HTTP POST → ReID Service (Python FastAPI)
                                                ← JSON Response ←
```

The TypeScript plugin sends base64-encoded images with detection metadata to the standalone Python service via HTTP POST to `/process`.

## Project Structure

```
scrypted-smart-notifier/
├── smart-notifier/           # TypeScript Scrypted plugin
│   ├── src/main.ts          # Main plugin implementation
│   ├── package.json         # NPM package with build/deploy scripts
│   └── tsconfig.json        # TypeScript configuration
├── reid-service/            # Python Scrypted plugin (DEPRECATED - not used)
├── reid-service-standalone/ # Standalone Python HTTP service (ACTIVE)
│   ├── app.py              # FastAPI HTTP server
│   ├── reid_engine.py      # ReID processing engine
│   └── requirements.txt    # Python dependencies
└── deploy-to-test.sh       # Deployment script for test server
```

## Development Commands

### Smart Notifier (TypeScript)

Build the plugin:
```bash
cd smart-notifier
npm run build
```

Deploy to Scrypted server:
```bash
cd smart-notifier
npm run deploy  # Deploys to 192.168.86.74 (hardcoded in package.json)
```

### ReID Service (Standalone Python)

The standalone service must be started manually on a server with Python:

```bash
cd reid-service-standalone
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py  # Starts FastAPI server on port 8765
```

Or use the convenience script:
```bash
./run-reid-standalone.sh
```

## Key Implementation Details

### Smart Notifier (smart-notifier/src/main.ts)

**Person Detection Processing**:
- Listens to `ObjectDetector` events via Scrypted mixin pattern
- Filters for `detectionId` presence (skips motion-only events)
- Throttles processing per detection ID (1-second debounce)
- Only processes `person` or `face` detections

**Face Label Propagation**:
- When face recognition provides a name, it propagates to parent person detection
- Checks if face center is within person bounding box
- Uses spatial matching to link faces to persons

**Notification Buffering**:
- 3-second buffer for unnamed persons to allow face recognition
- Immediate notification for identified persons (named)
- Prevents duplicate notifications with 5-minute cooldown per personId
- Allows "upgrades" from generic "Person" to identified name

**Cooldown Management**:
- Global per-person cooldown: 5 minutes
- Stores both timestamp and label (name)
- Upgrade detection: allows notification override when generic "Person" becomes identified

**ReID Service Integration**:
- Calls `process.env.REID_SERVICE_URL` or defaults to `http://192.168.86.84:8765/process`
- Sends POST with JSON containing:
  - Base64-encoded snapshot image
  - Detection metadata (boxes, scores, labels)
  - Camera/device info
- Receives `personId` and `isNew` flags

### ReID Engine (reid-service-standalone/reid_engine.py)

**ONNX Model**:
- Model: OSNet AIN (512-dimensional embeddings)
- Input: 128x256 RGB images
- Normalization: ImageNet mean/std
- Download: Auto-downloads from GitHub releases on first run

**Person Matching**:
- Cosine similarity threshold: 0.4 (lower = more sensitive)
- Uses L2-normalized embeddings (cosine = dot product)
- Tracks persons in OrderedDict with LRU-like behavior
- 60-second tracking window (configurable)

**Cache Management**:
- Automatic cleanup of entries older than tracking window
- Each tracked person stores: embedding, camera info, timestamps, snapshot
- Person ID format: `person_{timestamp_ms}_{random_9chars}`

## Scrypted Plugin Development

### TypeScript Plugin Pattern

The smart-notifier uses the Scrypted **MixinProvider** pattern:
- `SmartNotifierListener` implements `MixinProvider`
- `ListenerMixin` extends `MixinDeviceBase<ObjectDetector>`
- Applied to cameras that have `ObjectDetector` interface
- Each camera gets its own mixin instance with independent state

### Proper TypeScript Usage

**CRITICAL**: Always use proper Scrypted SDK imports:
```typescript
import sdk, { ScryptedInterface, ... } from '@scrypted/sdk';
const { systemManager } = sdk;
```

Never use `declare const sdk: any` or `any` types - always use proper typing from `@scrypted/sdk`.

### State Management in Mixins

Each mixin instance maintains its own state:
- `cooldowns`: Per-person notification timestamps
- `detectionLastProcessed`: Throttling map
- `pendingNotifications`: 3-second buffers for unnamed persons
- `processing`: Global lock to prevent race conditions

Cleanup is critical - implement `release()` to clear timers and listeners.

## Deployment Process

### Current Setup

The system uses a **standalone ReID service** instead of the Scrypted Python plugin due to stability issues.

**Deployment locations**:
- Smart Notifier plugin: Deployed to Scrypted server at `192.168.86.74`
- ReID service: Runs on `192.168.86.84:8765` (same machine as this repo)

### Smart Notifier (TypeScript Plugin)

```bash
cd /Users/richard/node/scrypted-smart-notifier/smart-notifier
npm run build && npm run deploy
```

### ReID Service (Python FastAPI)

**Location**: `/Users/richard/node/scrypted-smart-notifier/reid-service-standalone/`

**Check status**:
```bash
curl http://localhost:8765/health
ps aux | grep "python.*app.py" | grep -v grep
```

**Restart service**:
```bash
cd /Users/richard/node/scrypted-smart-notifier/reid-service-standalone

# Kill existing process
pkill -f "venv/bin/python.*app.py" || true

# Start new instance using venv
nohup ./venv/bin/python app.py > /tmp/reid-service.log 2>&1 &
```

**View logs**:
```bash
tail -f /tmp/reid-service.log
```

**Test deployment script** (`deploy-to-test.sh`):
- Syncs files from this repo to `/Users/richard/node/scrypted/plugins/`
- Deploys TypeScript plugin to test server
- Hardcoded test IP can be overridden: `./deploy-to-test.sh 192.168.86.75:11443`

## Known Issues & Important Notes

### Startup Performance
- Python service takes significant time to initialize on first run
- 8.3MB ONNX model downloads from GitHub releases
- Python dependencies (numpy, onnxruntime, opencv, Pillow) install automatically
- Logs include timing information to debug slow startup

### ReID Accuracy
- Similarity threshold is configurable (default 0.4 in standalone service)
- Lower threshold = more likely to match (fewer duplicates, more false positives)
- Higher threshold = stricter matching (more duplicates, fewer false positives)

### Race Conditions
- Notification logic uses synchronous cooldown updates before async sends
- Global `processing` lock prevents duplicate notifications for same personId
- Double-check cooldown after buffering timeout to catch upgrades

### Hardcoded Values
- Notifier device ID: `616` (hardcoded in `sendNotification()`)
- ReID service URL: `process.env.REID_SERVICE_URL` or `http://192.168.86.84:8765/process`
- Image resize: 640px width at 70% quality for notifications
- Similarity threshold: 0.4 (in ReID engine)
- Tracking window: 60 seconds
- Person cooldown: 5 minutes
- Buffer timeout: 3 seconds

## Testing

Test script for standalone service:
```bash
node test-reid-standalone.js
```

This sends a test detection to the HTTP service and validates the response.
