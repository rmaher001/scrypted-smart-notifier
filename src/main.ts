import sdk, { MixinProvider, ScryptedDeviceBase, MixinDeviceBase, ScryptedDeviceType, ScryptedInterface, ObjectDetector, Notifier, Settings, SettingValue, ObjectsDetected, ObjectDetectionResult, MediaObject, WritableDeviceState } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';

const { systemManager } = sdk;

// Define ReID-specific interfaces
interface PersonDetection extends ObjectDetectionResult {
    faceLabel?: string;
}

interface ReIDData {
    timestamp: number;
    detectionId: string;
    inputDimensions?: [number, number];
    sourceId?: string;
    deviceId: string;
    deviceName: string;
    detections: PersonDetection[];
    imageBase64: string;
    detectionCount: number;
    hasPersons: boolean;
}

interface ReIDPerson {
    personId: string;
    isNew: boolean;
    confidence: number;
    matchedCameras?: string[];
}

interface ReIDResult {
    processed: boolean;
    message?: string;
    persons?: ReIDPerson[];
}

interface MixinOptions {
    mixinDevice: any;
    mixinDeviceInterfaces: ScryptedInterface[];
    mixinDeviceState: WritableDeviceState;
    mixinProviderNativeId: string;
    provider: SmartNotifierListener;
}

interface NotificationData {
    personId?: string;
    deviceName: string;
    confidence?: number;
    matchedCameras?: string[];
    timestamp: number;
    fallback?: boolean;
}

class ListenerMixin extends MixinDeviceBase<ObjectDetector> {
    listener: { removeListener(): void } | null = null;
    checkInterval: NodeJS.Timeout | null = null;
    mixinDevice: any;
    provider: SmartNotifierListener;

