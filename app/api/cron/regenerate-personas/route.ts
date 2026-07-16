import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { getStaleMemberIds } from '@/lib/ai/stale-personas';
import { generateAndSavePersona } from '@/lib/ai/run-persona';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 280;

// Real OpenAI spend per run — keep this bounded. Raise only if you've
// checked the cost per persona (Settings -> AI usage) and are fine with
// DAILY_CAP x that cost, every day.
const DAILY_CAP = 50;

/**
 * Scheduled: regenerate AI personas for members with no persona yet or new
 * activity since their last one. Capped at DAILY_CAP per run — sequential,
 * not parallel, to respect OpenAI rate limits. One failure doesn't stop
 * the rest of the batch.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const members = await getStaleMemberIds(DAILY_CAP);
    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const m of members) {
      try {
        await generateAndSavePersona(m.id);
        succeeded++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`${m.name ?? `member ${m.id}`}: ${msg}`);
        log.error('cron-regenerate-personas', `Persona failed for userId=${m.id}`, err);
      }
    }

    return NextResponse.json({ candidates: members.length, succeeded, failed, errors: errors.slice(0, 10) });
  } catch (err) {
    log.error('cron-regenerate-personas', 'Scheduled persona regeneration failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Persona regeneration failed' },
      { status: 500 }
    );
  }
}
