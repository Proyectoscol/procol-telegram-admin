import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { setFollowUpStatus } from '@/lib/crm/records';

export const runtime = 'nodejs';

const VALID_STATUSES = new Set(['OPEN', 'DONE', 'CANCELLED']);

/** PATCH /api/members/[id]/follow-ups/[followUpId] — mark done/cancelled/reopen. Body: { status } */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; followUpId: string }> }
) {
  try {
    const { id: idRaw, followUpId: followUpIdRaw } = await params;
    const id = parseInt(idRaw, 10);
    const followUpId = parseInt(followUpIdRaw, 10);
    if (Number.isNaN(id) || Number.isNaN(followUpId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const body = await request.json();
    const status = body?.status;
    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: 'status must be one of OPEN, DONE, CANCELLED' }, { status: 400 });
    }
    await ensureSchema();
    const followUp = await setFollowUpStatus(id, followUpId, status);
    if (!followUp) return NextResponse.json({ error: 'Follow-up not found' }, { status: 404 });
    return NextResponse.json(followUp);
  } catch (err) {
    log.error('members-follow-ups', 'PATCH /api/members/[id]/follow-ups/[followUpId] failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update follow-up' },
      { status: 500 }
    );
  }
}