    constructor(options: MixinOptions) {
        super(options);
        this.mixinDevice = options.mixinDevice;
        this.provider = options.provider;


        // Check for ReID service availability periodically
        const setupListener = () => {
            // Use name-based lookup for reliability across different installations
            const reid = systemManager.getDeviceByName('ReID Service') as any;
            if (!reid) {
                return false;
            }

            // Only set up listener if we don't have one already
            if (!this.listener) {
                this.listener = options.mixinDevice.listen(ScryptedInterface.ObjectDetector, async (_source: ScryptedDeviceBase, _details: ObjectsDetected, detected: ObjectsDetected) => {
                    // CRITICAL: Only process events with valid detection IDs (not motion-only events)
                    if (!detected.detectionId) {
                        return;
                    }

                    // Filter for person/face detections only
                    if (!detected.detections) {
                        return;
                    }

                    // Filter for person and face detections
                    const personDetections = detected.detections?.filter((d: ObjectDetectionResult) => d.className === 'person') || [];
                    const faceDetections = detected.detections?.filter((d: ObjectDetectionResult) => d.className === 'face') || [];

                    // Skip if no person detections (we focus on person bodies for ReID)
                    if (personDetections.length === 0) {
                        return;
                    }

                    // Attach face labels to person detections when available
                    const enhancedPersonDetections: PersonDetection[] = personDetections.map((person: ObjectDetectionResult) => {
                        // Find a face detection that might belong to this person
                        // (In practice, there's often one face per person detection)
                        const face = faceDetections.find((f: ObjectDetectionResult) => f.label);
                        return {
                            ...person,
                            faceLabel: face?.label
                        };
                    });

                    // Get ReID service again in case it changed
                    const reid = systemManager.getDeviceByName('ReID Service') as any;
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
                        const data: ReIDData = {
                            timestamp: detected.timestamp,
                            detectionId: detected.detectionId || '',
                            inputDimensions: detected.inputDimensions,
                            sourceId: (detected as any).sourceId, // sourceId not in standard ObjectsDetected but may be added by system
                            deviceId: this.id,
                            deviceName: this.name,
                            detections: enhancedPersonDetections,
                            // Send base64 encoded image for ReID processing
                            imageBase64: imageBase64,
                            // Metadata
                            detectionCount: enhancedPersonDetections.length,
                            hasPersons: true  // Always true since we filtered
                        };

                        console.log(`Smart Notifier: Calling ReID service for ${this.name} with ${enhancedPersonDetections.length} person(s)`);
                        const startTime = Date.now();

                        const result = await reid.convert(
                            JSON.stringify(data),
                            'application/json',
                            'application/reid'
                        );

                        const duration = Date.now() - startTime;
                        console.log(`Smart Notifier: ReID service response received in ${duration}ms`);

                        const parsed: ReIDResult = JSON.parse(result);
                        console.log(`Smart Notifier: ReID result:`, parsed);

                        // Validate ReID result structure
                        if (!parsed || typeof parsed.processed !== 'boolean') {
                            console.error('Smart Notifier: Invalid ReID result structure:', parsed);
                            return;
                        }

                        if (!parsed.processed) {
                            console.log(`Smart Notifier: ReID service could not process detection - ${parsed.message || 'unknown error'}`);
                            return;
                        }

                        // Process each person in the result
                        if (parsed.persons && Array.isArray(parsed.persons)) {
                            for (const person of parsed.persons) {
                                console.log(`Smart Notifier: Person ${person.personId} - isNew: ${person.isNew}, confidence: ${person.confidence}, matchedCameras: ${person.matchedCameras?.join(', ') || 'none'}`);

                                // Send notification only for new persons
                                if (person.isNew === true) {
                                    await this.sendPersonNotification(detected, person);
                                } else {
                                    console.log(`Smart Notifier: Suppressing notification for known person ${person.personId} on ${this.name}`);
                                }
                            }
                        } else {
                            console.log('Smart Notifier: No persons found in ReID result');
                        }
                    } catch (e) {
                        console.error('Smart Notifier: Failed to call ReID service:', e);
                        // Graceful degradation - send notification without ReID processing
                        console.log('Smart Notifier: Falling back to notification without deduplication');
                        await this.sendFallbackNotification(detected);
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

    async sendPersonNotification(detected: ObjectsDetected, person: ReIDPerson) {
        try {
            console.log(`Smart Notifier: Sending notification for new person ${person.personId} on ${this.name}`);

            // Create notification content
            const title = "Person Detected";
            let body = `New person detected on ${this.name}`;

            // Add matched cameras info if available
            if (person.matchedCameras && person.matchedCameras.length > 0) {
                body += ` (previously seen on: ${person.matchedCameras.join(', ')})`;
            }

            // Add face label if available
            const personDetection = detected.detections?.find((d: ObjectDetectionResult) => d.className === 'person') as PersonDetection;
            if (personDetection?.faceLabel) {
                body += ` - ${personDetection.faceLabel}`;
            }

            // Get the detection snapshot for notification image
            let notificationImage: MediaObject | null = null;
            try {
                const snapshot = await this.mixinDevice.getRecordingStreamThumbnail(detected.timestamp);
                if (snapshot) {
                    notificationImage = snapshot;
                }
            } catch (e) {
                console.log(`Smart Notifier: Could not get snapshot for notification:`, e);
            }

            const notificationData: NotificationData = {
                personId: person.personId,
                deviceName: this.name,
                confidence: person.confidence,
                matchedCameras: person.matchedCameras || [],
                timestamp: detected.timestamp
            };

            await this.sendNotificationToDevices(title, body, notificationImage, notificationData);

        } catch (e) {
            console.error(`Smart Notifier: Failed to send notification for person ${person.personId}:`, e);
        }
    }

    async sendFallbackNotification(detected: ObjectsDetected) {
        try {
            console.log(`Smart Notifier: Sending fallback notification for ${this.name}`);

            const title = "Person Detected";
            const body = `Person detected on ${this.name} (ReID unavailable)`;

            // Get the detection snapshot for notification image
            let notificationImage: MediaObject | null = null;
            try {
                const snapshot = await this.mixinDevice.getRecordingStreamThumbnail(detected.timestamp);
                if (snapshot) {
                    notificationImage = snapshot;
                }
            } catch (e) {
                console.log(`Smart Notifier: Could not get snapshot for fallback notification:`, e);
            }

            const notificationData: NotificationData = {
                deviceName: this.name,
                fallback: true,
                timestamp: detected.timestamp
            };

            await this.sendNotificationToDevices(title, body, notificationImage, notificationData);

        } catch (e) {
            console.error(`Smart Notifier: Failed to send fallback notification:`, e);
        }
    }

    async sendNotificationToDevices(title: string, body: string, image: MediaObject | null, data: NotificationData) {
        try {
            // Get selected notification devices from settings
            const notifierDeviceIds = this.provider.getNotificationDevices();

            if (notifierDeviceIds.length === 0) {
                console.log('Smart Notifier: No notification devices configured in settings');
                return;
            }

            console.log(`Smart Notifier: Sending notification to ${notifierDeviceIds.length} configured device(s)`);

            // Send to each notifier device
            for (const deviceId of notifierDeviceIds) {
                try {
                    const notifierDevice = systemManager.getDeviceById<Notifier>(deviceId);
                    if (!notifierDevice || typeof notifierDevice.sendNotification !== 'function') {
                        console.log(`Smart Notifier: Device ${deviceId} missing sendNotification method`);
                        continue;
                    }

                    const options = {
                        body,
                        data,
                        timestamp: Date.now()
                    };

                    if (image) {
                        await notifierDevice.sendNotification(title, options, image);
                        console.log(`Smart Notifier: ✅ Notification with image sent to ${deviceId}`);
                    } else {
                        await notifierDevice.sendNotification(title, options);
                        console.log(`Smart Notifier: ✅ Notification sent to ${deviceId}`);
                    }

                } catch (e) {
                    console.error(`Smart Notifier: Failed to send notification to ${deviceId}:`, e);
                }
            }

        } catch (e) {
            console.error(`Smart Notifier: Failed to send notifications:`, e);
        }
    }

    release() {
        // Clean up interval first
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }

        // Clean up listener
        if (this.listener) {
            this.listener.removeListener();
            this.listener = null;
        }

        // Call parent cleanup - this is critical!
        super.release();
    }
}

class SmartNotifierListener extends ScryptedDeviceBase implements MixinProvider, Settings {
    storageSettings = new StorageSettings(this, {
        notificationDevices: {
            group: 'Notifications',
            title: 'Notification Devices',
            description: 'Select devices to receive person detection notifications',
            type: 'device',
            deviceFilter: `interfaces && interfaces.includes('${ScryptedInterface.Notifier}')`,
            multiple: true,
        }
    });

    constructor() {
        super();
        console.log('Smart Notifier: Main plugin initialized');
    }

    getSettings() {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    getNotificationDevices(): string[] {
        const devices = this.storageSettings.values.notificationDevices;
        return Array.isArray(devices) ? devices.filter((id): id is string => typeof id === 'string') : [];
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (type === ScryptedDeviceType.Camera && interfaces.includes(ScryptedInterface.ObjectDetector)) {
            return [];
        }
        return null;
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState) {
        return new ListenerMixin({
            mixinDevice,
            mixinDeviceInterfaces,
            mixinDeviceState,
            mixinProviderNativeId: this.nativeId,
            provider: this
        });
    }

    async releaseMixin(_id: string, mixinDevice: ListenerMixin | null) {
        mixinDevice?.release();
    }
}

export default new SmartNotifierListener();