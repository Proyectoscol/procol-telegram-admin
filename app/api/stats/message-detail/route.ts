import { NextRequest, NextResponse } from 'next/server';
import { get, set, cacheKey } from '@/lib/cache';
import { getCacheTtlStatsMinutes } from '@/lib/settings';
import { getMessageDetail, type MessageDetail } from '@/lib/data/top-messages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const chatId = parseInt(searchParams.get('chatId') ?? '', 10);
    const messageId = parseInt(searchParams.get('messageId') ?? '', 10);
    if (!Number.isFinite(chatId) || !Number.isFinite(messageId)) {
      return NextResponse.json({ error: 'chatId and messageId (numbers) required' }, { status: 400 });
    }

    const key = cacheKey('message-detail', { chatId: String(chatId), messageId: String(messageId) });
    const cached = await get<MessageDetail>(key);
    if (cached != null) return NextResponse.json(cached);

    const detail = await getMessageDetail({ chatId, messageId });
    if (!detail) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }
    const cacheTtlMs = (await getCacheTtlStatsMinutes()) * 60 * 1000;
    await set(key, detail, cacheTtlMs);
    return NextResponse.json(detail);
  } catch (err) {
    const { log } = await import('@/lib/logger');
    log.error('message-detail', 'Message detail failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch message detail' },
      { status: 500 }
    );
  }
}
