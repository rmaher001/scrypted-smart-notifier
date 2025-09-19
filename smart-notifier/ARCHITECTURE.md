# Smart Notifier Architecture

## Current Status (2025-09-19)
**Status**: ⚠️ **BLOCKED** - Python plugin deployment issues
- ✅ Smart-notifier (TypeScript) working - successfully captures detections and calls ReID service
- ❌ ReID-service (Python) - **crashes Scrypted server when deployed**
- 🔧 Issue: Large ONNX model (8.3MB) in plugin bundle causes crashes, lightweight plugin still failing
- 📋 Next: Resolve Python plugin stability issues or consider alternative ReID implementation

## Overview
The Smart Notifier system provides **cross-camera person deduplication** using ReID (Person Re-Identification) technology. It tracks persons across multiple cameras within a 60-second window and only sends notifications for new/unique persons, eliminating duplicate notifications.

## System Architecture

### Two-Plugin Design
1. **@scrypted/smart-notifier** (TypeScript) - Camera mixin listener
2. **@scrypted/reid-service** (Python) - ReID processing service

### Communication Protocol
- **Interface**: BufferConverter (`application/json` → `application/reid`)
- **Method**: TypeScript listener calls Python service via RPC
- **Deployment**: Both plugins run in Docker containers on same Scrypted server

## Component Details

### 1. TypeScript Listener (@scrypted/smart-notifier)

**Purpose**: Stateless camera mixin that captures detection events and forwards them for ReID analysis

**Responsibilities**:
- Listen to ObjectDetector events from cameras
- Filter for person/face detections only (skip motion-only events)
- Retrieve detection snapshots via `getRecordingStreamThumbnail()`
- Crop person images using bounding box coordinates
- Send cropped images to ReID service
- Process ReID results and trigger notifications for new persons

**Key Implementation**:
```typescript
class ListenerMixin extends MixinDeviceBase<ObjectDetector> {
    // Event handler filters detections and calls ReID service
    listener = mixinDevice.listen(ScryptedInterface.ObjectDetector, async (source, details, detected) => {
        // 1. Filter for person/face detections with detectionId
        // 2. Get snapshot via getRecordingStreamThumbnail()
        // 3. Crop person images using boundingBox coordinates
        // 4. Send to ReID service via BufferConverter
        // 5. Process ReID result for notification decision
    });
}
```

### 2. Python ReID Service (@scrypted/reid-service)

**Purpose**: Stateful service that performs person re-identification and cross-camera tracking

**Responsibilities**:
- Extract 512-dimensional embeddings from person crops using OSNet AIN model
- Maintain temporal cache of recent person embeddings (60-second sliding window)
- Perform cross-camera matching using cosine similarity
- Track unique person IDs across cameras
- Return deduplication decisions (`isNew`, `personId`, `matchedCameras`)

**Key Implementation**:
```python
class ReIDService(ScryptedDeviceBase, BufferConverter):
    def __init__(self):
        self.reid_engine = ReIDEngine()  # OSNet AIN ONNX model
        self.person_cache = {}           # Temporal embedding cache
        self.similarity_threshold = 0.7  # Cosine similarity threshold

    async def convert(self, data, fromMimeType, toMimeType):
        # 1. Extract person crops from detection data
        # 2. Generate embeddings using ReID model
        # 3. Compare against recent embeddings from other cameras
        # 4. Return deduplication result
```

## Data Flow

### 1. Detection Event
```
Camera → ObjectDetector Event → ListenerMixin
```

### 2. Snapshot Retrieval
```
ListenerMixin → getRecordingStreamThumbnail(timestamp) → Full Detection Snapshot
```

### 3. Person Extraction
```
Full Snapshot + BoundingBoxes → Cropped Person Images
```

### 4. ReID Processing
```
Cropped Images → ReID Service → Feature Embeddings → Cross-Camera Matching
```

### 5. Notification Decision
```
ReID Result → ListenerMixin → Notification (if isNew=true) OR Suppress (if isNew=false)
```

## Data Structures

### Detection Data (TypeScript → Python)
```typescript
{
    timestamp: number,
    detectionId: string,
    deviceId: string,
    deviceName: string,
    detections: [{
        className: 'person' | 'face',
        label: string | null,
        score: number,
        boundingBox: [x, y, width, height],
        id: string  // tracking ID
    }],
    snapshot: MediaObject,  // Full detection image
    personCount: number
}
```

### ReID Result (Python → TypeScript)
```typescript
{
    processed: boolean,
    timestamp: number,
    deviceName: string,
    personCount: number,
    persons: [{
        personId: string,           // Unique cross-camera ID
        isNew: boolean,             // True if new person, false if seen recently
        confidence: number,         // Similarity confidence (0-1)
        matchedCameras: string[],   // Other cameras that saw this person
        embedding: number[]         // 512-dim feature vector (optional)
    }],
    message: string
}
```

## Temporal Tracking

### Person Cache Structure
```python
person_cache = {
    'person_uuid': {
        'embedding': np.array(512,),    # Feature vector
        'last_seen': timestamp,         # Most recent detection
        'cameras': ['cam1', 'cam2'],    # Cameras that detected this person
        'first_camera': 'cam1',         # Camera of first detection (for notification image)
        'created_at': timestamp         # Initial detection time
    }
}
```

### Cache Management
- **Expiry**: Remove persons not seen for >60 seconds
- **Cleanup**: Run periodic cleanup every 30 seconds
- **Memory**: LRU eviction if cache grows too large

## Notification Logic

### Smart Deduplication Rules
1. **New Person**: `isNew=true` → Send notification using first camera's snapshot
2. **Known Person**: `isNew=false` → Suppress notification (already notified)
3. **Cross-Camera**: Person detected on Camera A at T+0, then Camera B at T+30 → Only notify for Camera A
4. **Re-entry**: Person leaves area and returns after >60s → Treated as new detection

### Notification Content
```typescript
{
    title: "Person Detected",
    body: `New person detected on ${deviceName}`,
    image: firstCameraSnapshot,  // From the camera that first detected this person
    timestamp: firstDetectionTime
}
```

## Technical Considerations

### Performance
- **ONNX Runtime**: Hardware-accelerated inference on available devices
- **Image Processing**: Efficient cropping and resizing using Pillow
- **Caching**: In-memory embedding cache with LRU eviction
- **Batching**: Process multiple detections in single inference call

### Reliability
- **Snapshot API**: Use `getRecordingStreamThumbnail()` (always works) over `getDetectionInput()` (10s timeout)
- **Error Handling**: Graceful degradation when ReID service unavailable
- **Fallback**: Send notifications without deduplication if ReID fails

### Security
- **Isolation**: Each plugin runs in separate Docker container
- **Privacy**: Person embeddings are numerical vectors, not identifiable images
- **Retention**: Temporal cache automatically expires old data

## Deployment

### Build Process
1. **TypeScript**: `npm run build` → `npx scrypted-webpack` → `out/main.nodejs.js`
2. **Python**: Automatic packaging by Scrypted Python runtime

### Installation
1. Install `@scrypted/reid-service` plugin
2. Install `@scrypted/smart-notifier` plugin
3. Enable Smart Notifier mixin on cameras
4. Configure notification settings

### Configuration
- **Similarity Threshold**: Adjust person matching sensitivity (default: 0.7)
- **Time Window**: Cross-camera deduplication window (default: 60 seconds)
- **Notification Recipients**: Standard Scrypted notifier configuration