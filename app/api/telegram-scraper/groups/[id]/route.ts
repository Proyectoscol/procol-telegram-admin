import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { setGroupRole, setGroupSyncChat, listGroups } from '@/lib/telegram-scraper/groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH /api/telegram-scraper/groups/[id] — { role?: 'main' | 'premium' | null, syncChat?: boolean }. Either field may be omitted. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid group id' }, { status: 400 });

    const body = await request.json();

    if ('role' in body) {
      const role = body.role === 'main' || body.role === 'premium' ? body.role : null;
      await setGroupRole(id, role);
    }
    if ('syncChat' in body) {
      await setGroupSyncChat(id, !!body.syncChat);
    }

    const groups = await listGroups();
    return NextResponse.json({ groups });
  } catch (err) {
    log.error('telegram-scraper', 'groups/[id] PATCH failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update group' }, { status: 500 });
  }
}
