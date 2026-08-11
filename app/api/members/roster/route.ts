import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { getMemberRoster, type RosterRole } from '@/lib/data/memberLists';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/members/roster?role=main|premium — rows for the "Copy Main/Premium members" export modal. */
export async function GET(request: NextRequest) {
  try {
    const role = request.nextUrl.searchParams.get('role');
    if (role !== 'main' && role !== 'premium') {
      return NextResponse.json({ error: 'role must be "main" or "premium"' }, { status: 400 });
    }
    const rows = await getMemberRoster(role as RosterRole);
    return NextResponse.json({ rows });
  } catch (err) {
    log.error('members-roster', 'Failed to load roster', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load members' }, { status: 500 });
  }
}
