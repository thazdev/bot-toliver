import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { authConfig } from './auth.config';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      username: string;
      displayName: string;
      walletAddress: string;
      tier: string;
    };
  }
  interface User {
    id: string;
    username: string;
    displayName: string;
    walletAddress: string;
    tier: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  trustHost: true,
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { username: credentials.username as string },
        });
        if (!user) return null;

        const valid = await compare(credentials.password as string, user.password);
        if (!valid) return null;

        return {
          id: String(user.id),
          username: user.username,
          displayName: user.displayName,
          walletAddress: user.walletAddress,
          tier: user.tier,
        };
      },
    }),
  ],
});
