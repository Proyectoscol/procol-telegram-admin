import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';
import { generateAndSavePersona } from '@/lib/ai/run-persona';
import { runPersonaSerial } from '@/lib/ai/persona-queue';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureSchema();
    const id = parseInt((await params).id, 10);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const { rows } = await pool.query(
      `SELECT * FROM contact_personas WHERE user_id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No persona generated yet' }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    log.error('persona', 'GET persona by-id failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load persona' },
      { status: 500 }
    );
  }
}

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
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const start = typeof body?.start === 'string' ? body.start : undefined;
    const end = typeof body?.end === 'string' ? body.end : undefined;
    const chatIds = Array.isArray(body?.chatIds) ? body.chatIds : undefined;
    const rangeLabel = typeof body?.rangeLabel === 'string' ? body.rangeLabel : undefined;

    const result = await runPersonaSerial(() =>
      generateAndSavePersona(id, { chatIds, start, end, rangeLabel })
    );

    return NextResponse.json({ persona: result.persona, usage: result.usage });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate persona';
    if (message.includes('OpenAI API key not configured')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes('OpenAI')) {
      return NextResponse.json({ error: message }, { status: 502 });
    }
    log.error('persona', 'POST persona by-id failed', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
