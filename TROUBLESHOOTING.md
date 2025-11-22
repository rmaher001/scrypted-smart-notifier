# Troubleshooting: Smart Notifier Plugin Issues and Fixes

This document chronicles the issues encountered when developing the smart-notifier plugin and how they were resolved.

## Overview

The smart-notifier plugin initially failed to load due to architectural issues in the Scrypted plugin implementation. After fixing those issues, runtime errors and duplicate notifications required additional fixes.

---

## Issue #1: Plugin Failed to Load

### Problem: Wrong Export Pattern

**What was wrong:**
```typescript
export default new SmartNotifierListener();  // ❌ Exports an instance
```

**Why it failed:**
Scrypted expects the plugin to export the class itself, not an instantiated object. Scrypted needs to control the instantiation lifecycle.

**Fix:**
```typescript
export default SmartNotifierListener;  // ✅ Exports the class
```

---

## Issue #2: Missing Constructor

### Problem: Provider Class Had No Constructor

**What was wrong:**
```typescript
class SmartNotifierListener extends ScryptedDeviceBase implements MixinProvider {
    async canMixin(...) { ... }  // No constructor
}
```

**Why it failed:**
Scrypted couldn't properly initialize the plugin without a constructor that accepts the `nativeId` parameter.

**Fix:**
```typescript
class SmartNotifierListener extends ScryptedDeviceBase implements MixinProvider {
    constructor(nativeId?: string) {
        super(nativeId);
    }
    async canMixin(...) { ... }
}
```

---

## Issue #3: Invalid canMixin Return Value

### Problem: Returned `undefined as any`

**What was wrong:**
```typescript
async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if (type === ScryptedDeviceType.Camera && interfaces.includes(ScryptedInterface.ObjectDetector)) {
        return [ScryptedInterface.Settings];
    }
    return undefined as any;  // ❌ Invalid TypeScript type
}
```

**Why it failed:**
`undefined as any` is not a valid return value for the canMixin signature. Scrypted expects either a string array or null.

**Fix:**
```typescript
async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if (type === ScryptedDeviceType.Camera && interfaces.includes(ScryptedInterface.ObjectDetector)) {
        return [ScryptedInterface.ObjectDetector];
    }
    return null;  // ✅ Valid return type
}
```

---

## Issue #4: Wrong Interface Declaration

### Problem: Returned Settings Instead of ObjectDetector

**What was wrong:**
```typescript
return [ScryptedInterface.Settings];  // ❌ Wrong interface
```

**Why it failed:**
This told Scrypted the mixin provides the Settings interface, but not ObjectDetector. The mixin wouldn't appear in camera extension lists.

**Fix:**
```typescript
return [ScryptedInterface.ObjectDetector];  // ✅ Correct interface
```

---

## Issue #5: Missing Webpack Bundling

### Problem: Build Script Didn't Bundle Dependencies

**What was wrong:**
```json
"scripts": {
    "build": "tsc"  // ❌ Only compiles TypeScript
}
```

**Why it failed:**
The plugin imports `jpeg-js` which needs to be bundled with the plugin. Without webpack, the dependency wasn't included in the deployed plugin, causing runtime errors.

**Fix:**
```json
"scripts": {
    "build": "tsc && scrypted-webpack"  // ✅ Compiles and bundles
}
```

---

## Issue #6: Incomplete ObjectDetector Implementation

### Problem: Missing Interface Methods

**What was wrong:**
```typescript
class ListenerMixin extends MixinDeviceBase<ObjectDetector> {
    // ❌ No getDetectionInput or getObjectTypes methods
}
```

**Error observed:**
```
Smart Notifier: getDetectionInput failed RPCResultError: target ListenerMixin does not have method getDetectionInput
```

**Why it failed:**
When extending `MixinDeviceBase<ObjectDetector>`, the class should implement the ObjectDetector interface. Cameras calling `getDetectionInput()` failed because the method didn't exist.

**Fix:**
```typescript
class ListenerMixin extends MixinDeviceBase<ObjectDetector> implements ObjectDetector {
    async getDetectionInput(detectionId?: string): Promise<any> {
        return this.mixinDevice.getDetectionInput(detectionId);
    }

    async getObjectTypes(): Promise<ObjectDetectionTypes> {
        return this.mixinDevice.getObjectTypes();
    }
}
```

