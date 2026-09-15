// 웹 푸시 알림용 서비스워커.
// push 이벤트를 받아 알림을 띄우고, 알림 클릭 시 해당 채팅방으로 이동/포커스한다.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || '새 메시지';
  const options = {
    body: data.body || '',
    data: { url: data.url || '/' },
    tag: data.tag,
    requireInteraction: false,
    icon: '/favicon.ico',
  };
  if (data.tag) options.renotify = true;

  // tag가 같으면(같은 대화방) showNotification이 알아서 이전 알림을 대체해주는 게
  // 표준 동작이지만, 브라우저/OS 조합에 따라 이 대체가 제대로 안 먹혀서 같은
  // 방 알림이 여러 개 계속 쌓이는 경우가 있다. 새로 띄우기 전에 같은 tag를 가진
  // 기존 알림을 직접 찾아 닫아서, 항상 방 하나당 알림 하나만 남도록 강제한다.
  event.waitUntil(
    (async () => {
      if (options.tag) {
        const existing = await self.registration.getNotifications({ tag: options.tag });
        existing.forEach((n) => n.close());
      }
      await self.registration.showNotification(title, options);
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  const tag = event.notification.tag;
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      // 알림을 눌러 들어가면 그 대화방을 확인한 것이므로, 폰 알림 목록에 남아있는
      // 같은 대화방(tag가 같은) 알림도 함께 지워서 "확인 안 한 메시지"처럼 계속
      // 남아있지 않게 한다. 다른 대화방 알림은 그대로 둔다.
      if (tag) {
        const sameRoom = await self.registration.getNotifications({ tag });
        sameRoom.forEach((n) => n.close());
      }

      const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = list.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })()
  );
});
