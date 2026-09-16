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

// POST { roomId, title, body }
// Header: Authorization: Bearer <session.access_token>
//
// 같은 방(room_members)의 멤버가 등록한 기기에 웹 푸시 알림을 발송하되, 발신
// "계정" 자신의 기기는 전부 제외한다(같은 계정으로 로그인한 PC/폰이 여러 대여도
// 내가 보낸 메시지 알림이 내 다른 기기로는 가지 않아야 하기 때문). 채팅 자체와는
// 별개의 best-effort 기능이라 실패해도 항상 200을 반환한다.
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

    const { roomId, title, body } = await request.json();
    if (!roomId) {
      return Response.json({ error: 'roomId가 필요합니다.' }, { status: 400 });
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

    // 같은 방의 멤버를 조회하고, 발신 계정(senderId) 자신은 수신자에서 제외한다 —
    // 이러면 발신 계정의 기기(구독)가 애초에 조회 대상에서 빠지므로, 어떤 기기로
    // 보냈든 같은 계정의 다른 기기 전부에 알림이 가지 않는다.
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
    ].filter((id) => id !== senderId);
    if (recipientIds.length === 0) {
      return Response.json({ ok: true, sent: 0 });
    }

    const { data: subscriptions, error: subscriptionsError } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, subscription')
      .in('user_id', recipientIds);

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
