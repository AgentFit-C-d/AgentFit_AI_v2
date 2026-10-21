import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const { parse } = createRequire(new URL('../apps/api/package.json', import.meta.url))('dotenv');
const values = parse(await readFile(new URL('../.env', import.meta.url), 'utf8'));
console.info(JSON.stringify({ clientIdPresent: !!values.GITHUB_CLIENT_ID, clientSecretPresent: !!values.GITHUB_CLIENT_SECRET }));
