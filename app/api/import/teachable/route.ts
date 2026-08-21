import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { applyTeachable } from '@/lib/import/teachableImport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/import/teachable — multipart file (CSV), apply. */
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    const text = await file.text();
    const summary = await applyTeachable(text, file.name);
    return NextResponse.json(summary);
  } catch (err) {
    log.error('import-teachable', 'POST /api/import/teachable failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to apply Teachable import' },
      { status: 500 }
    );
  }
}
