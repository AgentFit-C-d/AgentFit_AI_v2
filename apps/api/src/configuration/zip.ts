import { zipSync, strToU8 } from 'fflate';
import type { PreviewFile } from '@agentfit/contracts';
export function zipFiles(files: PreviewFile[]): Uint8Array { return zipSync(Object.fromEntries(files.map(file => [file.relativePath, strToU8(file.content)])), { level: 1, mtime: new Date('2026-01-01T00:00:00Z') }); }
