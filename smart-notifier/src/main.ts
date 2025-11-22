import sdk, { MixinProvider, ScryptedDeviceBase, MixinDeviceBase, ScryptedDeviceType, ScryptedInterface, BufferConverter, ObjectDetector, ObjectDetectionTypes, Settings, Notifier, MediaObject, NotifierOptions } from '@scrypted/sdk';


const { systemManager } = sdk;

import jpeg from 'jpeg-js';

// Helper to format timestamps for logging
function timestamp(): string {
    return new Date().toISOString().replace('T', ' ').substring(0, 23);
}


// Local JPEG resize (nearest-neighbor) for full-frame downscale
// Ported from llm-notifier
function resizeJpegNearest(input: Buffer, targetWidth: number, quality = 60): Buffer {
    const { data: src, width: sw, height: sh } = jpeg.decode(input, { useTArray: true });
    if (!sw || !sh)
        return input;
    const dw = Math.min(targetWidth, sw);
    if (dw === sw)
        return input;
    const dh = Math.max(1, Math.round((sh * dw) / sw));
    const dst = Buffer.allocUnsafe(dw * dh * 4);
    for (let y = 0; y < dh; y++) {
        const sy = Math.floor((y * sh) / dh);
        for (let x = 0; x < dw; x++) {
            const sx = Math.floor((x * sw) / dw);
            const si = (sy * sw + sx) << 2;
            const di = (y * dw + x) << 2;
            dst[di] = src[si];
            dst[di + 1] = src[si + 1];
            dst[di + 2] = src[si + 2];
            dst[di + 3] = 255;
        }
    }
    const { data } = jpeg.encode({ data: dst, width: dw, height: dh }, quality);
    return Buffer.from(data);
}

class ListenerMixin extends MixinDeviceBase<ObjectDetector> implements ObjectDetector {
    listener: any;
    checkInterval: NodeJS.Timeout;
    cooldowns: Map<string, { timestamp: number, label: string | null }> = new Map();
    detectionLastProcessed: Map<string, number> = new Map();
    pendingNotifications: Map<string, { timer: NodeJS.Timeout, image: Buffer }> = new Map();
    processing: Set<string> = new Set();


