# CLAUDE.md

This file provides guidance when working with code in this repository.

## Project Overview

Smart Notifier plugin for Scrypted - TypeScript camera mixin providing cross-camera person deduplication via ReID technology. Part of two-plugin system that eliminates duplicate notifications across cameras.

## Development Commands

```bash
npm run build                # Build using scrypted-webpack
./deploy.sh                  # Remote debug deployment to Scrypted server (192.168.86.74)
./deploy.sh <IP>            # Deploy to specific server IP
npm run scrypted-vscode-launch  # VS Code debug integration
```

## Architecture

### Two-Plugin System
- **@scrypted/smart-notifier** (this repo) - Camera mixin listener
- **@scrypted/reid-service** - Python ReID processing service

### Communication
- Uses BufferConverter interface (`application/json` → `application/reid`)
- Service discovery: `systemManager.getDeviceByName<BufferConverter>('ReID Service')`
- Periodic retry on service unavailability (5s intervals)

## Key Implementation

### ListenerMixin (`src/main.ts:5`)
- Processes ObjectDetector events from cameras
- Filters for person/face detections with valid `detectionId`
- Retrieves snapshots via `getRecordingStreamThumbnail()`
- Converts images to base64 for ReID service
- Implements proper `release()` cleanup

### SmartNotifierListener (`src/main.ts:161`)
- MixinProvider for Camera devices with ObjectDetector interface
- Creates ListenerMixin instances per camera

## Critical Details

### Event Filtering
Only processes events with `detected.detectionId` (skips motion-only).
Filters for `className === 'person'` detections.
Attaches face labels when available.

### Service Integration
- Name-based service lookup with retry logic
- Graceful degradation when ReID service unavailable
- JSON data format with base64-encoded images

## Current Status

✅ Working: Event filtering, snapshot retrieval, service communication
🔧 Pending: ReID result processing (TODO at `src/main.ts:122`)
⚠️ Blocked: Python ReID service deployment issues

## Files

- `src/main.ts` - Main implementation
- `deploy.sh` - Remote deployment script
- `ARCHITECTURE.md` - Detailed documentation