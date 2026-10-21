import { readFile } from 'node:fs/promises';
const [id, ...paths] = process.argv.slice(2);
if (!['vercel-labs-vercel-react-best-practices', 'vercel-labs-vercel-composition-patterns', 'prisma-prisma-client-api', 'obra-systematic-debugging', 'obra-test-driven-development', 'obra-verification-before-completion', 'obra-writing-plans'].includes(id)) throw new Error('UNKNOWN_REVIEW_TARGET');
const snapshot = JSON.parse(await readFile(`packages/catalog/snapshots/${id}.json`, 'utf8'));
if (!paths.length) console.log(JSON.stringify(snapshot.files.map(x => x.path)));
else for (const path of paths) { const file = snapshot.files.find(x => x.path === path); if (!file) throw new Error('UNKNOWN_REVIEW_FILE'); console.log(file.content); }
