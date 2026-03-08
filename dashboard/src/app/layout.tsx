import type { Metadata } from 'next';
import { SessionProvider } from 'next-auth/react';
import { AuthGuard } from '@/components/AuthGuard';
import { NavigateTracker } from '@/components/NavigateTracker';
import './globals.css';

export const metadata: Metadata = {
  title: 'Toliver Dashboard',
  description: 'Bot trading dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="min-h-screen bg-surface antialiased">
        <SessionProvider>
          <AuthGuard>
            <NavigateTracker />
            {children}
          </AuthGuard>
        </SessionProvider>
      </body>
    </html>
  );
}
