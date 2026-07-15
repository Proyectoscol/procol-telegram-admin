import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { upsertRoadmap } from '@/lib/crm/records';

export const runtime = 'nodejs';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await ensureSchema();
    const body = await request.json();
    const roadmap = await upsertRoadmap(id, body);
    return NextResponse.json(roadmap);
  } catch (err) {
    log.error('members-roadmap', 'PUT /api/members/[id]/roadmap failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save roadmap' },
      { status: 500 }
    );
  }
}
