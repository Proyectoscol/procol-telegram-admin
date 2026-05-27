import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, pool } from '@/lib/db/client';
import { generateAndSavePersona } from '@/lib/ai/run-persona';
import { runPersonaSerial } from '@/lib/ai/persona-queue';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveUserIdFromFromId(fromId: string): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>('SELECT id FROM users WHERE from_id = $1', [fromId]);
  return rows.length > 0 ? rows[0].id : null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fromId: string }> }
) {
  try {
    await ensureSchema();
    const fromId = decodeURIComponent((await params).fromId);
    const userId = await resolveUserIdFromFromId(fromId);
    if (userId == null) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const { rows } = await pool.query(
      `SELECT * FROM contact_personas WHERE user_id = $1`,
      [userId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No persona generated yet' }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    log.error('persona', 'GET persona failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load persona' },
      { status: 500 }
    );
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ fromId: string }> }
) {
  try {
    await ensureSchema();
    const fromId = decodeURIComponent((await params).fromId);
    const userId = await resolveUserIdFromFromId(fromId);
    if (userId == null) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const body = await _request.json().catch(() => ({}));
    const start = typeof body?.start === 'string' ? body.start : undefined;
    const end = typeof body?.end === 'string' ? body.end : undefined;
    const chatIds = Array.isArray(body?.chatIds) ? body.chatIds : undefined;
    const rangeLabel = typeof body?.rangeLabel === 'string' ? body.rangeLabel : undefined;

    const result = await runPersonaSerial(() =>
      generateAndSavePersona(userId, { chatIds, start, end, rangeLabel })
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
    log.error('persona', 'POST persona failed', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
