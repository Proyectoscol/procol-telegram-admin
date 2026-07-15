import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { applyList, getImportType } from '@/lib/import/listImport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/import/list — apply a pasted list. Body: { importType, text, fileName? } */
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const { importType, text, fileName } = await request.json();
    if (!getImportType(importType)) {
      return NextResponse.json({ error: `Unknown import type: ${importType}` }, { status: 400 });
    }
    if (typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    const summary = await applyList(importType, text, typeof fileName === 'string' && fileName ? fileName : 'pasted-list');
    return NextResponse.json(summary);
  } catch (err) {
    log.error('import-list', 'POST /api/import/list failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to apply import' },
      { status: 500 }
    );
  }
}
