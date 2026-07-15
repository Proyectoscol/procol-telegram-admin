import { pool } from '@/lib/db/client';

export type MemberEventType =
  | 'JOINED'
  | 'WIN'
  | 'COACH_CALL'
  | 'SALES_CALL'
  | 'FOLLOW_UP'
  | 'ROADMAP_CHANGE'
  | 'PURCHASE'
  | 'COURSE_PROGRESS'
  | 'IMPORT'
  | 'BOT_NOTE'
  | 'OTHER';

export interface LogMemberEventOptions {
  description?: string | null;
  occurredAt?: Date | string | null;
  source?: string | null;
  metadata?: Record<string, unknown>;
}

/** Append one row to the member's timeline. Never throws for the caller — logs and swallows. */
export async function logMemberEvent(
  userId: number,
  eventType: MemberEventType,
  title: string,
  options?: LogMemberEventOptions
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO member_events (user_id, event_type, title, description, occurred_at, source, metadata)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), $6, $7::jsonb)`,
      [
        userId,
        eventType,
        title,
        options?.description ?? null,
        options?.occurredAt ?? null,
        options?.source ?? null,
        JSON.stringify(options?.metadata ?? {}),
      ]
    );
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('timeline', `logMemberEvent failed for user ${userId} (${eventType})`, err);
  }
}

export interface MemberEventRow {
  id: number;
  event_type: MemberEventType;
  title: string;
  description: string | null;
  occurred_at: string;
  source: string | null;
  metadata: Record<string, unknown>;
}

/** The member's timeline, newest first. */
export async function getMemberTimeline(userId: number, limit = 100): Promise<MemberEventRow[]> {
  const { rows } = await pool.query<MemberEventRow>(
    `SELECT id, event_type, title, description, occurred_at, source, metadata
     FROM member_events WHERE user_id = $1 ORDER BY occurred_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}
