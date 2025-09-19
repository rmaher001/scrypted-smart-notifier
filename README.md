# Scrypted Smart Notifier

Cross-camera person deduplication using ReID (Person Re-Identification) technology for Scrypted home automation.

## Overview

The Smart Notifier system eliminates duplicate notifications by tracking persons across multiple cameras within a 60-second window. Only sends notifications for new/unique persons detected.

## Architecture

### Two-Plugin System
1. **smart-notifier** (TypeScript) - Camera mixin listener
2. **reid-service** (Python) - ReID processing service

### Communication
- Interface: BufferConverter (`application/json` → `application/reid`)
- Method: TypeScript listener calls Python service via RPC
- Deployment: Both plugins run on same Scrypted server

## Current Status (2025-09-19)

✅ **WORKING** - Both plugins operational with ReID pipeline functional

- ✅ **smart-notifier**: Working - captures detections and calls ReID service
- ✅ **reid-service**: Working - ONNX model download and processing functional
- ✅ **Pipeline**: TypeScript → Python RPC communication verified
- ✅ **Model**: OSNet AIN ONNX (8.3MB) downloading on first use from GitHub releases
- ⚠️ **Startup**: Python service takes significant time to initialize (model download + dependencies)
- 🔧 **Dependencies**: All Python packages (numpy, onnxruntime, opencv, Pillow) installing correctly
- 📋 **Next**: Implement actual ReID embedding comparison logic

## Components

### Smart Notifier (TypeScript)
- Camera mixin that listens to ObjectDetector events
- Filters for person/face detections only
- Sends detection data to ReID service
- Processes ReID results for notification decisions

### ReID Service (Python)
- Uses OSNet AIN ONNX model for person re-identification
- Maintains temporal cache of person embeddings (60-second window)
- Performs cross-camera matching using cosine similarity
- Returns deduplication decisions (`isNew`, `personId`, `matchedCameras`)

## Installation

1. Install both plugins in Scrypted
2. Enable Smart Notifier mixin on cameras with object detection
3. Configure notification settings

**Note**: Currently blocked due to Python plugin stability issues.

## Technical Details

- **ReID Model**: OSNet AIN (512-dimensional embeddings)
- **Similarity Threshold**: 0.6 cosine similarity
- **Tracking Window**: 60 seconds
- **Cache Management**: LRU eviction with automatic cleanup

## Known Issues

- **Slow startup**: Python service takes significant time to initialize (first-time model download + dependency installation)
- **Server restart required**: After Python dependency changes, Scrypted server must be restarted
- **Model download delay**: 8.3MB ONNX model download on first use can take time depending on connection

## Debugging

Both plugins now include timing logs to help debug startup and performance issues:

**Smart Notifier logs:**
```
Smart Notifier: Calling ReID service for [CameraName] with N person(s)
Smart Notifier: ReID service response received in XXXms
```

**ReID Service logs:**
```
🚀 ReID service initializing...
⏱️  Model download took X.Xs
⏱️  ONNX session creation took X.Xs
✅ ReID service fully initialized in X.Xs - ready for processing!
```