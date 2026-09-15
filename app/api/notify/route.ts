import webpush from 'web-push';
import { supabase } from '@/lib/supabase';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

type PushError = Error & {
  statusCode?: number;
  body?: string;
};

type RoomMember = {
  user_id: string;
};

type StoredSubscription = {
  id: string;
  endpoint: string;
  subscription: webpush.PushSubscription;
};

// POST { roomId, title, body, senderEndpoint? }
// Header: Authorization: Bearer <session.access_token>
//
// 같은 방(room_members)의 모든 계정이 등록한 기기에 웹 푸시 알림을 발송하되,
// 실제 메시지를 보낸 브라우저 endpoint만 제외한다. 같은 계정으로 로그인한 PC와
// iPhone을 함께 쓰는 경우에도 다른 기기에서는 알림을 받을 수 있어야 하기 때문이다.
// 채팅 자체와는 별개의 best-effort 기능이라 실패해도 항상 200을 반환한다.
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return Response.json({ error: '인증 토큰이 없습니다.' }, { status: 401 });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return Response.json({ error: '유효하지 않은 세션입니다.' }, { status: 401 });
    }
    const senderId = userData.user.id;

    const { roomId, title, body, senderEndpoint } = await request.json();
    if (!roomId) {
      return Response.json({ error: 'roomId가 필요합니다.' }, { status: 400 });
    }
    if (senderEndpoint !== undefined && typeof senderEndpoint !== 'string') {
      return Response.json({ error: 'senderEndpoint 형식이 올바르지 않습니다.' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // 발신자가 실제로 이 방의 멤버인지 확인 (아니면 다른 방에 알림을 흘려보낼 수 있음)
    const { data: senderMembership, error: membershipError } = await admin
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)
      .eq('user_id', senderId)
      .maybeSingle();

    if (membershipError) {
      console.error('[notify] 발신자 멤버십 조회 실패:', membershipError.message);
      return Response.json({ ok: false, error: '멤버십 조회 실패' }, { status: 200 });
    }
    if (!senderMembership) {
      return Response.json({ error: '이 방의 멤버가 아닙니다.' }, { status: 403 });
    }

    // 같은 방의 모든 멤버를 조회한다. 발신 계정 자체를 빼면 같은 계정으로 로그인한
    // 다른 PC/폰까지 함께 제외되므로, 구독 조회 단계에서 발신 endpoint만 제외한다.
    const { data: members, error: membersError } = await admin
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId);

    if (membersError) {
      console.error('[notify] 수신자 조회 실패:', membersError.message);
      return Response.json({ ok: false, error: '수신자 조회 실패' }, { status: 200 });
    }

    const recipientIds = [
      ...new Set(((members || []) as RoomMember[]).map((member) => member.user_id)),
    ];
    if (recipientIds.length === 0) {
      return Response.json({ ok: true, sent: 0 });
    }

    let subscriptionsQuery = admin
      .from('push_subscriptions')
      .select('id, endpoint, subscription')
      .in('user_id', recipientIds);

    if (senderEndpoint) {
      subscriptionsQuery = subscriptionsQuery.neq('endpoint', senderEndpoint);
    }

    const { data: subscriptions, error: subscriptionsError } = await subscriptionsQuery;

    if (subscriptionsError) {
      console.error('[notify] 구독 조회 실패:', subscriptionsError.message);
      return Response.json({ ok: false, error: '구독 조회 실패' }, { status: 200 });
    }
    if (!subscriptions || subscriptions.length === 0) {
      return Response.json({ ok: true, sent: 0 });
    }
    const storedSubscriptions = subscriptions as StoredSubscription[];

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      console.error('[notify] VAPID 키가 설정되어 있지 않습니다.');
      return Response.json({ ok: false, error: 'VAPID 키 미설정' }, { status: 200 });
    }
    webpush.setVapidDetails('mailto:placeholder@example.com', publicKey, privateKey);

    const payload = JSON.stringify({
      title: title || '새 메시지',
      body: body || '',
      url: `/room/${roomId}`,
      tag: `room-${roomId}`,
    });

    const staleIds: string[] = [];
    await Promise.all(
      storedSubscriptions.map(async (row) => {
        try {
          await webpush.sendNotification(row.subscription, payload);
        } catch (error: unknown) {
          const err = error as PushError;
          if (err.statusCode === 404 || err.statusCode === 410) {
            staleIds.push(row.id);
          } else {
            console.error('[notify] 발송 실패:', err.statusCode, err.body);
          }
        }
      })
    );

    if (staleIds.length > 0) {
      await admin.from('push_subscriptions').delete().in('id', staleIds);
    }

    return Response.json({ ok: true, sent: storedSubscriptions.length - staleIds.length });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[notify] 처리 중 오류:', err);
    // 알림은 best-effort이므로 실패해도 채팅 자체에 영향이 없도록 200으로 응답
    return Response.json({ ok: false, error: err.message || 'unknown error' }, { status: 200 });
  }
}
