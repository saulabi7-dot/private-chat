// 웹 푸시 알림용 서비스워커.
// push 이벤트를 받아 알림을 띄우고, 알림 클릭 시 해당 채팅방으로 이동/포커스한다.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  const title = data.title || '새 메시지';
  const options = {
    body: data.body || '',
    data: { url: data.url || '/' },
    tag: data.tag,
    icon: '/favicon.ico',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
