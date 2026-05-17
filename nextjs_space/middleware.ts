import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Middleware: protects /admin/* pages and /api/admin/* routes.
 * Non-authenticated users → redirect to /login (pages) or 401 (API).
 * Non-admin users → redirect to /dashboard (pages) or 403 (API).
 */
export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const { pathname } = req.nextUrl;

  const isApiRoute = pathname.startsWith('/api/admin');

  // Not authenticated
  if (!token) {
    if (isApiRoute) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated but not admin
  if (token.role !== 'admin') {
    if (isApiRoute) {
      return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
