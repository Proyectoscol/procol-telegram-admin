import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';
import { log } from '@/lib/logger';
import { parseMembersCSV } from '@/lib/import/parseMembersCSV';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/import/members-premium
 * Same CSV format as Group Members (username, user id, name, group id).
 * For each row that matches an existing user by from_id, sets is_premium = TRUE
 * and premium_since = COALESCE(premium_since, NOW()) — and, since Premium always
 * implies Lifetime, also sets is_lifetime = TRUE / lifetime_since.
 * Does not insert new users; does not set is_premium = FALSE for anyone.
 * Returns: { updated, total, durationMs, errors? }
 */
export async function POST(request: NextRequest) {
  const t0 = Date.now();
  try {
    await ensureSchema();
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      return NextResponse.json({ error: 'File must be a .csv' }, { status: 400 });
    }

    const text = await file.text();
    const { rows, errors: parseErrors } = parseMembersCSV(text);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No valid rows found in CSV', parseErrors },
        { status: 400 }
      );
    }

    log.startup(`[members-premium-import] ▶ Starting — ${rows.length} rows from ${file.name}`);

    const fromIds: string[] = [];
    const seen: Record<string, boolean> = {};
    for (let i = 0; i < rows.length; i++) {
      const id = rows[i].fromId;
      if (!seen[id]) {
        seen[id] = true;
        fromIds.push(id);
      }
    }

    // Premium always cascades to Lifetime — it's a distinct product Premium members
    // are also granted, but holding Lifetime alone doesn't grant Premium.
    const result = await pool.query(
      `UPDATE users
       SET is_premium = TRUE,
           premium_since = COALESCE(premium_since, NOW()),
           is_lifetime = TRUE,
           lifetime_since = COALESCE(lifetime_since, NOW()),
           updated_at = NOW()
       WHERE from_id = ANY($1::text[])`,
      [fromIds]
    );

    const updated = result.rowCount ?? 0;
    const durationMs = Date.now() - t0;

    log.startup(`[members-premium-import] 🏁 Done — ${durationMs}ms | updated=${updated} | total rows in CSV=${rows.length}`);

    return NextResponse.json({
      updated,
      total: rows.length,
      durationMs,
      errors: parseErrors.length > 0 ? parseErrors.slice(0, 50) : undefined,
      errorCount: parseErrors.length,
    });
  } catch (err) {
    log.error('members-premium-import', 'Members premium import failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 500 }
    );
  }
}
