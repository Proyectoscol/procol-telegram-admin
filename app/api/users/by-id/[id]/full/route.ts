/**
 * GET /api/users/by-id/[id]/full
 *
 * Same as /api/users/[fromId]/full but looks up user by internal numeric id.
 * Used for list-only users whose from_id may be NULL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool, queryWithRetry } from '@/lib/db/client';
import { parseChatIds } from '@/lib/api/chat-params';
import { getUserTimeSeries, getChatsCached, getLabelsCached } from '@/lib/db/user-full';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureSchema();
    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const { searchParams } = request.nextUrl;
    const chatIds = parseChatIds(searchParams);
    const groupBy = (searchParams.get('groupBy') as 'day' | 'week' | 'month') || 'day';
    const start = searchParams.get('start') || null;
    const end = searchParams.get('end') || null;
    const hasRange = start != null && start !== '' && end != null && end !== '';

    // 1. User lookup
    const userRes = await queryWithRetry(
      `SELECT id, from_id, display_name, username, first_name, last_name, phone,
              is_premium, telegram_premium, telegram_verified, telegram_fake, telegram_bot,
              telegram_status_type, telegram_bio, telegram_last_seen,
              assigned_to, notes, created_at, updated_at, profile_photo_urls FROM users WHERE id = $1`,
      [id]
    );
    const user = userRes.rows[0];
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const fromId = user.from_id as string | null;

    let userStats: Record<string, number | string | null> = {
      messagesSent: 0, serviceMessages: 0, totalActivity: 0,
      reactionsGiven: 0, reactionsReceived: 0, reactionsRatio: 0,
      totalWords: 0, totalChars: 0, activeDays: 0,
      photos: 0, videos: 0, messagesEdited: 0, replies: 0,
      topReactedToId: null, topReactedToName: null,
    };
    let timeSeries = { messagesOverTime: [] as { period: string; count: number }[], reactionsOverTime: [] as { period: string; count: number }[] };

    let recentMessages: Record<string, unknown>[] = [];
    let reactionsGiven: Record<string, unknown>[] = [];

    if (fromId) {
      const chatCond = chatIds && chatIds.length > 0 ? ' AND chat_id = ANY($2::bigint[])' : '';
      const statsParams: (string | number[])[] = [fromId];
      if (chatIds && chatIds.length > 0) statsParams.push(chatIds);
      if (hasRange) {
        statsParams.push(start!);
        statsParams.push(end!);
      }
      const dateCondMsg = hasRange ? (chatIds && chatIds.length > 0 ? ' AND date >= $3::timestamptz AND date <= $4::timestamptz' : ' AND date >= $2::timestamptz AND date <= $3::timestamptz') : '';
      const dateCondRxn = hasRange ? (chatIds && chatIds.length > 0 ? ' AND reacted_at >= $3::timestamptz AND reacted_at <= $4::timestamptz' : ' AND reacted_at >= $2::timestamptz AND reacted_at <= $3::timestamptz') : '';
      const dateCondM = hasRange ? (chatIds && chatIds.length > 0 ? ' AND m.date >= $3::timestamptz AND m.date <= $4::timestamptz' : ' AND m.date >= $2::timestamptz AND m.date <= $3::timestamptz') : '';
      const dateCondR = hasRange ? (chatIds && chatIds.length > 0 ? ' AND r.reacted_at >= $3::timestamptz AND r.reacted_at <= $4::timestamptz' : ' AND r.reacted_at >= $2::timestamptz AND r.reacted_at <= $3::timestamptz') : '';
      const chatCondM = chatIds && chatIds.length > 0 ? ' AND m.chat_id = ANY($2::bigint[])' : '';
      const chatCondR = chatIds && chatIds.length > 0 ? ' AND r.chat_id = ANY($2::bigint[])' : '';

      const [statsRes, topReactedRes, tsResult, recentMsgsRes, reactionsGivenRes] = await Promise.all([
        queryWithRetry(
          `SELECT
            (SELECT COUNT(*)::int FROM messages WHERE from_id = $1 AND type = 'message'${chatCond}${dateCondMsg}) AS messages_sent,
            (SELECT COUNT(*)::int FROM messages WHERE actor_id = $1 AND type = 'service'${chatCond}${dateCondMsg}) AS service_messages,
            (SELECT COUNT(*)::int FROM reactions WHERE reactor_from_id = $1${chatCond}${dateCondRxn.replace('r.reacted_at', 'reacted_at')}) AS reactions_given,
            (SELECT COUNT(*)::int FROM messages m JOIN reactions r ON m.chat_id = r.chat_id AND m.message_id = r.message_id WHERE m.from_id = $1${chatIds && chatIds.length > 0 ? ' AND m.chat_id = ANY($2::bigint[])' : ''}${dateCondM}) AS reactions_received,
            (SELECT COALESCE(SUM(LENGTH(COALESCE(text, ''))), 0)::bigint FROM messages WHERE from_id = $1 AND type = 'message'${chatCond}${dateCondMsg}) AS total_chars,
            (SELECT COALESCE(SUM(GREATEST(0, LENGTH(TRIM(COALESCE(text, '')))::int - LENGTH(REPLACE(TRIM(COALESCE(text, '')), ' ', '')) + 1)), 0)::bigint FROM messages WHERE from_id = $1 AND type = 'message'${chatCond}${dateCondMsg}) AS total_words,
            (SELECT COUNT(DISTINCT DATE(date))::int FROM messages WHERE from_id = $1 AND type = 'message'${chatCond}${dateCondMsg}) AS active_days,
            (SELECT COUNT(*)::int FROM messages WHERE from_id = $1 AND media_type = 'photo'${chatCond}${dateCondMsg}) AS photos,
            (SELECT COUNT(*)::int FROM messages WHERE from_id = $1 AND (media_type = 'video_file' OR media_type = 'video_message')${chatCond}${dateCondMsg}) AS videos,
            (SELECT COUNT(*)::int FROM messages WHERE from_id = $1 AND edited_at IS NOT NULL${chatCond}${dateCondMsg}) AS messages_edited,
            (SELECT COUNT(*)::int FROM messages WHERE from_id = $1 AND reply_to_message_id IS NOT NULL${chatCond}${dateCondMsg}) AS replies`,
          statsParams
        ),
        queryWithRetry(
          `SELECT m.from_id AS reacted_to_id
           FROM reactions r
           JOIN messages m ON r.chat_id = m.chat_id AND r.message_id = m.message_id
           WHERE r.reactor_from_id = $1 AND m.from_id IS NOT NULL${chatIds && chatIds.length > 0 ? ' AND r.chat_id = ANY($2::bigint[])' : ''}${dateCondR}
           GROUP BY m.from_id ORDER BY COUNT(*) DESC LIMIT 1`,
          statsParams
        ),
        getUserTimeSeries(fromId, chatIds ?? null, groupBy, start ?? null, end ?? null),
        queryWithRetry(
          `SELECT m.chat_id, c.name AS chat_name, c.slug AS chat_slug,
                  m.message_id, m.date, m.text, m.reply_to_message_id, m.edited_at, m.media_type
           FROM messages m
           LEFT JOIN chats c ON c.id = m.chat_id
           WHERE m.from_id = $1 AND m.type = 'message'${chatCondM}${dateCondM}
           ORDER BY m.date DESC LIMIT 15`,
          statsParams
        ),
        queryWithRetry(
          `SELECT r.chat_id, c.name AS chat_name, c.slug AS chat_slug,
                  m.from_id AS receiver_from_id, u.display_name AS receiver_name, COUNT(*)::int AS count
           FROM reactions r
           JOIN messages m ON r.chat_id = m.chat_id AND r.message_id = m.message_id
           LEFT JOIN users u ON u.from_id = m.from_id
           LEFT JOIN chats c ON c.id = r.chat_id
           WHERE r.reactor_from_id = $1${chatCondR}${dateCondR}
           GROUP BY r.chat_id, c.name, c.slug, m.from_id, u.display_name
           ORDER BY r.chat_id, count DESC`,
          statsParams
        ),
      ]);

      const row = statsRes.rows[0] || {};
      const messagesSent = parseInt(String(row.messages_sent), 10) || 0;
      const serviceMessages = parseInt(String(row.service_messages), 10) || 0;
      const totalActivity = messagesSent + serviceMessages;
      const reactionsReceived = parseInt(String(row.reactions_received), 10) || 0;
      const reactionsRatio = totalActivity > 0 ? Math.round((reactionsReceived / totalActivity) * 100) / 100 : 0;

      let topReactedToId: string | null = topReactedRes.rows[0]?.reacted_to_id ?? null;
      let topReactedToName: string | null = null;
      if (topReactedToId) {
        const nameRes = await queryWithRetry('SELECT display_name FROM users WHERE from_id = $1', [topReactedToId]);
        topReactedToName = nameRes.rows[0]?.display_name ?? topReactedToId;
      }

      userStats = {
        messagesSent, serviceMessages, totalActivity,
        reactionsGiven: parseInt(String(row.reactions_given), 10) || 0,
        reactionsReceived, reactionsRatio,
        totalWords: parseInt(String(row.total_words), 10) || 0,
        totalChars: parseInt(String(row.total_chars), 10) || 0,
        activeDays: parseInt(String(row.active_days), 10) || 0,
        photos: parseInt(String(row.photos), 10) || 0,
        videos: parseInt(String(row.videos), 10) || 0,
        messagesEdited: parseInt(String(row.messages_edited), 10) || 0,
        replies: parseInt(String(row.replies), 10) || 0,
        topReactedToId,
        topReactedToName,
      };
      timeSeries = tsResult;
      recentMessages = recentMsgsRes.rows.map((r: Record<string, unknown>) => ({
        chat_id: r.chat_id, chat_name: r.chat_name ?? null, chat_slug: r.chat_slug ?? null,
        message_id: r.message_id, date: r.date, text: r.text,
        reply_to_message_id: r.reply_to_message_id, edited_at: r.edited_at, media_type: r.media_type,
      }));
      reactionsGiven = reactionsGivenRes.rows.map((r: Record<string, unknown>) => ({
        chatId: r.chat_id, chatName: r.chat_name ?? null, chatSlug: r.chat_slug ?? null,
        receiverFromId: r.receiver_from_id, receiverName: r.receiver_name, count: r.count,
      }));
    }

    const callsRes = await queryWithRetry(
      `SELECT id, call_number, called_at, notes, objections, plans_discussed, current_situation,
              next_step, offer_discussed, likelihood, follow_up_date, created_by, created_at
       FROM contact_calls WHERE user_id = $1 ORDER BY called_at DESC NULLS LAST, created_at DESC`,
      [user.id]
    );

    const [chats, labels] = await Promise.all([getChatsCached(), getLabelsCached()]);

    return NextResponse.json({
      user: { ...user, stats: userStats, calls: callsRes.rows },
      timeSeries,
      chats,
      labels,
      recentMessages,
      reactionsGiven,
    });
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('user-by-id-full', 'User by-id full endpoint failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch user data' },
      { status: 500 }
    );
  }
}
