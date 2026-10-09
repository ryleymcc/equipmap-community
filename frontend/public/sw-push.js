/* global clients */
// Push event handler for EquipMap Service Worker
self.addEventListener('push', (event) => {
  let data = {
    title: 'EquipMap',
    body: 'You have a new work order assignment.',
    url: '/work-orders'
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch {
      try {
        const text = event.data.text();
        if (text) data.body = text;
      } catch {
        // Fallback to default
      }
    }
  }

  const options = {
    body: data.body || 'You have a new work order assignment.',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: 'work-order-assignment-' + Date.now(),
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/work-orders',
      dateOfArrival: Date.now()
    },
    actions: [
      { action: 'open', title: 'Open EquipMap' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'EquipMap', options)
  );
});

// Notification click event handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetPath = (event.notification.data && event.notification.data.url) || '/work-orders';
  const fullTargetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If an existing window/PWA is open, navigate and focus it
      for (const client of clientList) {
        if (client.url && client.url.includes(self.location.origin) && 'focus' in client) {
          if ('navigate' in client) {
            client.navigate(fullTargetUrl);
          }
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(fullTargetUrl);
      }
    })
  );
});
