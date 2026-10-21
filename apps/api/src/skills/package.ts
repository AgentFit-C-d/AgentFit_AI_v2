import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { assertNoSecretsData } from '@agentfit/contracts';
export interface SkillFile { path: string; content: string }
export interface SkillPackage { id: string; name: string; repository: string; commit: string; hash: string; license: string; files: (SkillFile & { sha256: string })[]; checkedAt: string; expiresAt: string }
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export function safePath(path: string) { return path.length <= 180 && /^[A-Za-z0-9_./-]+$/.test(path) && !path.startsWith('/') && path.split('/').every(part => part !== '..' && part !== '.' && part.length > 0 && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)); }
export function markdownRefs(content: string): string[] {
  const refs = [...content.matchAll(/\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g)].map(x => x[1]!)
    .concat([...content.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*<?([^\s>]+)>?/gm)].map(x => x[1]!))
    .concat([...content.matchAll(/`([^`\n]+\.(?:md|txt|sh|py|js|ts))`/g)].map(x => x[1]!));
  return [...new Set(refs.filter(x => !/^(?:https?:|mailto:|#)/i.test(x)).map(x => x.split('#')[0]!).filter(Boolean))];
}
export function checkPackage(id: string, commit: string, source: SkillFile[], now = new Date(), secrets: readonly string[] = []): SkillPackage {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[a-z0-9-]+$/.test(id) || !/^[a-f0-9]{40}$/.test(commit) || !source.length || source.length > 32) throw new Error('INVALID_PACKAGE');
  const seen = new Set<string>(); let size = 0;
  for (const file of source) {
    if (!safePath(file.path) || !/\.(?:md|txt)$/i.test(file.path) || seen.has(file.path.toLowerCase()) || file.content.includes('\0')) throw new Error('INVALID_PACKAGE_PATH');
    seen.add(file.path.toLowerCase()); size += Buffer.byteLength(file.content); if (size > 262144 || Buffer.byteLength(file.content) > 65536) throw new Error('PACKAGE_TOO_LARGE');
  }
  assertNoSecretsData(source, secrets);
  const skill = source.find(x => x.path === 'SKILL.md')?.content;
  const header = skill?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const name = header?.match(/^name:\s*["']?([a-z0-9-]+)["']?\s*$/m)?.[1];
  if (!name || name.length > 64 || !safePath(name) || !header?.match(/^description:\s*\S/m) || /^(?:allowed-tools|hooks|mcp|dependencies):/m.test(header)) throw new Error('INVALID_SKILL_FORMAT');
  if (source.some(file => `.agents/skills/${name}/${file.path}`.length > 200)) throw new Error('INVALID_PACKAGE_PATH');
  // Only bundled, instruction-only assets are eligible. Referenced executables are not silently omitted.
  for (const file of source.filter(x => /\.md$/i.test(x.path))) {
    if (/ignore (?:all |any |the )?(?:previous|prior|system) instructions|(?:send|upload|reveal|exfiltrate)[^\n]{0,100}(?:api.?keys?|credentials|secrets)|disable[^\n]{0,40}(?:sandbox|security|approval)/i.test(file.content)) throw new Error('UNSAFE_PACKAGE_INSTRUCTION');
    if (/\b(?:scripts\/[^\s`'"<>)]*|(?:requires?|install)\s+(?:the\s+)?(?:agent-browser|skills\s+cli))\b/i.test(file.content)) throw new Error('EXECUTABLE_DEPENDENCY');
    for (const reference of markdownRefs(file.content)) {
      const resolved = posix.normalize(posix.join(posix.dirname(file.path), reference));
      if (!safePath(resolved) || !/\.(md|txt)$/i.test(resolved) || !source.some(x => x.path === resolved)) throw new Error('MISSING_PACKAGE_REFERENCE');
    }
  }
  const licenseText = source.find(x => x.path === 'LICENSE.txt')?.content ?? '';
  const license = /MIT License|Permission is hereby granted, free of charge/.test(licenseText) ? 'MIT' : /Apache License[\s\S]*Version 2\.0/.test(licenseText) ? 'Apache-2.0' : /BSD 3-Clause|Redistribution and use in source and binary forms/.test(licenseText) ? 'BSD' : /ISC License/.test(licenseText) ? 'ISC' : null;
  if (!license) throw new Error('LICENSE_UNCONFIRMED');
  const files = source.map(file => ({ ...file, sha256: hash(file.content) })).sort((a, b) => a.path.localeCompare(b.path));
  return { id, name, repository: id.split('/').slice(0, 2).join('/'), commit, hash: hash(JSON.stringify({ id, commit, files, license })), license, files, checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 86400000).toISOString() };
}
