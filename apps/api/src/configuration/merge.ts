import { parse } from 'smol-toml';
import { AppError } from '../http/errors';
export function managed(content: string, target: string) {
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? '';
  return frontmatter + `<!-- agentfit:${target}:start -->\n` + content.slice(frontmatter.length) + `\n<!-- agentfit:${target}:end -->`;
}
export function mergeManaged(original: string, generated: string, target: string): string {
  const start = `<!-- agentfit:${target}:start -->`; const end = `<!-- agentfit:${target}:end -->`;
  const a = original.indexOf(start); const b = original.indexOf(end);
  const x = generated.indexOf(start); const y = generated.indexOf(end);
  if (a < 0 || b < a || original.indexOf(start, a + start.length) !== -1 || original.indexOf(end, b + end.length) !== -1 || x < 0 || y < x) throw new AppError('EXISTING_FILE_CONFLICT', 422);
  // Preserve frontmatter, but refuse to silently keep a changed Skill identity.
  const expectedFront = generated.slice(0, x);
  if (expectedFront && original.slice(0, a) !== expectedFront) throw new AppError('EXISTING_FILE_CONFLICT', 422);
  return original.slice(0, a) + generated.slice(x, y + end.length) + original.slice(b + end.length);
}
export function mergeToml(original: string, table: string, generated: string): string {
  try {
    const parsed = parse(original); const servers = parsed.mcp_servers;
    if (servers && typeof servers === 'object' && Object.hasOwn(servers, table)) throw new AppError('EXISTING_FILE_CONFLICT', 422);
    const result = original + (original.endsWith('\n') || !original ? '' : '\n') + generated;
    parse(result); return result;
  } catch (e) { if (e instanceof AppError) throw e; throw new AppError('INVALID_EXISTING_TOML', 422); }
}
