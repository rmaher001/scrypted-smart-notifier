import sdk, { MixinProvider, ScryptedDeviceBase, MixinDeviceBase, ScryptedDeviceType, ScryptedInterface, BufferConverter, ObjectDetector, ObjectDetectionTypes, Settings, Notifier, MediaObject, NotifierOptions } from '@scrypted/sdk';


const { systemManager } = sdk;

import jpeg from 'jpeg-js';

// Helper to format timestamps for logging
function timestamp(): string {
    return new Date().toISOString().replace('T', ' ').substring(0, 23);
}


// Crop JPEG to bounding box (enlarged by percentage) and resize
function cropAndResizeJpeg(input: Buffer, boundingBox: number[], enlargePercent: number, targetWidth: number, quality = 70): Buffer {
    const { data: src, width: sw, height: sh } = jpeg.decode(input, { useTArray: true });
    if (!sw || !sh) return input;

    // boundingBox is [x, y, width, height] in pixels
    const [bx, by, bw, bh] = boundingBox;

    // Enlarge bounding box by percentage (e.g., 25% = 0.25)
    const enlargeX = bw * enlargePercent / 2;
    const enlargeY = bh * enlargePercent / 2;

    // Calculate enlarged crop region, clamped to image bounds
    const cropX = Math.max(0, Math.floor(bx - enlargeX));
    const cropY = Math.max(0, Math.floor(by - enlargeY));
    const cropX2 = Math.min(sw, Math.ceil(bx + bw + enlargeX));
    const cropY2 = Math.min(sh, Math.ceil(by + bh + enlargeY));
    const cropW = cropX2 - cropX;
    const cropH = cropY2 - cropY;

    if (cropW <= 0 || cropH <= 0) return input;

    // Calculate output dimensions maintaining aspect ratio
    const dw = Math.min(targetWidth, cropW);
    const dh = Math.max(1, Math.round((cropH * dw) / cropW));

    const dst = Buffer.allocUnsafe(dw * dh * 4);
    for (let y = 0; y < dh; y++) {
        // Map destination y to source y within crop region
        const sy = cropY + Math.floor((y * cropH) / dh);
        for (let x = 0; x < dw; x++) {
            // Map destination x to source x within crop region
            const sx = cropX + Math.floor((x * cropW) / dw);
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

// GLOBAL state shared across all camera instances
const globalCooldowns: Map<string, { timestamp: number, label: string | null }> = new Map();
const globalPendingNotifications: Map<string, { timer: NodeJS.Timeout, image: Buffer, boundingBox: number[] }> = new Map();
const globalProcessing: Set<string> = new Set();

// FACE-BASED cooldown (trumps personId) - keyed by face label (e.g., "Richard")
const globalFaceCooldowns: Map<string, number> = new Map();

// STATS tracking
interface Stats {
    // Detection counts
    personDetections: number;
    faceDetections: number;
    detectionsWithNames: number;

    // Notification counts
    genericNotificationsSent: number;
    namedNotificationsSent: number;
    upgradeNotificationsSent: number;

    // Suppression counts
    suppressedByPersonIdCooldown: number;
    suppressedByFaceCooldown: number;
    suppressedByPendingBuffer: number;
    suppressedByProcessingLock: number;

    // Cooldown miss tracking (notifications that slipped through)
    notificationsSentDespiteRecentPersonId: number;
    notificationsSentDespiteRecentFace: number;

    // ReID tracking
    uniquePersonIds: Set<string>;
    uniqueFaceLabels: Set<string>;
    genericPersonCount: number;
    reidServiceCalls: number;
    reidServiceTotalTime: number;
    reidServiceFailures: number;

    // Period tracking
    periodStart: number;
}

let globalStats: Stats = {
    personDetections: 0,
    faceDetections: 0,
    detectionsWithNames: 0,
    genericNotificationsSent: 0,
    namedNotificationsSent: 0,
    upgradeNotificationsSent: 0,
    suppressedByPersonIdCooldown: 0,
    suppressedByFaceCooldown: 0,
    suppressedByPendingBuffer: 0,
    suppressedByProcessingLock: 0,
    notificationsSentDespiteRecentPersonId: 0,
    notificationsSentDespiteRecentFace: 0,
    uniquePersonIds: new Set(),
    uniqueFaceLabels: new Set(),
    genericPersonCount: 0,
    reidServiceCalls: 0,
    reidServiceTotalTime: 0,
    reidServiceFailures: 0,
    periodStart: Date.now()
};

let statsInterval: NodeJS.Timeout | null = null;

function logStats() {
    const duration = (Date.now() - globalStats.periodStart) / 1000 / 60; // minutes
    const totalDetections = globalStats.personDetections;
    const totalNotifications = globalStats.genericNotificationsSent + globalStats.namedNotificationsSent + globalStats.upgradeNotificationsSent;
    const totalSuppressions = globalStats.suppressedByPersonIdCooldown + globalStats.suppressedByFaceCooldown +
                              globalStats.suppressedByPendingBuffer + globalStats.suppressedByProcessingLock;
    const suppressionRate = totalDetections > 0 ? ((totalSuppressions / totalDetections) * 100).toFixed(1) : '0.0';
    const faceRecognitionRate = totalDetections > 0 ? ((globalStats.detectionsWithNames / totalDetections) * 100).toFixed(1) : '0.0';
    const avgReidTime = globalStats.reidServiceCalls > 0 ? Math.round(globalStats.reidServiceTotalTime / globalStats.reidServiceCalls) : 0;

    const uniquePersonIdCount = globalStats.uniquePersonIds.size;
    const uniqueFaceLabelCount = globalStats.uniqueFaceLabels.size;
    const actualPeopleCount = uniqueFaceLabelCount + globalStats.genericPersonCount;
    const reidFragmentation = actualPeopleCount > 0 ? (uniquePersonIdCount / actualPeopleCount).toFixed(2) : '0.00';

    console.log(`\n\n${'#'.repeat(70)}`);
    console.log(`${'#'.repeat(70)}`);
    console.log(`###${' '.repeat(64)}###`);
    console.log(`###   SMART NOTIFIER STATS (${duration.toFixed(1)} min)${' '.repeat(Math.max(0, 39 - duration.toFixed(1).length))}###`);
    console.log(`###${' '.repeat(64)}###`);
    console.log(`${'#'.repeat(70)}`);
    console.log(`${'#'.repeat(70)}`);
    console.log(`\nDetections: ${globalStats.personDetections} person, ${globalStats.faceDetections} face (${faceRecognitionRate}% with names)`);
    console.log(`Notifications: ${totalNotifications} sent (${globalStats.namedNotificationsSent} named, ${globalStats.genericNotificationsSent} generic, ${globalStats.upgradeNotificationsSent} upgrades)`);
    console.log(`Suppressions: ${totalSuppressions} (${suppressionRate}% rate)`);
    console.log(`  - ${globalStats.suppressedByPersonIdCooldown} by personId cooldown`);
    console.log(`  - ${globalStats.suppressedByFaceCooldown} by face cooldown`);
    console.log(`  - ${globalStats.suppressedByPendingBuffer} by buffer check`);
    console.log(`  - ${globalStats.suppressedByProcessingLock} by processing lock`);

    // Calculate ReID effectiveness
    const totalCooldownSuppressions = globalStats.suppressedByPersonIdCooldown + globalStats.suppressedByFaceCooldown;
    const reidEffectiveness = totalCooldownSuppressions > 0
        ? ((globalStats.suppressedByPersonIdCooldown / totalCooldownSuppressions) * 100).toFixed(1)
        : '0.0';

    console.log(`\nReID Effectiveness:`);
    console.log(`  - ${reidEffectiveness}% (${globalStats.suppressedByPersonIdCooldown} caught by personId, ${globalStats.suppressedByFaceCooldown} required face cooldown)`);

    console.log(`\nCooldown Misses (potential duplicates sent):`);
    console.log(`  - ${globalStats.notificationsSentDespiteRecentPersonId} sent despite recent personId`);
    console.log(`  - ${globalStats.notificationsSentDespiteRecentFace} sent despite recent face`);

    console.log(`\nReID Accuracy:`);
    console.log(`  - Unique personIds: ${uniquePersonIdCount}`);
    console.log(`  - Unique faces: ${uniqueFaceLabelCount}${uniqueFaceLabelCount > 0 ? ' (' + Array.from(globalStats.uniqueFaceLabels).join(', ') + ')' : ''}`);
    console.log(`  - Generic persons: ${globalStats.genericPersonCount}`);
    console.log(`  - ReID fragmentation: ${uniquePersonIdCount} personIds for ${actualPeopleCount} actual people (${reidFragmentation}x)`);
    console.log(`\nReID Service: ${globalStats.reidServiceCalls} calls, avg ${avgReidTime}ms, ${globalStats.reidServiceFailures} failures`);
    console.log(`\n${'#'.repeat(70)}`);
    console.log(`${'#'.repeat(70)}\n\n`);
}

// Global cleanup interval (runs once for all instances)
let globalCleanupInterval: NodeJS.Timeout | null = null;
let instanceCount = 0;

class ListenerMixin extends MixinDeviceBase<ObjectDetector> implements ObjectDetector {
    listener: any;
    detectionLastProcessed: Map<string, number> = new Map();


    constructor(options: any) {
        super(options);

        // Increment instance counter
        instanceCount++;

        // Set up stats logging interval (only once) - every 5 minutes
        if (!statsInterval) {
            statsInterval = setInterval(() => {
                logStats();
            }, 5 * 60 * 1000);
        }

        // Set up global cleanup interval (only once)
        if (!globalCleanupInterval) {
            globalCleanupInterval = setInterval(() => {
                const now = Date.now();

                // Cleanup cooldowns (1 hour - plenty of time since cooldown is 5 mins)
                for (const [id, data] of globalCooldowns) {
                    if (now - data.timestamp > 3600000) {
                        globalCooldowns.delete(id);
                    }
                }

                // Cleanup face cooldowns (1 hour)
                for (const [name, timestamp] of globalFaceCooldowns) {
                    if (now - timestamp > 3600000) {
                        globalFaceCooldowns.delete(name);
                    }
                }

                // Safety cleanup for pending notifications
                for (const [id, data] of globalPendingNotifications) {
                    if (globalPendingNotifications.size > 100) {
                        console.warn('Smart Notifier: Pending notifications map too large, clearing.');
                        clearTimeout(data.timer);
                        globalPendingNotifications.delete(id);
                    }
                }
            }, 60000);
        }

        // Set up listener for object detection events
        if (!this.listener) {
            // Clean up old detection timestamps every minute (per-instance)
            const checkInterval = setInterval(() => {
                const now = Date.now();

                // Cleanup detection throttling (1 minute)
                for (const [id, time] of this.detectionLastProcessed) {
                    if (now - time > 60000) {
                        this.detectionLastProcessed.delete(id);
                    }
                }
            }, 60000);

            // Store the interval reference for cleanup
            (this as any).localCleanupInterval = checkInterval;

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

                // Filter for person/face detections with proper score thresholds
                const PERSON_THRESHOLD = 0.8;
                const FACE_THRESHOLD = 0.7;

                const personDetections = detected.detections.filter(d =>
                    (d.className === 'person' && d.score >= PERSON_THRESHOLD) ||
                    (d.className === 'face' && d.score >= FACE_THRESHOLD)
                );

                if (personDetections.length > 0) {
                    console.log(`[${timestamp()}] Smart Notifier: Raw detections for ${this.name}:`,
                        personDetections.map(d => `${d.className} (${d.score.toFixed(2)}) [${d.boundingBox.map(n => Math.round(n)).join(',')}]`).join('; ')
                    );

                    // Count person vs face detections
                    for (const det of personDetections) {
                        if (det.className === 'person') {
                            globalStats.personDetections++;
                        } else if (det.className === 'face') {
                            globalStats.faceDetections++;
                        }
                    }
                }

                // Skip if no person/face detections
                if (personDetections.length === 0) {
                    return;
                }



                // Call ReID service using BufferConverter interface
                try {
                    // Get snapshot via getRecordingStreamThumbnail (always works, no 10s cache limit)
                    let snapshot: any = null;
                    try {
                        if (typeof (source as any).getRecordingStreamThumbnail === 'function') {
                            snapshot = await (source as any).getRecordingStreamThumbnail(detected.timestamp);
                        }
                    } catch (e) {
                        console.log('Smart Notifier: getRecordingStreamThumbnail failed', e);
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

                    globalStats.reidServiceCalls++;

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
                    globalStats.reidServiceTotalTime += duration;
                    console.log(`[${timestamp()}] Smart Notifier: ReID service response received in ${duration}ms`);

                    // Process ReID results
                    if (parsed.detections) {
                        for (const det of parsed.detections) {
                            // Only notify for persons
                            if (det.className !== 'person') continue;

                            const personId = det.personId;
                            if (!personId) continue;

                            // Track unique personIds
                            globalStats.uniquePersonIds.add(personId);

                            // GLOBAL LOCK: Check if we are already processing this person
                            if (globalProcessing.has(personId)) {
                                globalStats.suppressedByProcessingLock++;
                                // console.log(`[${timestamp()}] Smart Notifier: Skipping ${personId} - already processing`);
                                continue;
                            }
                            globalProcessing.add(personId);

                            try {
                                // Determine name for current detection
                                const currentLabel = (det.label && det.label !== 'person' && det.label !== 'face') ? det.label : null;

                                // Track detections with names and unique face labels
                                if (currentLabel) {
                                    globalStats.detectionsWithNames++;
                                    globalStats.uniqueFaceLabels.add(currentLabel);
                                }

                                const now = Date.now();
                                const PERSON_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

                                // FACE COOLDOWN CHECK (trumps personId) - check FIRST
                                if (currentLabel) {
                                    const lastFaceNotification = globalFaceCooldowns.get(currentLabel);
                                    if (lastFaceNotification && (now - lastFaceNotification < PERSON_COOLDOWN_MS)) {
                                        globalStats.suppressedByFaceCooldown++;
                                        console.log(`[${timestamp()}] Smart Notifier: Skipping ${personId} - face "${currentLabel}" was recently notified (face cooldown active)`);
                                        continue;
                                    }
                                }

                                // Check per-person cooldown
                                const lastSeen = globalCooldowns.get(personId);

                                // If we have a lastSeen record, check if we should skip
                                if (lastSeen) {
                                    const timeDiff = now - lastSeen.timestamp;
                                    if (timeDiff < PERSON_COOLDOWN_MS) {
                                        // Allow notification if:
                                        // 1. Upgrade: NO label → named label
                                        // 2. Label change: different named person (ReID failure case)
                                        const isUpgrade = currentLabel && !lastSeen.label;
                                        const isLabelChange = currentLabel && lastSeen.label && currentLabel !== lastSeen.label;

                                        // Only suppress if it's the same person
                                        if (!isUpgrade && !isLabelChange) {
                                            globalStats.suppressedByPersonIdCooldown++;
                                            console.log(`[${timestamp()}] Smart Notifier: Skipping notification for ${personId} (cooldown active). Last label: ${lastSeen.label}, Current: ${currentLabel}`);
                                            continue;
                                        }

                                        // If it IS an upgrade or label change, we proceed
                                        if (isUpgrade) {
                                            console.log(`[${timestamp()}] Smart Notifier: Cooldown override: Upgrading notification for ${personId} from "${lastSeen.label || 'Person'}" to "${currentLabel}"`);
                                            globalStats.upgradeNotificationsSent++;
                                        } else if (isLabelChange) {
                                            console.log(`[${timestamp()}] Smart Notifier: Cooldown override: Label changed for ${personId} from "${lastSeen.label}" to "${currentLabel}" (ReID failure - different person)`);
                                        }
                                    }
                                }

                                // BUFFERING LOGIC
                                const pending = globalPendingNotifications.get(personId);

                                if (currentLabel) {
                                    // We have a specific name!
                                    if (pending) {
                                        console.log(`[${timestamp()}] Smart Notifier: Found name "${currentLabel}" for pending ${personId}. Sending immediately.`);
                                        clearTimeout(pending.timer);
                                        globalPendingNotifications.delete(personId);
                                    }

                                    // CRITICAL FIX: Check cooldown ONE MORE TIME to be safe against race conditions
                                    const freshLastSeen = globalCooldowns.get(personId);
                                    if (freshLastSeen && (Date.now() - freshLastSeen.timestamp < PERSON_COOLDOWN_MS)) {
                                        // If we already have a label, and it matches current, SKIP
                                        if (freshLastSeen.label === currentLabel) {
                                            globalStats.suppressedByPersonIdCooldown++;
                                            console.log(`[${timestamp()}] Smart Notifier: Skipping duplicate notification for ${personId} (race condition caught). Label: ${currentLabel}`);
                                            continue;
                                        }
                                    }

                                    // Check if this is a cooldown miss (should have been caught but wasn't)
                                    const recentPersonId = globalCooldowns.get(personId);
                                    if (recentPersonId && (Date.now() - recentPersonId.timestamp < PERSON_COOLDOWN_MS)) {
                                        globalStats.notificationsSentDespiteRecentPersonId++;
                                    }
                                    const recentFace = globalFaceCooldowns.get(currentLabel);
                                    if (recentFace && (Date.now() - recentFace < PERSON_COOLDOWN_MS)) {
                                        globalStats.notificationsSentDespiteRecentFace++;
                                    }

                                    // CRITICAL FIX: Update cooldown SYNCHRONOUSLY *before* awaiting the send
                                    globalCooldowns.set(personId, { timestamp: Date.now(), label: currentLabel });

                                    // Send notification (async)
                                    globalStats.namedNotificationsSent++;
                                    await this.sendNotification(personId, currentLabel, jpegBuffer, det.boundingBox, true);
                                } else {
                                    // Generic "Person"
                                    if (globalPendingNotifications.has(personId)) {
                                        // Already buffering, ignore this frame
                                        globalStats.suppressedByPendingBuffer++;
                                        continue;
                                    }

                                    // If we are already in cooldown (and this is generic), we definitely skip
                                    if (lastSeen && (now - lastSeen.timestamp < PERSON_COOLDOWN_MS)) {
                                        globalStats.suppressedByPersonIdCooldown++;
                                        continue;
                                    }

                                    // Track generic person count for ReID accuracy
                                    globalStats.genericPersonCount++;

                                    // Start buffer
                                    console.log(`[${timestamp()}] Smart Notifier: Buffering notification for ${personId} (waiting 10s for identification)...`);

                                    // Capture bounding box for closure
                                    const detBoundingBox = det.boundingBox;

                                    const timer = setTimeout(() => {
                                        // Check cooldown AGAIN before sending, in case an upgrade happened while waiting
                                        const PERSON_COOLDOWN_MS = 5 * 60 * 1000;
                                        const freshLastSeen = globalCooldowns.get(personId);
                                        console.log(`[${timestamp()}] Smart Notifier: Buffer timer fired for ${personId}. FreshLastSeen: ${JSON.stringify(freshLastSeen)}`);

                                        if (freshLastSeen && (Date.now() - freshLastSeen.timestamp < PERSON_COOLDOWN_MS)) {
                                            globalStats.suppressedByPendingBuffer++;
                                            console.log(`[${timestamp()}] Smart Notifier: Buffering finished, but person ${personId} was already notified/updated. Skipping generic notification.`);
                                            globalPendingNotifications.delete(personId);
                                            return;
                                        }

                                        // Check if this is a cooldown miss before sending
                                        const recentPersonIdCheck = globalCooldowns.get(personId);
                                        if (recentPersonIdCheck && (Date.now() - recentPersonIdCheck.timestamp < PERSON_COOLDOWN_MS)) {
                                            globalStats.notificationsSentDespiteRecentPersonId++;
                                        }

                                        // Update cooldown synchronously before sending
                                        globalCooldowns.set(personId, { timestamp: Date.now(), label: null });
                                        globalPendingNotifications.delete(personId);
                                        globalStats.genericNotificationsSent++;
                                        this.sendNotification(personId, 'Person', jpegBuffer, detBoundingBox, true);
                                    }, 10000);

                                    // Set entry immediately to block parallel requests
                                    globalPendingNotifications.set(personId, { timer, image: jpegBuffer, boundingBox: detBoundingBox });
                                }
                            } finally {
                                globalProcessing.delete(personId);
                            }
                        }
                    }
                } catch (e) {
                    globalStats.reidServiceFailures++;
                    console.error('Smart Notifier: Failed to call ReID service:', e);
                }
            });
        }
    }

    async sendNotification(personId: string, name: string, imageBuffer: Buffer, boundingBox: number[], skipCooldownUpdate = false) {
        const title = name !== 'Person' ? `${name} Detected` : `New Person Detected`;
        const body = `${title} at ${this.name}`;

        console.log(`[${timestamp()}] Smart Notifier: Preparing notification for personId=${personId}. Name="${name}"`);
        console.log(`[${timestamp()}] Smart Notifier: Sending notification: ${body}`);

        // Update cooldown if not skipped (legacy support or direct calls)
        if (!skipCooldownUpdate) {
            globalCooldowns.set(personId, { timestamp: Date.now(), label: name === 'Person' ? null : name });
        }

        // Update FACE cooldown for named persons (trumps personId)
        if (name !== 'Person') {
            globalFaceCooldowns.set(name, Date.now());
            console.log(`[${timestamp()}] Smart Notifier: Set face cooldown for "${name}"`);
        }

        // Get Notifier device and send notification
        try {
            // Crop to bounding box (enlarged by 100% = 2x) and resize
            const croppedBuffer = cropAndResizeJpeg(imageBuffer, boundingBox, 1.0, 640, 70);
            console.log(`[${timestamp()}] Smart Notifier: Cropped notification image to detection bbox 2x (${Math.round(imageBuffer.length / 1024)}KB -> ${Math.round(croppedBuffer.length / 1024)}KB)`);
            const mediaObject = await sdk.mediaManager.createMediaObject(croppedBuffer, 'image/jpeg');

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

        // Clear local cleanup interval
        if ((this as any).localCleanupInterval) {
            clearInterval((this as any).localCleanupInterval);
            (this as any).localCleanupInterval = null;
        }

        // Decrement instance counter
        instanceCount--;

        // Clear global cleanup interval if this is the last instance
        if (instanceCount === 0) {
            if (globalCleanupInterval) {
                clearInterval(globalCleanupInterval);
                globalCleanupInterval = null;
            }

            if (statsInterval) {
                clearInterval(statsInterval);
                statsInterval = null;
            }

            // Clear all global state
            for (const [id, pending] of globalPendingNotifications) {
                clearTimeout(pending.timer);
            }
            globalPendingNotifications.clear();
            globalCooldowns.clear();
            globalProcessing.clear();
            globalFaceCooldowns.clear();
        }
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