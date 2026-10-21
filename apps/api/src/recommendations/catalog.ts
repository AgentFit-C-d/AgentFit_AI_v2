import type { EnvironmentProfile, PermissionOption } from '@agentfit/contracts';
import snapshot from '../../../../packages/catalog/catalog.json' with { type: 'json' };
import { createHash } from 'node:crypto';
import type { SkillPackage } from '../skills/package';
import type { SkillMatch } from '@agentfit/contracts';
export type Check = 'PASS' | 'FAIL' | 'NOT_RUN';
export interface SupportMatrix { id: string; osFamily: string; osVersion: string; clientId: string; clientVersion: string; engineVersion: string; checks: { documentation: Check; format: Check; standalone: Check; combination: Check }; checkedAt: string; expiresAt: string; permissionMappingVerified: boolean; allowedCombinationIds: string[] }
export interface CatalogItem { id: string; name: string; kind: 'MCP' | 'SKILL' | 'HOOK' | 'PLUGIN' | 'RULES'; version: string; capabilities: string[]; components: string[]; dependencies: string[]; conflicts: string[]; risk: 'LOW' | 'MEDIUM' | 'HIGH'; verificationStatus: 'VERIFIED' | 'NOT_VERIFIED' | 'EXPIRED' | 'FAILED' | 'PACKAGE_CHECKED'; license: string; skillsUrl: string; repository: string; commit: string; snapshotSha256: string; supportMatrix: SupportMatrix[]; permissionOptions: PermissionOption[]; package?: SkillPackage; projectMatch?: SkillMatch }
export interface CatalogSnapshot { revision: string; items: CatalogItem[]; discoveryId?: string; discoveryResult?: import('../skills/catalog').DiscoveryResult }
export function loadCatalog(now = new Date()): CatalogSnapshot {
  const catalog = structuredClone(snapshot) as CatalogSnapshot;
  for (const item of catalog.items) if (item.verificationStatus === 'VERIFIED' && !item.supportMatrix.some(m => Date.parse(m.expiresAt) > now.getTime())) item.verificationStatus = 'EXPIRED';
  catalog.revision = createHash('sha256').update(JSON.stringify({ compatibilityPolicy: 'instruction-skill-development-workflow-3', discoverySelectionPolicy: 'recommended75-optional70-v1', items: catalog.items })).digest('hex');
  return catalog;
}
function hasIncompatibleRestriction(pkg: SkillPackage, environment: EnvironmentProfile): boolean {
  const target = '(?:windows|linux|macos|mac os|os x|claude code|codex(?: desktop| cli)?|cursor|gemini cli)';
  const targets = `${target}(?:\\s*(?:,|/|or|and)\\s*${target})*`;
  const expressions = [new RegExp(`\\b(${targets})\\s+only\\b`, 'gi'), new RegExp(`\\bonly\\s+(?:(?:supported|compatible|available|works|runs|usable)(?:\\s+(?:on|with|in|for))?|supports?|for)\\s+(${targets})\\b`, 'gi')];
  for (const file of pkg.files) {
    const text = file.content.replace(/[-–—]/g, ' ').replace(/\*\*|__/g, '');
    for (const expression of expressions) for (const match of text.matchAll(expression)) {
      const tokens = match[1]!.toLowerCase().match(new RegExp(target, 'g')) ?? [];
      const os = tokens.filter(value => ['windows', 'linux', 'macos', 'mac os', 'os x'].includes(value)).map(value => ['mac os', 'os x'].includes(value) ? 'MACOS' : value.toUpperCase());
      const clients = tokens.filter(value => !['windows', 'linux', 'macos', 'mac os', 'os x'].includes(value));
      if (os.length && !os.includes(environment.os!.family)) return true;
      if (clients.length && !clients.some(value => value === 'codex' || value === environment.client!.id.replace('-', ' '))) return true;
    }
  }
  return false;
}
export function compatible(item: CatalogItem, environment: EnvironmentProfile, now = new Date()): SupportMatrix | null {
  if (item.verificationStatus === 'PACKAGE_CHECKED' && item.package && item.kind === 'SKILL' && !item.permissionOptions.length && ['WINDOWS', 'LINUX', 'MACOS'].includes(environment.os?.family ?? '') && environment.os?.version && ['codex-desktop', 'codex-cli'].includes(environment.client?.id ?? '') && Date.parse(item.package.checkedAt) <= now.getTime() && Date.parse(item.package.expiresAt) > now.getTime()) {
    if (hasIncompatibleRestriction(item.package, environment)) return null;
    return { id: `package-${item.package.hash}`, osFamily: environment.os.family, osVersion: environment.os.version, clientId: environment.client!.id, clientVersion: '', engineVersion: '', checkedAt: item.package.checkedAt, expiresAt: item.package.expiresAt, checks: { documentation: 'PASS', format: 'PASS', standalone: 'NOT_RUN', combination: 'NOT_RUN' }, permissionMappingVerified: false, allowedCombinationIds: [] };
  }
  if (item.verificationStatus !== 'VERIFIED' || item.license === 'UNKNOWN' || !environment.os || !environment.client) return null;
  const instructionOnly = item.kind === 'SKILL' && item.permissionOptions.length === 0;
  return item.supportMatrix.find(matrix => matrix.osFamily === environment.os!.family && matrix.osVersion === environment.os!.version && matrix.clientId === environment.client!.id && (instructionOnly || matrix.clientVersion === environment.client!.version) && Date.parse(matrix.checkedAt) <= now.getTime() && Date.parse(matrix.expiresAt) > now.getTime() && Object.values(matrix.checks).every(check => check === 'PASS') && matrix.permissionMappingVerified) ?? null;
}
