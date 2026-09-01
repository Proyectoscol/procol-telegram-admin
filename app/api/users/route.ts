import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, queryWithRetry } from '@/lib/db/client';
import { getOrFetch, cacheKey } from '@/lib/cache';
import { getCacheTtlStatsMinutes } from '@/lib/settings';
import { parseChatIds } from '@/lib/api/chat-params';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USERS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export async function GET(request: NextRequest) {
  const runId = `users-list-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const { searchParams } = new URL(request.url);
    const isPremium = searchParams.get('is_premium') ?? '';
    const assignedTo = searchParams.get('assigned_to') ?? '';
    const chatIds = parseChatIds(searchParams);
    // #region agent log
    fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId,hypothesisId:'H6',location:'app/api/users/route.ts:18',message:'users route start',data:{isPremium,hasAssignedTo:assignedTo !== '',chatIdsCount:chatIds?.length ?? 0},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    log.db(`[DBG-01a8b2 H6] ${runId} users start premium=${isPremium || 'all'} assigned=${assignedTo ? '1' : '0'} chatIds=${chatIds?.length ?? 0}`);
    const key = cacheKey('users-list', {
      is_premium: isPremium,
      assigned_to: assignedTo,
      chatIds: chatIds?.join(',') ?? 'all',
    });
    // #region agent log
    fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId,hypothesisId:'H6',location:'app/api/users/route.ts:25',message:'users before getCacheTtlStatsMinutes',data:{key},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    log.db(`[DBG-01a8b2 H6] ${runId} users before ttl key=${key}`);
    const cacheTtlMs = Math.min((await getCacheTtlStatsMinutes()) * 60 * 1000, USERS_CACHE_TTL_MS);
    // #region agent log
    fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId,hypothesisId:'H6',location:'app/api/users/route.ts:28',message:'users after getCacheTtlStatsMinutes',data:{cacheTtlMs},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    log.db(`[DBG-01a8b2 H6] ${runId} users after ttl cacheTtlMs=${cacheTtlMs}`);
    const rows = await getOrFetch<unknown[]>(key, async () => {
      // #region agent log
      fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId,hypothesisId:'H7',location:'app/api/users/route.ts:31',message:'users fetcher start',data:{key},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      log.db(`[DBG-01a8b2 H7] ${runId} users fetcher start key=${key}`);
      await ensureSchema();

      const conditions: string[] = ['1=1'];
      const params: (string | number | number[])[] = [];
      let idx = 1;
      if (isPremium === 'true') {
        conditions.push('u.is_premium = true');
      } else if (isPremium === 'false') {
        conditions.push('u.is_premium = false');
      }
      if (assignedTo != null && assignedTo !== '') {
        params.push(assignedTo);
        conditions.push(`u.assigned_to = $${idx++}`);
      }
      if (chatIds && chatIds.length > 0) {
        params.push(chatIds);
        idx++;
      }

      const where = conditions.join(' AND ');
      const chatParamIdx = params.length;
      const mChatFilter = chatIds && chatIds.length > 0 ? ` AND m.chat_id = ANY($${chatParamIdx}::bigint[])` : '';
      const rChatFilter = chatIds && chatIds.length > 0 ? ` AND r.chat_id = ANY($${chatParamIdx}::bigint[])` : '';

      const query = `
        WITH last_activity AS (
          SELECT from_id, MAX(date) AS last_date
          FROM messages m
          WHERE from_id IS NOT NULL ${mChatFilter}
          GROUP BY from_id
        ),
        msg_counts AS (
          SELECT from_id, COUNT(*)::int AS messages_sent
          FROM messages m
          WHERE m.type = 'message' AND m.from_id IS NOT NULL ${mChatFilter}
          GROUP BY from_id
        ),
        reactions_given AS (
          SELECT reactor_from_id AS from_id, COUNT(*)::int AS reactions_given
          FROM reactions r
          WHERE 1=1 ${rChatFilter}
          GROUP BY reactor_from_id
        ),
        reactions_received AS (
          SELECT m.from_id, COUNT(*)::int AS reactions_received
          FROM reactions r
          JOIN messages m ON m.chat_id = r.chat_id AND m.message_id = r.message_id
          WHERE m.from_id IS NOT NULL ${mChatFilter}
          GROUP BY m.from_id
        )
        SELECT u.id, u.from_id, u.display_name, u.username, u.is_premium,
               u.profile_photo_urls,
               COALESCE(u.is_current_member, FALSE) AS is_current_member,
               la.last_date AS last_activity,
               COALESCE(mc.messages_sent, 0) AS messages_sent,
               COALESCE(rr.reactions_received, 0) AS reactions_received,
               COALESCE(rg.reactions_given, 0) AS reactions_given,
               (cp.user_id IS NOT NULL) AS has_persona,
               (cpi.user_id IS NOT NULL) AS has_custom_plan_intake,
               (crs.user_id IS NOT NULL) AS has_course_progress
        FROM users u
        LEFT JOIN last_activity la ON la.from_id = u.from_id
        LEFT JOIN msg_counts mc ON mc.from_id = u.from_id
        LEFT JOIN reactions_received rr ON rr.from_id = u.from_id
        LEFT JOIN reactions_given rg ON rg.from_id = u.from_id
        LEFT JOIN contact_personas cp ON cp.user_id = u.id
        LEFT JOIN custom_plan_intake_responses cpi ON cpi.user_id = u.id
        LEFT JOIN (SELECT DISTINCT user_id FROM course_progress) crs ON crs.user_id = u.id
        WHERE ${where}
        ORDER BY COALESCE(u.is_current_member, FALSE) DESC, la.last_date DESC NULLS LAST, u.display_name
      `;
      const { rows: fetchedRows } = await queryWithRetry(query, params);
      // #region agent log
      fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId,hypothesisId:'H7',location:'app/api/users/route.ts:102',message:'users query done',data:{rows:Array.isArray(fetchedRows)?fetchedRows.length:null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      log.db(`[DBG-01a8b2 H7] ${runId} users query done rows=${Array.isArray(fetchedRows) ? fetchedRows.length : 'na'}`);
      return fetchedRows;
    }, cacheTtlMs);
    return NextResponse.json(rows);
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7925/ingest/ac1c021b-cf07-40d1-a3a2-60935c2d0072',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'01a8b2'},body:JSON.stringify({sessionId:'01a8b2',runId,hypothesisId:'H6',location:'app/api/users/route.ts:108',message:'users route error',data:{error:err instanceof Error ? err.message : 'unknown'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    log.db(`[DBG-01a8b2 H6] ${runId} users error=${err instanceof Error ? err.message : 'unknown'}`);
    log.error('users', 'Users list failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch users' },
      { status: 500 }
    );
  }
}