    constructor(options: any) {
        super(options);

        // Set up listener for object detection events
        if (!this.listener) {
            // Clean up old detection timestamps and cooldowns every minute
            this.checkInterval = setInterval(() => {
                const now = Date.now();

                // Cleanup detection throttling (1 minute)
                for (const [id, time] of this.detectionLastProcessed) {
                    if (now - time > 60000) {
                        this.detectionLastProcessed.delete(id);
                    }
                }

                // Cleanup cooldowns (1 hour - plenty of time since cooldown is 5 mins)
                for (const [id, data] of this.cooldowns) {
                    if (now - data.timestamp > 3600000) {
                        this.cooldowns.delete(id);
                    }
                }

                // Safety cleanup for pending notifications
                for (const [id, data] of this.pendingNotifications) {
                    if (this.pendingNotifications.size > 100) {
                        console.warn('Smart Notifier: Pending notifications map too large, clearing.');
                        clearTimeout(data.timer);
                        this.pendingNotifications.delete(id);
                    }
                }
            }, 60000);

            this.listener = systemManager.listenDevice(this.id, ScryptedInterface.ObjectDetector, async (source: any, details: any, detected: any) => {
                // CRITICAL: Only process events with valid detection IDs (not motion-only events)
                if (!detected.detectionId) {
                    return;
                }

                // Throttle processing per detection ID (1 second)
                const lastProcessed = this.detectionLastProcessed.get(detected.detectionId);
                const now = Date.now();
                if (lastProcessed && (now - lastProcessed < 1000)) {
                    return;
                }
                this.detectionLastProcessed.set(detected.detectionId, now);

                // Filter for person/face detections only
                if (!detected.detections) {
                    return;
                }

                const personDetections = detected.detections.filter(d =>
                    d.className === 'person' || d.className === 'face'
                );

                if (personDetections.length > 0) {
                    console.log(`[${timestamp()}] Smart Notifier: Raw detections for ${this.name}:`,
                        personDetections.map(d => `${d.className} (${d.score.toFixed(2)}) [${d.boundingBox.map(n => Math.round(n)).join(',')}]`).join('; ')
                    );
                }

                // Skip if no person/face detections
                if (personDetections.length === 0) {
                    return;
                }



                // Call ReID service using BufferConverter interface
                try {
                    // Try to get the snapshot from the detection event first
                    let snapshot: any = null;
                    try {
                        if (typeof (source as any).getDetectionInput === 'function') {
                            snapshot = await (source as any).getDetectionInput(detected.detectionId, details.eventId);
                        }
                    } catch (e) {
                        console.log('Smart Notifier: getDetectionInput failed', e);
                    }

                    // Fallback to recording stream thumbnail
                    if (!snapshot) {
                        try {
                            if (typeof (source as any).getRecordingStreamThumbnail === 'function') {
                                snapshot = await (source as any).getRecordingStreamThumbnail(detected.timestamp);
                            }
                        } catch (e) {
                            console.log('Smart Notifier: getRecordingStreamThumbnail failed', e);
                        }
                    }

                    if (!snapshot) {
                        console.log('Smart Notifier: Could not retrieve snapshot for detection');
                        return;
                    }

                    // Propagate face labels to person detections
                    const faceDetections = detected.detections.filter(d => d.className === 'face' && d.label && d.label !== 'face');

                    if (faceDetections.length > 0 && personDetections.length > 0) {
                        for (const person of personDetections) {
                            if (!person.boundingBox) continue;

                            // Find best matching face
                            let bestFace: any = null;

                            for (const face of faceDetections) {
                                if (!face.boundingBox) continue;

                                // Check if face center is inside person box
                                const p = person.boundingBox;
                                const f = face.boundingBox;
                                const faceCenterX = f[0] + f[2] / 2;
                                const faceCenterY = f[1] + f[3] / 2;

                                if (faceCenterX >= p[0] && faceCenterX <= p[0] + p[2] &&
                                    faceCenterY >= p[1] && faceCenterY <= p[1] + p[3]) {
                                    bestFace = face;
                                    break;
                                }
                            }

                            if (bestFace) {
                                console.log(`[${timestamp()}] Smart Notifier: Propagating face label "${bestFace.label}" to person detection`);
                                person.label = bestFace.label;
                            }
                        }
                    }

                    // Convert snapshot to JPEG buffer
                    const jpegBuffer = await sdk.mediaManager.convertMediaObjectToBuffer(snapshot, 'image/jpeg');

                    // Convert to base64 for HTTP transmission
                    const imageBase64 = jpegBuffer.toString('base64');

                    // Extract relevant detection data  
                    const validDetections = personDetections.map(d => ({
                        className: d.className,
                        label: d.label,
                        score: d.score,
                        boundingBox: d.boundingBox,
                        id: d.id,
                        zones: d.zones
                    }));

                    const data = {
                        timestamp: detected.timestamp,
                        detectionId: detected.detectionId,
                        inputDimensions: detected.inputDimensions,
                        sourceId: detected.sourceId,
                        deviceId: this.id,
                        deviceName: this.name,
                        detections: validDetections,
                        image: imageBase64,
                        detectionCount: validDetections.length,
                        hasPersons: true
                    };

                    console.log(`[${timestamp()}] Smart Notifier: Calling ReID service for ${this.name} with ${validDetections.length} person(s)`);
                    const startTime = Date.now();

                    // Call standalone ReID HTTP service
                    const reidServiceUrl = process.env.REID_SERVICE_URL || 'http://192.168.86.84:8765/process';

                    const response = await fetch(reidServiceUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(data)
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    const parsed = await response.json();

                    const duration = Date.now() - startTime;
                    console.log(`[${timestamp()}] Smart Notifier: ReID service response received in ${duration}ms`);

                    // Process ReID results
                    if (parsed.detections) {
                        for (const det of parsed.detections) {
                            // Only notify for persons
                            if (det.className !== 'person') continue;

                            const personId = det.personId;
                            if (!personId) continue;

                            // GLOBAL LOCK: Check if we are already processing this person
                            if (this.processing.has(personId)) {
                                // console.log(`[${timestamp()}] Smart Notifier: Skipping ${personId} - already processing`);
                                continue;
                            }
                            this.processing.add(personId);

                            try {
                                // Determine name for current detection
                                const currentLabel = (det.label && det.label !== 'person' && det.label !== 'face') ? det.label : null;

                                // Check per-person cooldown
                                const now = Date.now();
                                const lastSeen = this.cooldowns.get(personId);
                                const PERSON_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

                                // If we have a lastSeen record, check if we should skip
                                if (lastSeen) {
                                    const timeDiff = now - lastSeen.timestamp;
                                    if (timeDiff < PERSON_COOLDOWN_MS) {
                                        // If we are already in cooldown, we only allow UPGRADES
                                        // An upgrade is when we go from NO label to A label
                                        const isUpgrade = currentLabel && !lastSeen.label;

                                        // If it's NOT an upgrade, we skip
                                        if (!isUpgrade) {
                                            console.log(`[${timestamp()}] Smart Notifier: Skipping notification for ${personId} (cooldown active). Last label: ${lastSeen.label}, Current: ${currentLabel}`);
                                            continue;
                                        }

                                        // If it IS an upgrade, we proceed
                                        console.log(`[${timestamp()}] Smart Notifier: Cooldown override: Upgrading notification for ${personId} from "${lastSeen.label || 'Person'}" to "${currentLabel}"`);
                                    }
                                }

                                // BUFFERING LOGIC
                                const pending = this.pendingNotifications.get(personId);

                                if (currentLabel) {
                                    // We have a specific name!
                                    if (pending) {
                                        console.log(`[${timestamp()}] Smart Notifier: Found name "${currentLabel}" for pending ${personId}. Sending immediately.`);
                                        clearTimeout(pending.timer);
                                        this.pendingNotifications.delete(personId);
                                    }

                                    // CRITICAL FIX: Check cooldown ONE MORE TIME to be safe against race conditions
                                    const freshLastSeen = this.cooldowns.get(personId);
                                    if (freshLastSeen && (Date.now() - freshLastSeen.timestamp < PERSON_COOLDOWN_MS)) {
                                        // If we already have a label, and it matches current, SKIP
                                        if (freshLastSeen.label === currentLabel) {
                                            console.log(`[${timestamp()}] Smart Notifier: Skipping duplicate notification for ${personId} (race condition caught). Label: ${currentLabel}`);
                                            continue;
                                        }
                                    }

                                    // CRITICAL FIX: Update cooldown SYNCHRONOUSLY *before* awaiting the send
                                    this.cooldowns.set(personId, { timestamp: Date.now(), label: currentLabel });

                                    // Send notification (async)
                                    await this.sendNotification(personId, currentLabel, jpegBuffer, true);
                                } else {
                                    // Generic "Person"
                                    if (this.pendingNotifications.has(personId)) {
                                        // Already buffering, ignore this frame
                                        continue;
                                    }

                                    // If we are already in cooldown (and this is generic), we definitely skip
                                    if (lastSeen && (now - lastSeen.timestamp < PERSON_COOLDOWN_MS)) {
                                        continue;
                                    }

                                    // Start buffer
                                    console.log(`[${timestamp()}] Smart Notifier: Buffering notification for ${personId} (waiting 3s for identification)...`);

                                    const timer = setTimeout(() => {
                                        // Check cooldown AGAIN before sending, in case an upgrade happened while waiting
                                        const freshLastSeen = this.cooldowns.get(personId);
                                        console.log(`[${timestamp()}] Smart Notifier: Buffer timer fired for ${personId}. FreshLastSeen: ${JSON.stringify(freshLastSeen)}`);

                                        if (freshLastSeen && (Date.now() - freshLastSeen.timestamp < PERSON_COOLDOWN_MS)) {
                                            console.log(`[${timestamp()}] Smart Notifier: Buffering finished, but person ${personId} was already notified/updated. Skipping generic notification.`);
                                            this.pendingNotifications.delete(personId);
                                            return;
                                        }

                                        // Update cooldown synchronously before sending
                                        this.cooldowns.set(personId, { timestamp: Date.now(), label: null });
                                        this.pendingNotifications.delete(personId);
                                        this.sendNotification(personId, 'Person', jpegBuffer, true);
                                    }, 3000);

                                    // Set entry immediately to block parallel requests
                                    this.pendingNotifications.set(personId, { timer, image: jpegBuffer });
                                }
                            } finally {
                                this.processing.delete(personId);
                            }
                        }
                    }
                } catch (e) {
                    console.error('Smart Notifier: Failed to call ReID service:', e);
                }
            });
        }
    }

    async sendNotification(personId: string, name: string, imageBuffer: Buffer, skipCooldownUpdate = false) {
        const title = name !== 'Person' ? `${name} Detected` : `New Person Detected`;
        const body = `${title} at ${this.name}`;

        console.log(`[${timestamp()}] Smart Notifier: Preparing notification for personId=${personId}. Name="${name}"`);
        console.log(`[${timestamp()}] Smart Notifier: Sending notification: ${body}`);

        // Update cooldown if not skipped (legacy support or direct calls)
        if (!skipCooldownUpdate) {
            this.cooldowns.set(personId, { timestamp: Date.now(), label: name === 'Person' ? null : name });
        }

        // Get Notifier device and send notification
        try {
            // Resize image first
            const resizedBuffer = resizeJpegNearest(imageBuffer, 640, 70);
            console.log(`[${timestamp()}] Smart Notifier: Resized notification image to 640px width (${Math.round(imageBuffer.length / 1024)}KB -> ${Math.round(resizedBuffer.length / 1024)}KB)`);
            const mediaObject = await sdk.mediaManager.createMediaObject(resizedBuffer, 'image/jpeg');

            // Get the Notifier device (ID 616)
            const notifier = systemManager.getDeviceById<Notifier>('616');
            if (notifier) {
                await notifier.sendNotification(title, { body }, mediaObject);
                console.log(`[${timestamp()}] Smart Notifier: Sent notification to ${notifier.name}`);
            } else {
                console.error('Smart Notifier: Notifier device 616 not found');
            }
        } catch (e) {
            console.error('Smart Notifier: Failed to send notification:', e);
        }
    }

    async getDetectionInput(detectionId?: string): Promise<any> {
        return this.mixinDevice.getDetectionInput(detectionId);
    }

    async getObjectTypes(): Promise<ObjectDetectionTypes> {
        return this.mixinDevice.getObjectTypes();
    }

    release() {
        this.listener?.removeListener();
        this.listener = null;
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        // Clear pending timers
        for (const [id, pending] of this.pendingNotifications) {
            clearTimeout(pending.timer);
        }
        this.pendingNotifications.clear();
    }
}

class SmartNotifierListener extends ScryptedDeviceBase implements MixinProvider {
    constructor(nativeId?: string) {
        super(nativeId);
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        // Only mixin on cameras with ObjectDetector
        if (type === ScryptedDeviceType.Camera && interfaces.includes(ScryptedInterface.ObjectDetector)) {
            return [ScryptedInterface.ObjectDetector];
        }
        return null;
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: any) {
        return new ListenerMixin({
            mixinDevice,
            mixinDeviceInterfaces,
            mixinDeviceState,
            mixinProviderNativeId: this.nativeId
        });
    }

    async releaseMixin(id: string, mixinDevice: any) {
        mixinDevice?.release();
    }
}

export default SmartNotifierListener;