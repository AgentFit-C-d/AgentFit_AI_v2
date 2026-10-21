import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import type { PrismaClient } from '../generated/prisma/client';
import type { ServerConfig } from '../config';
export function createAuth(db: PrismaClient, config: ServerConfig) {
  return betterAuth({
    database: prismaAdapter(db, { provider: 'postgresql' }),
    secret: config.authSecret, baseURL: config.webOrigin, basePath: '/api/auth',
    trustedOrigins: [config.webOrigin],
    socialProviders: config.github ? { github: { ...config.github, scope: ['read:user', 'user:email'] } } : {},
    account: { encryptOAuthTokens: true },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    advanced: { useSecureCookies: config.webOrigin.startsWith('https:') },
    logger: { disabled: true },
  });
}
