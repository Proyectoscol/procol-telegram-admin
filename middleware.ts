import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { log } from '@/lib/logger';

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options ?? {})
          );
        },
      },
    });

    const { data: { user } } = await supabase.auth.getUser();

    if (path === '/login') {
      if (user) {
        const redirectTo = request.nextUrl.searchParams.get('redirectTo') ?? '/';
        return NextResponse.redirect(new URL(redirectTo, request.url));
      }
      return response;
    }

    if (!user) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirectTo', path);
      return NextResponse.redirect(loginUrl);
    }

    return response;
  } catch (err) {
    log.error('MIDDLEWARE', 'Supabase auth check failed', err);
    if (path === '/login') {
      return response;
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirectTo', path);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: [
    '/',
    '/login',
    '/contacts',
    '/import',
    '/intelligence',
    '/settings',
    '/users/:path*',
    '/analytics',
    '/review-queue',
  ],
};
