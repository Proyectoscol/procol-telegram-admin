import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { getChatsData } from '@/lib/data/chats';
import { getOverviewData } from '@/lib/data/overview';
import { getUsersSummaryData } from '@/lib/data/users-summary';
import { getTopMessagesDefaultAuthor } from '@/lib/data/top-messages';
import { withConcurrencyLimit } from '@/lib/concurrency';
import { parseChatIds } from '@/lib/api/chat-params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const BOOTSTRAP_DASHBOARD_CONCURRENCY = 2;

/**
 * GET /api/bootstrap/dashboard
 * Returns chats + overview (default day/all) + usersSummary in one sequential request.
 * Uses one DB connection at a time instead of 3 parallel connections,
 * which prevents pool exhaustion when multiple users open the Dashboard simultaneously.
 */
export async function GET(request: NextRequest) {
  return withConcurrencyLimit('api:bootstrap/dashboard', BOOTSTRAP_DASHBOARD_CONCURRENCY, async () => {
    const runId = `bootstrap-dashboard-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const { searchParams } = new URL(request.url);
      const chatIds = parseChatIds(searchParams);
      const fromId = searchParams.get('fromId');
      const groupBy = (searchParams.get('groupBy') as 'day' | 'week' | 'month') || 'day';
      const start = searchParams.get('start');
      const end = searchParams.get('end');
      // #region agent log
      fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId,hypothesisId:'H3',location:'app/api/bootstrap/dashboard/route.ts:28',message:'bootstrap/dashboard start',data:{groupBy,chatIdsCount:chatIds?.length ?? 0,hasFromId:!!fromId,hasStart:!!start,hasEnd:!!end},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      log.db(`[DBG-01a8b2 H3] ${runId} dashboard start groupBy=${groupBy} chatIds=${chatIds?.length ?? 0} fromId=${fromId ? '1' : '0'} start=${start ? '1' : '0'} end=${end ? '1' : '0'}`);
      const chats = await getChatsData();
      // #region agent log
      fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId,hypothesisId:'H3',location:'app/api/bootstrap/dashboard/route.ts:31',message:'bootstrap/dashboard chats done',data:{chatRows:Array.isArray(chats)?chats.length:null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      log.db(`[DBG-01a8b2 H3] ${runId} dashboard chats done rows=${Array.isArray(chats) ? chats.length : 'na'}`);
      const overview = await getOverviewData({ groupBy, chatIds, fromId, start, end });
      // #region agent log
      fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId,hypothesisId:'H3',location:'app/api/bootstrap/dashboard/route.ts:34',message:'bootstrap/dashboard overview done',data:{hasOverview:!!overview},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      log.db(`[DBG-01a8b2 H3] ${runId} dashboard overview done`);
      const usersSummary = await getUsersSummaryData(chatIds ?? undefined, start, end);
      // #region agent log
      fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId,hypothesisId:'H4',location:'app/api/bootstrap/dashboard/route.ts:37',message:'bootstrap/dashboard usersSummary done',data:{rows:Array.isArray(usersSummary)?usersSummary.length:null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      log.db(`[DBG-01a8b2 H4] ${runId} dashboard usersSummary done rows=${Array.isArray(usersSummary) ? usersSummary.length : 'na'}`);
      const topMessagesDefaultAuthor = await getTopMessagesDefaultAuthor();
      return NextResponse.json({ chats, overview, usersSummary, topMessagesDefaultAuthor });
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId,hypothesisId:'H2',location:'app/api/bootstrap/dashboard/route.ts:41',message:'bootstrap/dashboard error',data:{error:err instanceof Error ? err.message : 'unknown'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      log.db(`[DBG-01a8b2 H2] ${runId} dashboard error=${err instanceof Error ? err.message : 'unknown'}`);
      log.error('bootstrap/dashboard', 'GET bootstrap/dashboard failed', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to load dashboard bootstrap' },
        { status: 500 }
      );
    }
  });
}
