import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { listWins, listCoachNotes, listFollowUps, getRoadmap } from '@/lib/crm/records';
import { getMemberTimeline } from '@/lib/timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isNaN(id) ? null : id;
}

/**
 * GET /api/members/[id]/crm — one bootstrap request for the member profile's
 * CRM tab: roadmap, wins, coach notes, follow-ups, and the timeline.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await params).id);
    if (id == null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await ensureSchema();

    const [roadmap, wins, coachNotes, followUps, timeline] = await Promise.all([
      getRoadmap(id),
      listWins(id),
      listCoachNotes(id),
      listFollowUps(id),
      getMemberTimeline(id),
    ]);

    return NextResponse.json({ roadmap, wins, coachNotes, followUps, timeline });
  } catch (err) {
    log.error('members-crm', 'GET /api/members/[id]/crm failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load member CRM data' },
      { status: 500 }
    );
  }
}