Also added the import:
```typescript
import { ObjectDetectionTypes } from '@scrypted/sdk';
```

---

## Issue #7: Duplicate Notification Race Condition

### Problem: Multiple Buffer Timers for Same Person

**What was wrong:**
```typescript
// Start buffer
console.log(...);

// Set placeholder immediately to block parallel requests
this.pendingNotifications.set(personId, { timer: null as any, image: jpegBuffer });  // Line 318

const timer = setTimeout(() => {
    // ... notification logic
}, 3000);

// Update with real timer
this.pendingNotifications.set(personId, { timer, image: jpegBuffer });  // Line 338 - OVERWRITES!
```

**Why it failed:**
The code set the map entry twice - once with a null placeholder, then again with the real timer. Between lines 318 and 338, there was a race condition window where another detection could:
1. Check `this.pendingNotifications.has(personId)` → false (or see placeholder)
2. Start creating its own timer
3. Both timers would fire, sending duplicate notifications

**Evidence from logs:**
```
[2025-11-22 04:59:45.802] Preparing notification for personId=person_1763787449330_0ks3j45vf
[2025-11-22 04:59:45.802] Sending notification: New Person Detected at Living Room Camera 1

[2025-11-22 04:59:46.346] Preparing notification for personId=person_1763787449330_0ks3j45vf
[2025-11-22 04:59:46.346] Sending notification: New Person Detected at Living Room Camera 1

[2025-11-22 04:59:47.022] Sent notification to Scrypted Android App
[2025-11-22 04:59:47.023] Sent notification to Scrypted Android App  ← DUPLICATE
```

**Fix:**
```typescript
// Start buffer
console.log(...);

const timer = setTimeout(() => {
    // ... notification logic
}, 3000);

// Set entry immediately to block parallel requests
this.pendingNotifications.set(personId, { timer, image: jpegBuffer });  // Set ONCE
```

Removed the placeholder line entirely. Now the timer is created first, then the map entry is set once with the real timer value. This eliminates the race condition window.

---

## Summary Table

| Issue | What Was Wrong | Fix | Impact |
|-------|----------------|-----|--------|
| #1 Export | Exported instance instead of class | Export class itself | Plugin couldn't instantiate |
| #2 Constructor | Missing constructor | Added constructor with nativeId | Plugin couldn't initialize |
| #3 Return Type | `undefined as any` | Changed to `null` | TypeScript type error |
| #4 Interface | Returned Settings instead of ObjectDetector | Return ObjectDetector | Mixin didn't appear in camera list |
| #5 Build | No webpack bundling | Added scrypted-webpack to build | Missing jpeg-js dependency |
| #6 Methods | Missing getDetectionInput/getObjectTypes | Implemented interface methods | RPC errors when cameras called methods |
| #7 Race Condition | Double map.set() created race window | Removed placeholder, set once | Duplicate notifications |

---

## Timeline of Fixes

1. **Initial deployment** - Plugin failed to load
2. **Fixed #1-5** - Plugin loaded but showed RPC errors
3. **Fixed #6** - Plugin worked but sent duplicate notifications
4. **Fixed #7** - Plugin working correctly with no duplicates

---

## Key Lessons

### Scrypted Plugin Architecture
- Always export the class, not an instance
- Provider classes need constructors with `nativeId` parameter
- canMixin must return either string[] or null (never undefined)
- Declare the correct interfaces that the mixin provides

### TypeScript Best Practices
- Use proper imports from @scrypted/sdk (never `declare const sdk: any`)
- Implement full interfaces, not just partial implementations
- Use webpack to bundle dependencies

### Concurrency Issues
- Always set map/cache entries atomically before async operations
- Be aware of race conditions in buffering/throttling logic
- Test with rapid successive events to catch race conditions

### Debugging Strategy
1. Check Scrypted console logs for errors
2. Verify plugin loads successfully first
3. Test basic functionality before complex features
4. Look for duplicate operations in logs to identify race conditions
