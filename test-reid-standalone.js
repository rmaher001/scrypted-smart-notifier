#!/usr/bin/env node
/**
 * Test script for standalone ReID service
 * Simulates smart-notifier sending detection data
 */

const fs = require('fs');
const path = require('path');

const REID_SERVICE_URL = process.env.REID_SERVICE_URL || 'http://localhost:8765';

// Create a simple test image (1x1 white pixel JPEG)
const testImageBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==';

async function testReIDService() {
    console.log('🧪 Testing ReID Service...\n');

    // Test 1: Health check
    console.log('1. Health Check');
    try {
        const healthResponse = await fetch(`${REID_SERVICE_URL}/health`);
        const health = await healthResponse.json();
        console.log('   ✅ Service is healthy:', health);
    } catch (e) {
        console.error('   ❌ Health check failed:', e.message);
        return;
    }

    console.log('');

    // Test 2: Process detection
    console.log('2. Process Detection');
    const testData = {
        timestamp: Date.now(),
        detectionId: 'test-123',
        deviceId: 'test-camera-1',
        deviceName: 'Test Camera',
        detections: [
            {
                className: 'person',
                label: 'person',
                score: 0.95,
                boundingBox: [10, 10, 100, 200],  // x, y, w, h
                id: 'det-1'
            }
        ],
        image: testImageBase64
    };

    try {
        const startTime = Date.now();
        const response = await fetch(`${REID_SERVICE_URL}/process`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(testData)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        const duration = Date.now() - startTime;

        console.log(`   ✅ Detection processed in ${duration}ms`);
        console.log('   Result:', JSON.stringify(result, null, 2));

        if (result.detections && result.detections.length > 0) {
            const person = result.detections[0];
            console.log(`   Person ID: ${person.personId}`);
            console.log(`   Is New: ${person.isNew}`);
        }
    } catch (e) {
        console.error('   ❌ Process detection failed:', e.message);
    }

    console.log('\n✅ Test complete!');
}

testReIDService().catch(console.error);
