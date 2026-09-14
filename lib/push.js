import { supabase } from '@/lib/supabase';

// 브라우저 쪽 웹 푸시 구독 관리 헬퍼 모음.
// 계정(user_id) 기준으로 push_subscriptions 테이블에 기기별(endpoint별) 구독을 저장한다.

export function isPushSupported() {
  if (typeof window === 'undefined') return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// VAPID 공개키(base64url 문자열)를 pushManager.subscribe가 요구하는 Uint8Array로 변환.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function getCurrentSubscription() {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/sw.js');
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export async function subscribeToPush(userId) {
  if (!isPushSupported()) {
    throw new Error('이 브라우저는 푸시 알림을 지원하지 않습니다.');
  }
  if (!userId) {
    throw new Error('로그인 후 이용해 주세요.');
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) {
    throw new Error('VAPID 공개키가 설정되어 있지 않습니다.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('알림 권한이 거부되었습니다.');
  }

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    [
      {
        user_id: userId,
        endpoint: subscription.endpoint,
        subscription: subscription.toJSON(),
      },
    ],
    { onConflict: 'endpoint' }
  );
  if (error) throw error;

  return subscription;
}

export async function unsubscribeFromPush(userId) {
  const subscription = await getCurrentSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();

  if (userId) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', userId);
  }
}
