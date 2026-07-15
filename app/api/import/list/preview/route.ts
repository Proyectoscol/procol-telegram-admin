import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { ensureSchema } from '@/lib/db/client';
import { previewList, getImportType } from '@/lib/import/listImport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/import/list/preview — dry run of a pasted list. Body: { importType, text } */
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const { importType, text } = await request.json();
    if (!getImportType(importType)) {
      return NextResponse.json({ error: `Unknown import type: ${importType}` }, { status: 400 });
    }
    if (typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    const preview = await previewList(importType, text);
    return NextResponse.json(preview);
  } catch (err) {
    log.error('import-list-preview', 'POST /api/import/list/preview failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to preview import' },
      { status: 500 }
    );
  }
}
