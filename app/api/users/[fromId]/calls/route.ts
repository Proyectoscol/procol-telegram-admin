import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';
import { createContactCall } from '@/lib/crm/records';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fromId: string }> }
) {
  try {
    await ensureSchema();
    const fromId = decodeURIComponent((await params).fromId);
    const userRes = await pool.query('SELECT id FROM users WHERE from_id = $1', [fromId]);
    const user = userRes.rows[0];
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const body = await request.json();
    const call = await createContactCall(user.id, body);
    return NextResponse.json(call);
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('user-calls', 'Create call failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create call' },
      { status: 500 }
    );
  }
}
