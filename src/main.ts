import sdk, { MixinProvider, ScryptedDeviceBase, MixinDeviceBase, ScryptedDeviceType, ScryptedInterface, BufferConverter, ObjectDetector } from '@scrypted/sdk';

const { systemManager } = sdk;

class ListenerMixin extends MixinDeviceBase<ObjectDetector> {
    listener: any;
    checkInterval: NodeJS.Timeout;
    mixinDevice: any;

    constructor(options: any) {
        super(options);
        this.mixinDevice = options.mixinDevice;


        // Check for ReID service availability periodically
        const setupListener = () => {
            // Use name-based lookup for reliability across different installations
            const reid = systemManager.getDeviceByName<BufferConverter>('ReID Service');
            if (!reid) {
                return false;
            }

            // Only set up listener if we don't have one already
            if (!this.listener) {
                this.listener = options.mixinDevice.listen(ScryptedInterface.ObjectDetector, async (source: any, details: any, detected: any) => {
                    // CRITICAL: Only process events with valid detection IDs (not motion-only events)
                    if (!detected.detectionId) {
                        return;
                    }

                    // Filter for person/face detections only
                    if (!detected.detections) {
                        return;
                    }

                    // Filter for person and face detections
                    const personDetections = detected.detections.filter(d => d.className === 'person');
                    const faceDetections = detected.detections.filter(d => d.className === 'face');

                    // Skip if no person detections (we focus on person bodies for ReID)
                    if (personDetections.length === 0) {
                        return;
                    }

                    // Attach face labels to person detections when available
                    personDetections.forEach(person => {
                        // Find a face detection that might belong to this person
                        // (In practice, there's often one face per person detection)
                        const face = faceDetections.find(f => f.label);
                        if (face) {
                            (person as any).faceLabel = face.label;
                        }
                    });

                    // Get ReID service again in case it changed
                    const reid = systemManager.getDeviceByName<BufferConverter>('ReID Service');
                    if (!reid) {
                        console.log('ReID service lost');
                        return;
                    }

                    // Call ReID service using BufferConverter interface
                    try {
                        // Get detection snapshot using getRecordingStreamThumbnail
                        let imageBase64: string | null = null;
                        try {
                            const snapshot = await this.mixinDevice.getRecordingStreamThumbnail(detected.timestamp);
                            if (snapshot) {
                                console.log(`Smart Notifier: Retrieved snapshot for ${this.name}`);
                                // Convert MediaObject to buffer then to base64
                                const imageBuffer = await sdk.mediaManager.convertMediaObjectToBuffer(snapshot, 'image/jpeg');
                                imageBase64 = imageBuffer.toString('base64');
                                console.log(`Smart Notifier: Converted snapshot to base64 (${imageBuffer.length} bytes)`);
                            }
                        } catch (e) {
                            console.log(`Smart Notifier: Failed to get snapshot for ${this.name}:`, e);
                        }

                        if (!imageBase64) {
                            console.log(`Smart Notifier: No image available for ${this.name}, skipping ReID`);
                            return;
                        }

                        // Extract relevant detection data (person/face only)
                        const data = {
                            timestamp: detected.timestamp,
                            detectionId: detected.detectionId,
                            inputDimensions: detected.inputDimensions,
                            sourceId: detected.sourceId,
                            deviceId: this.id,
                            deviceName: this.name,
                            detections: personDetections.map(d => ({
                                className: d.className,
                                label: d.label,
                                score: d.score,
                                boundingBox: d.boundingBox,
                                id: d.id,  // Tracking ID if available
                                zones: d.zones,
                                faceLabel: (d as any).faceLabel || undefined  // Face label if available
                            })),
                            // Send base64 encoded image for ReID processing
                            imageBase64: imageBase64,
                            // Metadata
                            detectionCount: personDetections.length,
                            hasPersons: true  // Always true since we filtered
                        };

                        console.log(`Smart Notifier: Calling ReID service for ${this.name} with ${personDetections.length} person(s)`);
                        const startTime = Date.now();

                        const result = await reid.convert(
                            JSON.stringify(data),
                            'application/json',
                            'application/reid'
                        );

                        const duration = Date.now() - startTime;
                        console.log(`Smart Notifier: ReID service response received in ${duration}ms`);

                        const parsed = JSON.parse(result);

                        // TODO: Process ReID result and decide on notification
                    } catch (e) {
                        console.error('Smart Notifier: Failed to call ReID service:', e);
                    }
                });
            }
            return true;
        };

        // Try to set up immediately
        if (!setupListener()) {
            // If failed, retry periodically (but only if not already running)
            if (!this.checkInterval) {
                this.checkInterval = setInterval(() => {
                    if (setupListener()) {
                        clearInterval(this.checkInterval);
                        this.checkInterval = null;
                    }
                }, 5000);
            }
        }
    }

    release() {
        // Clean up interval first
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }

        // Clean up listener
        this.listener?.removeListener();
        this.listener = null;

        // Call parent cleanup - this is critical!
        super.release();
    }
}

class SmartNotifierListener extends ScryptedDeviceBase implements MixinProvider {
    constructor() {
        super();
        console.log('Smart Notifier: Main plugin initialized');
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (type === ScryptedDeviceType.Camera && interfaces.includes(ScryptedInterface.ObjectDetector)) {
            return [];
        }
        return undefined as any;
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

export default new SmartNotifierListener();