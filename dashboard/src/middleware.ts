import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware desabilitado - o cookie de sessão não chega corretamente
 * no Railway (proxy). A proteção é feita no cliente via AuthGuard.
 */
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
