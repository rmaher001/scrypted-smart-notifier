import scrypted_sdk
from scrypted_sdk import ScryptedDeviceBase, BufferConverter
import json
import os
import urllib.request

class ReIDService(ScryptedDeviceBase, BufferConverter):
    def __init__(self, nativeId=None):
        super().__init__(nativeId)
        print("ReIDService initialized - using BufferConverter interface", flush=True)
        # Set the converter properties for BufferConverter interface
        self.fromMimeType = "application/json"
        self.toMimeType = "application/reid"

        # Initialize ReID engine lazily
        self.reid_engine = None
        print("ReIDService constructor completed successfully", flush=True)

    def download_model(self):
        """Download ONNX model if not present"""
        model_path = os.path.join(os.path.dirname(__file__), 'osnet_ain_multisource.onnx')

        if not os.path.exists(model_path):
            print("ONNX model not found, downloading...", flush=True)
            # TODO: Replace with your GitHub URL
            model_url = "https://github.com/yourusername/repo/releases/download/v1.0/osnet_ain_multisource.onnx"

            try:
                print(f"Downloading from {model_url}...", flush=True)
                urllib.request.urlretrieve(model_url, model_path)
                print("✅ Model downloaded successfully", flush=True)
            except Exception as e:
                print(f"❌ Failed to download model: {e}", flush=True)
                return None

        return model_path

    async def convert(self, data, fromMimeType, toMimeType, options=None):
        """BufferConverter interface for ReID processing"""
        print(f"ReID convert called: from={fromMimeType}, to={toMimeType}", flush=True)

        # Lazy initialization of ReID engine
        if self.reid_engine is None:
            try:
                print("Testing basic imports...", flush=True)
                import numpy as np
                print(f"✅ numpy imported successfully: {np.__version__}", flush=True)

                import onnxruntime as ort
                print(f"✅ onnxruntime imported successfully: {ort.__version__}", flush=True)

                # For now, just mark dependencies as working
                # TODO: Add full ReID engine integration once dependencies confirmed
                self.reid_engine = "dependencies_working"
                print("✅ Dependencies verified, ReID ready for integration", flush=True)

            except ImportError as e:
                print(f"❌ Import error: {e}", flush=True)
                self.reid_engine = "dependencies_failed"
            except Exception as e:
                print(f"❌ Unexpected error: {e}", flush=True)
                self.reid_engine = "dependencies_failed"

        if fromMimeType == "application/json" and toMimeType == "application/reid":
            # Parse the JSON data
            detections_data = json.loads(data) if isinstance(data, str) else data

            # Log received data
            device_name = detections_data.get('deviceName', 'unknown')
            detection_count = detections_data.get('detectionCount', 0)
            has_persons = detections_data.get('hasPersons', False)
            timestamp = detections_data.get('timestamp')

            print(f"ReID: {device_name} - {detection_count} detections, hasPersons: {has_persons}", flush=True)

            # If no detections, return early
            if detection_count == 0:
                return json.dumps({
                    "processed": False,
                    "timestamp": timestamp,
                    "deviceName": device_name,
                    "message": "No detections to process",
                    "isNew": False,
                    "personId": None
                })

            # Process person detections
            person_detections = []
            if detections_data.get('detections'):
                for det in detections_data['detections']:
                    if det.get('className') in ['person', 'face']:
                        person_detections.append({
                            'className': det.get('className'),
                            'label': det.get('label'),
                            'score': det.get('score'),
                            'boundingBox': det.get('boundingBox'),
                            'id': det.get('id')
                        })
                        print(f"  - {det.get('className')}: {det.get('label') or 'unknown'} (score: {det.get('score', 0):.2f})", flush=True)

            # Basic processing (will add ReID logic once dependencies confirmed working)
            if self.reid_engine == "dependencies_working":
                status = "Dependencies OK, ready for ReID integration"
            else:
                status = "Dependencies failed, using fallback"

            result = {
                "processed": True,
                "timestamp": timestamp,
                "deviceName": device_name,
                "personCount": len(person_detections),
                "persons": person_detections,
                "isNew": True,  # Will be determined by actual ReID once integrated
                "personId": None,  # Will be assigned by actual ReID once integrated
                "message": f"{status}: {len(person_detections)} person detections"
            }

            return json.dumps(result)

        return data

def create_scrypted_plugin():
    return ReIDService()