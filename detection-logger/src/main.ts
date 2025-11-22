import sdk, {
  MixinProvider,
  ScryptedDeviceBase,
  ScryptedInterface,
  ObjectsDetected,
  ObjectDetectionTypes,
  DeviceProvider,
  ScryptedDeviceType,
  MixinDeviceBase,
  ObjectDetector,
  EventListenerRegister,
} from '@scrypted/sdk';

const { deviceManager } = sdk;

class DetectionLoggerMixin extends MixinDeviceBase<ObjectDetector> implements ObjectDetector {
  listener?: EventListenerRegister;

  constructor(options: any) {
    super(options);

    this.startListening();
  }

  private startListening() {
    this.listener = (this.mixinDevice as any).listen(ScryptedInterface.ObjectDetector, (source: ScryptedDeviceBase, details: any, data: ObjectsDetected) => {
      this.onDetection(data);
    });

    this.console.log('Detection logger started for device:', this.name);
  }

  private onDetection(detection: ObjectsDetected) {
    if (!detection) {
      return;
    }

    this.console.log('=== Detection Event ===');
    this.console.log('Timestamp:', new Date().toISOString());
    this.console.log('Detection ID:', detection.detectionId);

    if (detection.detections && detection.detections.length > 0) {
      this.console.log('Detections:', detection.detections.length);

      for (let i = 0; i < detection.detections.length; i++) {
        const d = detection.detections[i];
        this.console.log(`  [${i}] Class:`, d.className);
        this.console.log(`      Score:`, d.score);
        if (d.label) {
          this.console.log(`      Label:`, d.label);
        }
        if (d.boundingBox) {
          this.console.log(`      Box: [${d.boundingBox.join(', ')}]`);
        }
        if (d.zones && d.zones.length > 0) {
          this.console.log(`      Zones:`, d.zones.join(', '));
        }
      }
    }

    this.console.log('=====================');
  }

  async getDetectionInput(detectionId?: string): Promise<any> {
    return this.mixinDevice.getDetectionInput(detectionId!);
  }

  async getObjectTypes(): Promise<ObjectDetectionTypes> {
    return this.mixinDevice.getObjectTypes();
  }

  async release() {
    this.listener?.removeListener();
    this.console.log('Detection logger released for device:', this.name);
  }
}

class DetectionLoggerProvider extends ScryptedDeviceBase implements MixinProvider {
  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if (interfaces.includes(ScryptedInterface.ObjectDetector)) {
      return [ScryptedInterface.ObjectDetector];
    }
    return [];
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: any): Promise<any> {
    return new DetectionLoggerMixin({
      mixinDevice,
      mixinDeviceInterfaces,
      mixinDeviceState,
      mixinProviderNativeId: this.nativeId,
      group: 'Detection Logger',
      groupKey: 'detection-logger',
    });
  }

  async releaseMixin(id: string, mixinDevice: any): Promise<void> {
    await mixinDevice.release();
  }
}

export default DetectionLoggerProvider;
