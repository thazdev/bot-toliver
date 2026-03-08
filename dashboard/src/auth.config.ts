import type { NextAuthConfig } from 'next-auth';

export const authConfig = {
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' as const },
  callbacks: {
    authorized({ auth, request: { nextUrl } }: any) {
      const isLoggedIn = !!auth?.user;
      const isPublicPath = ['/login', '/setup', '/signup', '/api/auth', '/api/setup', '/api/signup', '/api/health', '/api/admin/reset-users'].some(
        (p: string) => nextUrl.pathname.startsWith(p),
      );
      if (isPublicPath) return true;
      return isLoggedIn;
    },
    async jwt({ token, user, trigger, session }: any) {
      if (user) {
        token.id = user.id;
        token.username = user.username;
        token.displayName = user.displayName;
        token.walletAddress = user.walletAddress;
        token.tier = user.tier;
      }
      if (trigger === 'update' && session?.user) {
        if (session.user.walletAddress !== undefined) token.walletAddress = session.user.walletAddress;
        if (session.user.displayName !== undefined) token.displayName = session.user.displayName;
      }
      return token;
    },
    async session({ session, token }: any) {
      session.user = {
        id: token.id,
        username: token.username,
        displayName: token.displayName,
        walletAddress: token.walletAddress,
        tier: token.tier,
      };
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
