import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { resolveReviewRow, skipReviewRow } from '@/lib/import/reviewQueue';

export const runtime = 'nodejs';

/** PATCH /api/review-queue/[id] — { action: 'resolve', userId } or { action: 'skip' } */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await ensureSchema();
    const body = await request.json();

    if (body?.action === 'resolve') {
      const userId = Number(body.userId);
      if (!Number.isFinite(userId)) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
      await resolveReviewRow(id, userId);
      return NextResponse.json({ ok: true });
    }
    if (body?.action === 'skip') {
      await skipReviewRow(id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "action must be 'resolve' or 'skip'" }, { status: 400 });
  } catch (err) {
    log.error('review-queue', 'PATCH /api/review-queue/[id] failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update review row' },
      { status: 500 }
    );
  }
}
