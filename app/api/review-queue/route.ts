import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema, pool } from '@/lib/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReviewRow {
  id: number;
  import_type: string;
  reason: string;
  suggested_name: string | null;
  suggested_username: string | null;
  suggested_telegram_id: string | null;
  suggested_email: string | null;
  candidate_ids: number[] | null;
  status: string;
  created_at: string;
}

/** GET /api/review-queue?status=PENDING (default) — rows an admin needs to resolve. */
export async function GET(request: NextRequest) {
  try {
    await ensureSchema();
    const status = new URL(request.url).searchParams.get('status') ?? 'PENDING';
    const { rows } = await pool.query<ReviewRow>(
      `SELECT id, import_type, reason, suggested_name, suggested_username, suggested_telegram_id,
              suggested_email, candidate_ids, status, created_at
       FROM import_reviews WHERE status = $1 ORDER BY created_at DESC LIMIT 200`,
      [status]
    );

    const candidateIds = Array.from(new Set(rows.flatMap((r) => r.candidate_ids ?? [])));
    const candidateMap = new Map<number, { id: number; display_name: string | null; username: string | null }>();
    if (candidateIds.length > 0) {
      const { rows: candRows } = await pool.query(
        `SELECT id, display_name, username FROM users WHERE id = ANY($1::int[])`,
        [candidateIds]
      );
      for (const c of candRows) candidateMap.set(c.id, c);
    }

    const results = rows.map((r) => ({
      ...r,
      candidates: (r.candidate_ids ?? []).map((id) => candidateMap.get(id)).filter(Boolean),
    }));

    return NextResponse.json({ results });
  } catch (err) {
    log.error('review-queue', 'GET /api/review-queue failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load review queue' },
      { status: 500 }
    );
  }
}
