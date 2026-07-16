import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';
import { parseChatIds } from '@/lib/api/chat-params';

export const runtime = 'nodejs';

/**
 * GET user by internal id (for list-only users with from_id NULL).
 * Returns same shape as GET /api/users/[fromId]. Stats are 0 when from_id is NULL.
 * Optional searchParams: chatId or chatIds to restrict stats to those chats.
 */
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
    const chatIds = parseChatIds(request.nextUrl.searchParams);
    const userRes = await pool.query(
      `SELECT id, from_id, display_name, username, first_name, last_name, phone,
              is_premium, is_lifetime, telegram_premium, telegram_verified, telegram_fake, telegram_bot,
              telegram_status_type, telegram_bio, telegram_last_seen,
              assigned_to, notes, created_at, updated_at FROM users WHERE id = $1`,
      [id]
    );
    const user = userRes.rows[0];
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const fromId = user.from_id as string | null;
    let stats: Record<string, number | string | null> = {
      messagesSent: 0,
      serviceMessages: 0,
      totalActivity: 0,
      reactionsGiven: 0,
      reactionsReceived: 0,
      reactionsRatio: 0,
      totalWords: 0,
      totalChars: 0,
      activeDays: 0,
      photos: 0,
      videos: 0,
      messagesEdited: 0,
      replies: 0,
      topReactedToId: null,
      topReactedToName: null,
    };
    if (fromId) {
      const chatCond = chatIds && chatIds.length > 0 ? ' AND chat_id = ANY($2::bigint[])' : '';
      const statsRes = await pool.query(
        `SELECT
          (SELECT COUNT(*)::int FROM messages WHERE from_id = $1 AND type = 'message'${chatCond}) AS messages_sent,
          (SELECT COUNT(*)::int FROM messages WHERE actor_id = $1 AND type = 'service'${chatCond}) AS service_messages,
          (SELECT COUNT(*)::int FROM reactions WHERE reactor_from_id = $1${chatCond}) AS reactions_given,
          (SELECT COUNT(*)::int FROM messages m JOIN reactions r ON m.chat_id = r.chat_id AND m.message_id = r.message_id WHERE m.from_id = $1${chatIds && chatIds.length > 0 ? ' AND m.chat_id = ANY($2::bigint[])' : ''}) AS reactions_received,
          (SELECT COALESCE(SUM(LENGTH(COALESCE(text, ''))), 0)::bigint FROM messages WHERE from_id = $1 AND type = 'message'${chatCond}) AS total_chars,
          (SELECT COALESCE(SUM(GREATEST(0, LENGTH(TRIM(COALESCE(text, '')))::int - LENGTH(REPLACE(TRIM(COALESCE(text, '')), ' ', '')) + 1)), 0)::bigint FROM messages WHERE from_id = $1 AND type = 'message'${chatCond}) AS total_words,
          (SELECT COUNT(DISTINCT DATE(date))::int FROM messages WHERE from_id = $1 AND type = 'message'${chatCond}) AS active_days,
          (SELECT COUNT(*)::int FROM messages WHERE from_id = $1 AND media_type = 'photo'${chatCond}) AS photos,
          (SELECT COUNT(*)::int FROM messages WHERE from_id = $1 AND (media_type = 'video_file' OR media_type = 'video_message')${chatCond}) AS videos,
          (SELECT COUNT(*)::int FROM messages WHERE from_id = $1 AND edited_at IS NOT NULL${chatCond}) AS messages_edited,
          (SELECT COUNT(*)::int FROM messages WHERE from_id = $1 AND reply_to_message_id IS NOT NULL${chatCond}) AS replies
        `,
        chatIds && chatIds.length > 0 ? [fromId, chatIds] : [fromId]
      );
      const row = statsRes.rows[0] || {};
      const messagesSent = parseInt(String(row.messages_sent), 10) || 0;
      const serviceMessages = parseInt(String(row.service_messages), 10) || 0;
      const totalActivity = messagesSent + serviceMessages;
      const reactionsReceived = parseInt(String(row.reactions_received), 10) || 0;
      const reactionsRatio = totalActivity > 0 ? Math.round((reactionsReceived / totalActivity) * 100) / 100 : 0;
      const topReactedWhere = chatIds && chatIds.length > 0 ? ' AND r.chat_id = ANY($2::bigint[])' : '';
      const topReactedRes = await pool.query(
        `SELECT m.from_id AS reacted_to_id
         FROM reactions r
         JOIN messages m ON r.chat_id = m.chat_id AND r.message_id = m.message_id
         WHERE r.reactor_from_id = $1 AND m.from_id IS NOT NULL${topReactedWhere}
         GROUP BY m.from_id ORDER BY COUNT(*) DESC LIMIT 1`,
        chatIds && chatIds.length > 0 ? [fromId, chatIds] : [fromId]
      );
      let topReactedToId: string | null = topReactedRes.rows[0]?.reacted_to_id ?? null;
      let topReactedToName: string | null = null;
      if (topReactedToId) {
        const nameRes = await pool.query('SELECT display_name FROM users WHERE from_id = $1', [topReactedToId]);
        topReactedToName = nameRes.rows[0]?.display_name ?? topReactedToId;
      }
      stats = {
        messagesSent,
        serviceMessages,
        totalActivity,
        reactionsGiven: parseInt(String(row.reactions_given), 10) || 0,
        reactionsReceived,
        reactionsRatio,
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
    }
    const callsRes = await pool.query(
      'SELECT id, call_number, called_at, notes, objections, plans_discussed, created_by, created_at FROM contact_calls WHERE user_id = $1 ORDER BY call_number',
      [user.id]
    );
    return NextResponse.json({
      ...user,
      stats,
      calls: callsRes.rows,
    });
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('user-by-id', 'User by-id failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch user' },
      { status: 500 }
    );
  }
}

/** PATCH user by internal id (for list-only users without from_id). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureSchema();
    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const body = await request.json();
    const { is_premium, is_lifetime, assigned_to, notes } = body;
    const updates: string[] = [];
    const values: (string | number | boolean | null)[] = [];
    let idx = 1;
    if (typeof is_premium === 'boolean') {
      updates.push(`is_premium = $${idx++}`);
      values.push(is_premium);
      if (is_premium) updates.push(`premium_since = COALESCE(premium_since, NOW())`);
    }
    // Premium always cascades to Lifetime (one-directional) — turning Premium on
    // forces Lifetime on too, even if is_lifetime wasn't sent in this request.
    const effectiveLifetime = is_premium === true ? true : is_lifetime;
    if (typeof effectiveLifetime === 'boolean') {
      updates.push(`is_lifetime = $${idx++}`);
      values.push(effectiveLifetime);
      if (effectiveLifetime) updates.push(`lifetime_since = COALESCE(lifetime_since, NOW())`);
    }
    if (assigned_to !== undefined) {
      updates.push(`assigned_to = $${idx++}`);
      values.push(assigned_to);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${idx++}`);
      values.push(notes);
    }
    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }
    updates.push('updated_at = NOW()');
    values.push(id);
    await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );
    const u = await pool.query(
      'SELECT id, from_id, display_name, username, is_premium, is_lifetime, assigned_to, notes FROM users WHERE id = $1',
      [id]
    );
    return NextResponse.json(u.rows[0] || {});
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('user-by-id', 'User by-id patch failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update user' },
      { status: 500 }
    );
  }
}
