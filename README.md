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

⚠️ **PROJECT BLOCKED** - Python plugin deployment issues

- ✅ **smart-notifier**: Working - captures detections and calls ReID service
- ❌ **reid-service**: **Crashes Scrypted server during deployment**
- 🔧 **Issue**: Plugin stability problems (both large 7.8MB and lightweight 27KB versions)
- 📋 **Next**: Resolve Python plugin deployment issues or consider alternative ReID implementation

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

- Python plugin causes Scrypted server crashes
- Large ONNX model (8.3MB) deployment problems
- Plugin loading failures with "Error: close"