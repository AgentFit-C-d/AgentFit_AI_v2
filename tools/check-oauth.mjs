import { createRequire } from 'node:module';
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
requireApi('dotenv').config({ path: '.env', quiet: true });
const { Client } = requireApi('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const result = await client.query('SELECT EXISTS(SELECT 1 FROM "Account" a JOIN "Session" s ON s."userId" = a."userId" WHERE a."providerId" = $1 AND s."expiresAt" > NOW()) AS "githubSessionVerified"', ['github']);
  console.info(JSON.stringify(result.rows[0]));
} finally { await client.end(); }
