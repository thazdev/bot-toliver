'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { preferences } from '@/lib/preferences';

const IGNORE_PATHS = ['/login', '/signup', '/setup'];

export function NavigateTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname && !IGNORE_PATHS.some((p) => pathname.startsWith(p))) {
      preferences.setLastPath(pathname);
    }
  }, [pathname]);

  return null;
}
