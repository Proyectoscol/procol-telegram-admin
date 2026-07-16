import type { NextRequest } from 'next/server';

/**
 * Verifies a Vercel Cron request. Vercel automatically sends
 * `Authorization: Bearer $CRON_SECRET` on cron-triggered invocations when
 * CRON_SECRET is set as a project env var. Fails closed: if CRON_SECRET
 * isn't configured, every request is rejected — these routes trigger real
 * work (OpenAI spend, bulk DB writes), so an unauthenticated fallback is
 * not an option.
 */
export function isAuthorizedCronRequest(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}
