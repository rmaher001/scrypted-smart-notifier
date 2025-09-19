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

                    const personDetections = detected.detections.filter(d =>
                        d.className === 'person' || d.className === 'face'
                    );

                    // Skip if no person/face detections
                    if (personDetections.length === 0) {
                        return;
                    }

                    // Get ReID service again in case it changed
                    const reid = systemManager.getDeviceByName<BufferConverter>('ReID Service');
                    if (!reid) {
                        console.log('ReID service lost');
                        return;
                    }

                    // Call ReID service using BufferConverter interface
                    try {
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
                                zones: d.zones
                            })),
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
            // If failed, retry periodically
            this.checkInterval = setInterval(() => {
                if (setupListener()) {
                    clearInterval(this.checkInterval);
                    this.checkInterval = null;
                }
            }, 5000);
        }
    }

    release() {
        this.listener?.removeListener();
        this.listener = null;
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }
}

class SmartNotifierListener extends ScryptedDeviceBase implements MixinProvider {
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