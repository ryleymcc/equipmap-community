import { api } from './api';

/**
 * Converts a URL-safe base64 string to a Uint8Array for PushManager subscription.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Checks if Web Push Notifications are supported in the current browser.
 */
export function isPushNotificationSupported() {
  return typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
}

/**
 * Returns the current notification permission state ('granted', 'denied', or 'default').
 */
export function getNotificationPermission() {
  if (!isPushNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Gets or registers the active service worker registration for push.
 */
async function getServiceWorkerRegistration() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;

  try {
    let reg = await navigator.serviceWorker.getRegistration();
    if (reg && reg.active) return reg;

    // In DEV register /sw-push.js directly; in PROD register /sw.js
    const swScript = import.meta.env.DEV ? '/sw-push.js' : '/sw.js';
    try {
      reg = await navigator.serviceWorker.register(swScript, { scope: '/' });
    } catch {
      if (import.meta.env.DEV) {
        reg = await navigator.serviceWorker.register('/sw-push.js', { scope: '/' });
      }
    }

    if (!reg?.active) {
      reg = await navigator.serviceWorker.ready;
    }
    return reg;
  } catch (err) {
    console.warn('Failed to retrieve or register Service Worker for push:', err);
    try {
      return await navigator.serviceWorker.ready;
    } catch {
      return null;
    }
  }
}

/**
 * Subscribes the current device/browser to push notifications for the given userId.
 * Note: Does not require an active JWT session on the server.
 */
export async function subscribeUserToPush(userId) {
  if (!userId) {
    return { success: false, reason: 'no_user_id' };
  }

  if (!isPushNotificationSupported()) {
    return { success: false, reason: 'unsupported' };
  }

  try {
    // 1. Request permission if not already granted
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      return { success: false, reason: 'permission_denied' };
    }

    // 2. Get VAPID public key from backend
    const vapidRes = await api.get('/api/notifications/vapid-public-key');
    const { public_key } = vapidRes.data;

    if (!public_key) {
      throw new Error('VAPID public key not returned by backend');
    }

    const applicationServerKey = urlBase64ToUint8Array(public_key);

    // 3. Obtain Service Worker registration
    const registration = await getServiceWorkerRegistration();
    if (!registration) {
      return { success: false, reason: 'no_service_worker' };
    }

    // 4. Subscribe with PushManager
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      });
    }

    const subJson = subscription.toJSON();

    // 5. Send subscription to backend (no auth required)
    await api.post('/api/notifications/subscribe', {
      user_id: Number(userId),
      subscription: {
        endpoint: subJson.endpoint,
        keys: {
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth
        }
      }
    });

    return { success: true, subscription };
  } catch (error) {
    console.error('Error subscribing to push notifications:', error);
    return { success: false, reason: error.message || 'unknown_error' };
  }
}

/**
 * Unsubscribes the current device/browser from push notifications.
 * Called on explicit user sign out.
 */
export async function unsubscribeUserFromPush(userId) {
  if (!isPushNotificationSupported()) return { success: true };

  try {
    const registration = await getServiceWorkerRegistration();
    if (!registration) return { success: true };

    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      // 1. Notify backend to remove subscription
      try {
        await api.post('/api/notifications/unsubscribe', {
          endpoint: subscription.endpoint,
          user_id: userId ? Number(userId) : undefined
        });
      } catch (err) {
        console.warn('Failed to notify backend of push unsubscription:', err);
      }

      // 2. Unsubscribe browser pushManager
      await subscription.unsubscribe();
    }

    return { success: true };
  } catch (error) {
    console.error('Error unsubscribing from push notifications:', error);
    return { success: false, error };
  }
}

/**
 * Ensures the push subscription is kept in sync with the current user if permission is granted.
 */
export async function syncPushSubscription(userId) {
  if (!userId || !isPushNotificationSupported()) return;

  if (Notification.permission === 'granted') {
    try {
      const registration = await getServiceWorkerRegistration();
      if (!registration) return;

      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const subJson = subscription.toJSON();
        await api.post('/api/notifications/subscribe', {
          user_id: Number(userId),
          subscription: {
            endpoint: subJson.endpoint,
            keys: {
              p256dh: subJson.keys?.p256dh,
              auth: subJson.keys?.auth
            }
          }
        });
      } else {
        await subscribeUserToPush(userId);
      }
    } catch (err) {
      console.warn('Failed to sync push subscription:', err);
    }
  }
}

/**
 * Restore notifications only when the user has already granted permission.
 * - If permission is 'default', the user can opt in with the Enable button.
 * - If permission is 'granted', ensures the device is subscribed and registered in backend.
 * - If permission is 'denied', returns status indicating notifications are blocked in browser.
 */
export async function autoEnablePushNotifications(userId) {
  if (!userId || !isPushNotificationSupported()) {
    return { success: false, permission: 'unsupported' };
  }

  const permission = Notification.permission;

  if (permission === 'granted') {
    const res = await subscribeUserToPush(userId);
    return { ...res, permission: 'granted' };
  }

  return {
    success: false,
    permission,
    blocked: permission === 'denied'
  };
}
