/**
 * Firebase Cloud Messaging (FCM) Service
 * Sends push notifications to mobile devices
 * 
 * SETUP REQUIRED:
 * 1. Create a Firebase project at https://console.firebase.google.com
 * 2. Go to Project Settings > Service Accounts
 * 3. Generate a new private key (JSON file)
 * 4. Save the JSON content in .env as FIREBASE_SERVICE_ACCOUNT (stringified)
 *    OR save the file and reference it via GOOGLE_APPLICATION_CREDENTIALS
 */

import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

let fcmInitialized = false;

/**
 * Initialize Firebase Admin SDK
 */
export const initializeFCM = () => {
    try {
        if (fcmInitialized) {
            console.log('✅ [FCM] Already initialized');
            return true;
        }

        // Check for service account credentials
        const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

        if (serviceAccountJson) {
            const serviceAccount = JSON.parse(serviceAccountJson);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            fcmInitialized = true;
            console.log('✅ [FCM] Firebase Admin SDK initialized from env');
            return true;
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            admin.initializeApp({
                credential: admin.credential.applicationDefault()
            });
            fcmInitialized = true;
            console.log('✅ [FCM] Firebase Admin SDK initialized from credentials file');
            return true;
        } else {
            console.log('⚠️ [FCM] No Firebase credentials found. FCM disabled.');
            console.log('⚠️ [FCM] Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS');
            return false;
        }
    } catch (error) {
        console.error('❌ [FCM] Initialization error:', error.message);
        return false;
    }
};

/**
 * Send FCM notification to a single device
 * @param {string} fcmToken - Device FCM token
 * @param {Object} notification - Notification data
 * @param {string} notification.title - Notification title
 * @param {string} notification.body - Notification body
 * @param {Object} data - Additional data payload
 */
export const sendFCMToDevice = async (fcmToken, notification, data = {}) => {
    if (!fcmInitialized) {
        console.log('⚠️ [FCM] Not initialized, skipping notification');
        return null;
    }

    if (!fcmToken) {
        console.log('⚠️ [FCM] No FCM token provided');
        return null;
    }

    try {
        const message = {
            token: fcmToken,
            notification: {
                title: notification.title,
                body: notification.body,
            },
            data: {
                ...data,
                title: notification.title,
                message: notification.body,
                timestamp: new Date().toISOString(),
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'hr_crm_notifications',
                    priority: 'max',
                    defaultSound: true,
                    defaultVibrateTimings: true,
                },
            },
            apns: {
                payload: {
                    aps: {
                        alert: {
                            title: notification.title,
                            body: notification.body,
                        },
                        sound: 'default',
                        badge: 1,
                    },
                },
            },
        };

        const response = await admin.messaging().send(message);
        console.log('✅ [FCM] Notification sent:', response);
        return response;
    } catch (error) {
        console.error('❌ [FCM] Send error:', error.message);

        // Handle invalid tokens
        if (error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered') {
            console.log('⚠️ [FCM] Invalid token, should be removed from database');
            return { error: 'invalid_token', token: fcmToken };
        }

        return null;
    }
};

/**
 * Send FCM notification to multiple devices
 * @param {string[]} fcmTokens - Array of FCM tokens
 * @param {Object} notification - Notification data
 * @param {Object} data - Additional data payload
 */
export const sendFCMToMultipleDevices = async (fcmTokens, notification, data = {}) => {
    if (!fcmInitialized) {
        console.log('⚠️ [FCM] Not initialized, skipping notification');
        return null;
    }

    const validTokens = fcmTokens.filter(token => token && token.length > 0);
    if (validTokens.length === 0) {
        console.log('⚠️ [FCM] No valid tokens provided');
        return null;
    }

    try {
        const message = {
            tokens: validTokens,
            notification: {
                title: notification.title,
                body: notification.body,
            },
            data: {
                ...data,
                title: notification.title,
                message: notification.body,
                timestamp: new Date().toISOString(),
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'hr_crm_notifications',
                    priority: 'max',
                    defaultSound: true,
                    defaultVibrateTimings: true,
                },
            },
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`✅ [FCM] Sent to ${response.successCount}/${validTokens.length} devices`);

        // Log failed tokens
        if (response.failureCount > 0) {
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    console.log(`⚠️ [FCM] Failed for token ${idx}: ${resp.error?.message}`);
                }
            });
        }

        return response;
    } catch (error) {
        console.error('❌ [FCM] Multicast error:', error.message);
        return null;
    }
};

/**
 * Send FCM notification to a topic
 * @param {string} topic - Topic name (e.g., 'all_users', 'department_hr')
 * @param {Object} notification - Notification data
 * @param {Object} data - Additional data payload
 */
export const sendFCMToTopic = async (topic, notification, data = {}) => {
    if (!fcmInitialized) {
        console.log('⚠️ [FCM] Not initialized, skipping notification');
        return null;
    }

    try {
        const message = {
            topic: topic,
            notification: {
                title: notification.title,
                body: notification.body,
            },
            data: {
                ...data,
                title: notification.title,
                message: notification.body,
                timestamp: new Date().toISOString(),
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'hr_crm_notifications',
                    priority: 'max',
                    defaultSound: true,
                    defaultVibrateTimings: true,
                },
            },
        };

        const response = await admin.messaging().send(message);
        console.log(`✅ [FCM] Sent to topic "${topic}":`, response);
        return response;
    } catch (error) {
        console.error('❌ [FCM] Topic send error:', error.message);
        return null;
    }
};

export default {
    initializeFCM,
    sendFCMToDevice,
    sendFCMToMultipleDevices,
    sendFCMToTopic,
};
