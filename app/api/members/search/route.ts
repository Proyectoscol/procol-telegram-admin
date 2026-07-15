import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema, pool } from '@/lib/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/members/search?q=... — find members by name/username/email, for resolving review-queue rows. */
export async function GET(request: NextRequest) {
  try {
    await ensureSchema();
    const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
    if (q.length < 2) return NextResponse.json({ results: [] });
    const like = `%${q}%`;
    const { rows } = await pool.query(
      `SELECT id, display_name, username, from_id, email
       FROM users
       WHERE display_name ILIKE $1 OR username ILIKE $1 OR email ILIKE $1
       ORDER BY display_name ASC NULLS LAST
       LIMIT 20`,
      [like]
    );
    return NextResponse.json({ results: rows });
  } catch (err) {
    log.error('members-search', 'GET /api/members/search failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Search failed' },
      { status: 500 }
    );
  }
}
