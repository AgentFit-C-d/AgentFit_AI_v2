import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../apps/ai/assets/fonts/', import.meta.url);
await mkdir(root, { recursive: true });
for (const name of ['NanumGothic-Regular.ttf', 'OFL.txt']) {
  const response = await fetch(`https://raw.githubusercontent.com/google/fonts/main/ofl/nanumgothic/${name}`);
  if (!response.ok) throw new Error('FONT_DOWNLOAD_FAILED');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (name.endsWith('.ttf') && createHash('sha256').update(bytes).digest('hex') !== '76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31') throw new Error('FONT_SOURCE_CHANGED_REVIEW_REQUIRED');
  await writeFile(new URL(name, root), bytes);
}
console.info('Canonical font and OFL license saved.');
