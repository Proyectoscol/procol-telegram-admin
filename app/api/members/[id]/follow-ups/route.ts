import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { createFollowUp } from '@/lib/crm/records';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await ensureSchema();
    const body = await request.json();
    const followUp = await createFollowUp(id, body);
    return NextResponse.json(followUp);
  } catch (err) {
    log.error('members-follow-ups', 'POST /api/members/[id]/follow-ups failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create follow-up' },
      { status: 500 }
    );
  }
}
