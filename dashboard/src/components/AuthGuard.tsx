'use client';

import { useSession } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';

const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/setup',
  ...(process.env.NODE_ENV === 'development' ? ['/diagnostics'] : []),
];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'loading') return;

    // Logado em página pública -> vai pro dashboard
    if (session && pathname === '/login') {
      router.replace('/');
      return;
    }

    // Não logado em página protegida -> vai pro login
    if (!session && !PUBLIC_PATHS.some((p) => pathname?.startsWith(p))) {
      router.replace(`/login?callbackUrl=${encodeURIComponent(pathname || '/')}`);
    }
  }, [session, status, pathname, router]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (session && pathname === '/login') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!session && !PUBLIC_PATHS.some((p) => pathname?.startsWith(p))) {
    return null;
  }

  return <>{children}</>;
}
