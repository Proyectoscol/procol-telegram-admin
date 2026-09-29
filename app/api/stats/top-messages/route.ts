import { NextRequest, NextResponse } from 'next/server';
import { get, set, cacheKey } from '@/lib/cache';
import { getCacheTtlStatsMinutes } from '@/lib/settings';
import { parseChatIds } from '@/lib/api/chat-params';
import { getTopLikedMessages, type TopMessage } from '@/lib/data/top-messages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const chatIds = parseChatIds(searchParams);
    const authorFromId = searchParams.get('authorFromId') ?? '';
    if (!start || !end) {
      return NextResponse.json({ error: 'start and end (ISO date) required' }, { status: 400 });
    }

    const key = cacheKey('top-messages', {
      start,
      end,
      chatIds: chatIds?.join(',') ?? 'all',
      authorFromId,
    });
    const cached = await get<{ messages: TopMessage[] }>(key);
    if (cached != null) return NextResponse.json(cached);

    const messages = await getTopLikedMessages({ chatIds, start, end, authorFromId: authorFromId || null });
    const body = { messages };
    const cacheTtlMs = (await getCacheTtlStatsMinutes()) * 60 * 1000;
    await set(key, body, cacheTtlMs);
    return NextResponse.json(body);
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('top-messages', 'Top messages failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch top messages' },
      { status: 500 }
    );
  }
}
