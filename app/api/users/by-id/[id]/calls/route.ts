import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';
import { createContactCall } from '@/lib/crm/records';

export const runtime = 'nodejs';

/** POST a call for a user identified by internal id (for list-only users). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureSchema();
    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const userRes = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    const user = userRes.rows[0];
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const body = await request.json();
    const call = await createContactCall(id, body);
    return NextResponse.json(call);
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('user-by-id-calls', 'Create call by-id failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create call' },
      { status: 500 }
    );
  }
}
