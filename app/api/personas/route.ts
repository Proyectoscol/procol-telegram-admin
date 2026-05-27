import { NextResponse } from 'next/server';
import { ensureSchema, queryWithRetry } from '@/lib/db/client';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureSchema();
    const { rows } = await queryWithRetry(`
      SELECT
        u.id,
        u.from_id,
        u.display_name,
        u.username,
        u.is_premium,
        u.profile_photo_urls,
        COALESCE(u.is_current_member, FALSE) AS is_current_member,
        cp.summary,
        cp.topics,
        cp.inferred_age_range,
        cp.inferred_occupation,
        cp.inferred_goals,
        cp.pain_points,
        cp.content_preferences,
        cp.run_at,
        COALESCE(cp.buying_intent_score, 0)  AS buying_intent_score,
        cp.buying_signals,
        cp.follow_up_priority,
        cp.engagement_level,
        cp.outreach_approach,
        cp.objection_patterns,
        cp.spending_capacity
      FROM users u
      INNER JOIN contact_personas cp ON cp.user_id = u.id
      ORDER BY COALESCE(cp.buying_intent_score, 0) DESC, u.display_name
    `);
    return NextResponse.json(rows);
  } catch (err) {
    log.error('personas', 'Personas list failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch personas' },
      { status: 500 }
    );
  }
}
