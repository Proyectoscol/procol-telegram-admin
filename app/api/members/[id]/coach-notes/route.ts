import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { createCoachNote } from '@/lib/crm/records';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await ensureSchema();
    const body = await request.json();
    const note = await createCoachNote(id, body);
    return NextResponse.json(note);
  } catch (err) {
    log.error('members-coach-notes', 'POST /api/members/[id]/coach-notes failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create coach note' },
      { status: 500 }
    );
  }
}
