"""
Standalone ReID Service - HTTP API
Runs independently from Scrypted
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import base64
import uvicorn
from reid_engine import ReIDEngine
import asyncio
import os

app = FastAPI(title="ReID Service", version="0.2.0")

# Global engine instance
reid_engine: Optional[ReIDEngine] = None
model_downloaded = False

class Detection(BaseModel):
    className: str
    label: Optional[str] = None
    score: float
    boundingBox: List[float]  # [x, y, w, h]
    id: Optional[str] = None
    zones: Optional[List[str]] = None

class ProcessRequest(BaseModel):
    timestamp: int
    detectionId: str
    deviceId: str
    deviceName: str
    detections: List[Detection]
    image: str  # base64 encoded JPEG

class ProcessResponse(BaseModel):
    timestamp: int
    deviceId: str
    deviceName: str
    detections: List[dict]
    detectionCount: int
    hasPersons: bool

@app.on_event("startup")
async def startup_event():
    """Initialize ReID engine on startup"""
    global reid_engine
    print("🚀 Starting ReID Service...")
    reid_engine = ReIDEngine()
    reid_engine.set_debug_mode(True)
    print("✅ ReID Service ready (model will load on first request)")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "model_loaded": reid_engine.session is not None if reid_engine else False,
        "tracked_persons": len(reid_engine.tracked_persons) if reid_engine else 0
    }

@app.post("/process", response_model=ProcessResponse)
async def process_detections(request: ProcessRequest):
    """Process detections and perform ReID"""
    global reid_engine, model_downloaded
    
    if not reid_engine:
        raise HTTPException(status_code=500, detail="ReID engine not initialized")
    
    # Lazy load model on first request
    if not model_downloaded:
        print("📥 Downloading ONNX model...")
        model_path = await download_model()
        print(f"✅ Model downloaded: {model_path}")
        
        print("🔧 Initializing ReID engine...")
        await reid_engine.initialize(model_path)
        print("✅ ReID engine initialized")
        model_downloaded = True
    
    print(f"📸 Processing {len(request.detections)} detections from {request.deviceName}")
    
    # Decode full image
    from PIL import Image
    import io
    
    try:
        image_bytes = base64.b64decode(request.image)
        full_image = Image.open(io.BytesIO(image_bytes))
        full_image.load()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to decode image: {e}")
    
    width, height = full_image.size
    person_detections = []
    
    # Process each detection
    for det in request.detections:
        if det.className not in ['person', 'face']:
            continue
        
        try:
            # Get bounding box
            bbox = det.boundingBox
            x, y, w, h = bbox
            
            # Ensure within bounds
            x = max(0, min(x, width - 1))
            y = max(0, min(y, height - 1))
            w = max(1, min(w, width - x))
            h = max(1, min(h, height - y))
            
            # Crop
            crop = full_image.crop((int(x), int(y), int(x + w), int(y + h)))
            
            # Convert to bytes
            img_byte_arr = io.BytesIO()
            crop.save(img_byte_arr, format='JPEG')
            crop_bytes = img_byte_arr.getvalue()
            
            # Process with ReID engine
            reid_result = await reid_engine.process_detection(
                crop_bytes,
                request.deviceId,
                request.deviceName,
                det.className
            )
            
            person_detections.append({
                'className': det.className,
                'label': det.label,
                'score': det.score,
                'boundingBox': det.boundingBox,
                'id': det.id,
                'personId': reid_result.get('personId'),
                'isNew': reid_result.get('isNew'),
                # Remove snapshot to avoid binary serialization issues
                'firstDetection': {
                    'personId': reid_result.get('firstDetection', {}).get('personId'),
                    'firstSeen': reid_result.get('firstDetection', {}).get('firstSeen'),
                    'lastSeen': reid_result.get('firstDetection', {}).get('lastSeen'),
                    'cameraId': reid_result.get('firstDetection', {}).get('cameraId'),
                    'cameraName': reid_result.get('firstDetection', {}).get('cameraName'),
                } if reid_result.get('firstDetection') else None
            })
            
            print(f"  ✓ {det.className}: {reid_result.get('personId')} (New: {reid_result.get('isNew')})")
            
        except Exception as e:
            print(f"  ✗ Error processing detection: {e}")
            import traceback
            traceback.print_exc()
    
    return ProcessResponse(
        timestamp=request.timestamp,
        deviceId=request.deviceId,
        deviceName=request.deviceName,
        detections=person_detections,
        detectionCount=len(person_detections),
        hasPersons=len(person_detections) > 0
    )

async def download_model():
    """Download ONNX model"""
    import urllib.request
    
    model_dir = os.path.dirname(__file__)
    model_path = os.path.join(model_dir, 'osnet_ain_multisource.onnx')
    
    if os.path.exists(model_path):
        print(f"Model already exists: {model_path}")
        return model_path
    
    url = 'https://github.com/rmaher001/scrypted-smart-notifier/releases/download/v1.0/osnet_ain_multisource.onnx'
    print(f"Downloading from {url}...")
    
    urllib.request.urlretrieve(url, model_path)
    return model_path

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765)
