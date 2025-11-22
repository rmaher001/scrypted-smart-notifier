# Testing Instructions for ReID Service

## Current Status
⚠️ **BLOCKED**: The ReID service causes resource exhaustion on production Proxmox server, bringing down the entire host.

## Root Cause
The ONNX Runtime (AI model) attempts to use all available CPU cores and memory, causing a segfault and system crash.

## Fix Applied (Not Yet Tested)
Modified `reid-service/src/reid_engine.py` to limit ONNX Runtime to single-threaded execution:
```python
sess_options = ort.SessionOptions()
sess_options.intra_op_num_threads = 1
sess_options.inter_op_num_threads = 1
sess_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
```

## Testing Requirements
**DO NOT test on production Proxmox server** - it will crash the host.

### Option 1: Dedicated Test Machine
1. Set up Scrypted on a disposable VM/machine
2. Deploy both plugins:
   ```bash
   # ReID Service
   cd /Users/richard/node/scrypted/plugins/reid-service
   npm run scrypted-deploy <TEST_IP>
   
   # Smart Notifier
   cd /Users/richard/node/scrypted/plugins/smart-notifier
   npm run build && npm run deploy  # Update package.json with TEST_IP first
   ```
3. Monitor resources: `top` or `htop`
4. Trigger detection and watch for crashes

### Option 2: Local Docker (Mac)
```bash
# Start container
docker run -d --name scrypted-test \
  -p 11443:10443 \
  -v ~/.scrypted-test:/server/volume \
  koush/scrypted:latest

# Monitor resources
docker stats scrypted-test

# Deploy plugins (update IPs to localhost:11443)
# ... same as above ...

# Clean up when done
docker rm -f scrypted-test
```

## What to Watch For
- CPU usage should stay reasonable (not spike to 100% across all cores)
- Memory usage should be stable
- No segfaults in logs
- ReID service should initialize with message: "ReID engine initialized with OSNet ONNX model (Single Threaded)"

## Next Steps
Once test environment is ready, deploy the resource-limited version and verify stability before considering production deployment.
