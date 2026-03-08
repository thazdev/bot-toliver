import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authConfig } from './auth.config';

const authMiddleware = NextAuth(authConfig).auth;

export default async function middleware(req: NextRequest) {
  console.log('[AUTH-MW] middleware run', { path: req.nextUrl.pathname });
  const res = await authMiddleware(req);
  if (res instanceof NextResponse && res.status === 307) {
    console.log('[AUTH-MW] redirecting', { to: res.headers.get('location') });
  }
  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|signup|setup|api).*)',
  ],
};
