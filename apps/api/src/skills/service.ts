import { randomUUID } from 'node:crypto';
import { assertNoSecretsData, validateSkillData, generalSkillQuery, SKILL_RECOMMENDATION_MIN_SCORE, SKILL_OPTIONAL_MIN_SCORE, type ConfirmedProfile, type DeveloperProfile, type RecommendationBasis, type SkillDiscoveryDto, type SkillFact, type SkillNeed, type SkillMatch, type AnalysisResult, type ReviewDecision } from '@agentfit/contracts';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { lockOwnedProject, basisOf, validatePublic } from '../recommendations/profiles';
import { loadCatalog } from '../recommendations/catalog';
import { sameBasis } from '../recommendations/service';
import { AppError } from '../http/errors';
import { staticSnapshots } from './static-snapshots';
import type { SkillAi } from './ai';
import type { SkillSource, SearchCandidate } from './source';
import { checkPackage, hash, type SkillPackage } from './package';
import type { DiscoveryResult } from './catalog';
const json = (value: unknown) => value as Prisma.InputJsonValue;
const active = ['QUEUED', 'SEARCHING', 'CHECKING'];
const empty = (): DiscoveryResult => ({ needs: [], checks: [], artifactIds: [], matches: [] });
function rankContent(content: string): string { let bytes = 0; let output = ''; for (const character of content) { bytes += Buffer.byteLength(character); if (bytes > 6000) break; output += character; } return output; }
export function discoveryFacts(profile: ConfirmedProfile, developer: DeveloperProfile | null): SkillFact[] {
  const facts: SkillFact[] = [];
  for (const field of ['features', 'external_integrations', 'frontend', 'backend', 'ai', 'database', 'deployment'] as const) {
    const raw = profile.profile[field]; const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    values.forEach((value, i) => { if (value.length <= 512) facts.push({ id: `${field}:${i}`, field, value }); });
  }
  (developer?.responsibilities ?? []).forEach((value, i) => { if (value.length <= 512) facts.push({ id: `work:${i}`, field: 'work', value }); });
  return facts.slice(0, 96);
}
export class SkillDiscoveryService {
  constructor(private readonly db: PrismaClient, private readonly ai: SkillAi, private readonly source: SkillSource, private readonly publish: (id: string) => Promise<void>, private readonly secrets: readonly string[] = [], private readonly now = () => new Date()) {}
  private dto(row: { id: string; basis: Prisma.JsonValue; status: string; result: Prisma.JsonValue; errorCode: string | null; createdAt: Date; deadline: Date }, current: RecommendationBasis): SkillDiscoveryDto {
    const result = row.result as unknown as DiscoveryResult; const basis = row.basis as unknown as RecommendationBasis;
    return { id: row.id, basis, status: sameBasis(basis, current) ? row.status as SkillDiscoveryDto['status'] : 'STALE', needs: result.needs, checks: result.checks, errorCode: row.errorCode, createdAt: row.createdAt.toISOString(), deadline: row.deadline.toISOString() };
  }
  async start(owner: string, id: string, raw: unknown): Promise<SkillDiscoveryDto> {
    const { expectedVersions } = validatePublic(value => validateSkillData<{ expectedVersions: { project: number; developer: number; environment: number } }>('start', value), raw, this.secrets);
    const dto = await this.db.$transaction(async tx => {
      const project = await lockOwnedProject(tx, owner, id); const basis = basisOf(project, loadCatalog(this.now()).revision);
      if (!project.confirmedProfile) throw new AppError('PROFILE_CONFIRMATION_REQUIRED', 422);
      if (basis.projectVersion !== expectedVersions.project || basis.developerVersion !== expectedVersions.developer || basis.environmentVersion !== expectedVersions.environment) throw new AppError('VERSION_CONFLICT', 409);
      const existing = await tx.skillDiscovery.findFirst({ where: { projectId: id, status: { in: active }, deadline: { gt: this.now() } }, orderBy: { createdAt: 'desc' } });
      if (existing && sameBasis(existing.basis as unknown as RecommendationBasis, basis)) return this.dto(existing, basis);
      const created = await tx.skillDiscovery.create({ data: { projectId: id, basis: json(basis), result: json(empty()), deadline: new Date(this.now().getTime() + 180000) } });
      await tx.jobOutbox.createMany({ data: [{ kind: 'discover', targetId: created.id, dueAt: this.now() }, { kind: 'discover_expire', targetId: created.id, dueAt: created.deadline }] });
      return this.dto(created, basis);
    }, { timeout: 5000 });
    try { await this.publish(dto.id); } catch { /* Durable outbox recovers publication; never claim failed profile save. */ }
    return dto;
  }
  async get(owner: string, projectId: string, id: string) {
    return this.db.$transaction(async tx => {
      const project = await lockOwnedProject(tx, owner, projectId);
      const row = await tx.skillDiscovery.findFirst({ where: { id, projectId } }); if (!row) throw new AppError('DISCOVERY_NOT_FOUND', 404);
      return this.dto(row, basisOf(project, loadCatalog(this.now()).revision));
    });
  }
  async latest(owner: string, projectId: string) {
    return this.db.$transaction(async tx => {
      const project = await lockOwnedProject(tx, owner, projectId); const row = await tx.skillDiscovery.findFirst({ where: { projectId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      return row ? this.dto(row, basisOf(project, loadCatalog(this.now()).revision)) : null;
    });
  }
  async expire(id: string) { await this.db.skillDiscovery.updateMany({ where: { id, status: { in: active }, deadline: { lte: this.now() } }, data: { status: 'FAILED', errorCode: 'SKILL_DISCOVERY_TIMEOUT', leaseId: null, finishedAt: this.now() } }); }
  async process(id: string): Promise<void> {
    await this.expire(id);
    const lease = randomUUID();
    const start = await this.db.$transaction(async tx => {
      const row = await tx.skillDiscovery.findUnique({ where: { id } }); if (!row || row.status !== 'QUEUED' || row.deadline <= this.now()) return null;
      const project = await tx.project.findFirst({ where: { id: row.projectId, deletingAt: null }, include: { developerProfile: true, environmentProfile: true } });
      if (!project?.confirmedProfile) return null;
      if (!sameBasis(row.basis as unknown as RecommendationBasis, basisOf(project, loadCatalog(this.now()).revision))) { await tx.skillDiscovery.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'STALE', finishedAt: this.now() } }); return null; }
      if (!(await tx.skillDiscovery.updateMany({ where: { id, status: 'QUEUED', leaseId: null }, data: { status: 'SEARCHING', leaseId: lease } })).count) return null;
      const confirmed = project.confirmedProfile as unknown as ConfirmedProfile;
      const facts = discoveryFacts(confirmed, project.developerProfile?.data as DeveloperProfile | null);
      const audit = await tx.profileAudit.findUnique({ where: { projectId_version: { projectId: project.id, version: project.version } } });
      const draft = audit?.draftId ? await tx.draft.findFirst({ where: { id: audit.draftId, projectId: project.id } }) : null;
      if (draft) {
        const accepted = new Set((audit!.decisions as unknown as ReviewDecision[]).filter(x => x.action === 'ACCEPT').map(x => x.itemId));
        for (const candidate of (draft.result as unknown as AnalysisResult).candidates) {
          if (!candidate.field || !accepted.has(candidate.id) || confirmed.sources[candidate.field]?.source !== 'DOCUMENT') continue;
          const value = confirmed.profile[candidate.field]; const values = Array.isArray(value) ? value : value ? [value] : [];
          for (const usage of candidate.usages ?? []) if (values.includes(usage.value) && usage.purpose.length + usage.value.length < 500 && facts.length < 96) facts.push({ id: `purpose:${facts.filter(f => f.field === 'purpose').length}`, field: 'purpose', value: `${usage.value}: ${usage.purpose}` });
        }
      }
      return { row, facts };
    });
    if (!start) return;
    const signal = AbortSignal.timeout(Math.max(1, start.row.deadline.getTime() - this.now().getTime()));
    const result = empty(); const packages: SkillPackage[] = [];
    try {
      assertNoSecretsData(start.facts, this.secrets);
      const budget = { targetId: id, leaseId: lease };
      const needs = validateSkillData<{ needs: SkillNeed[] }>('needs', { needs: await this.ai.needs(start.facts, start.row.deadline.toISOString(), signal, budget) }).needs;
      if (new Set(needs.map(x => x.id)).size !== needs.length || needs.some(x => !generalSkillQuery(x.query) || !x.sourceFields.every(id => start.facts.some(f => f.id === id)))) throw new Error('INVALID_SKILL_RESPONSE');
      assertNoSecretsData(needs, this.secrets); result.needs = needs;
      // Query vocabulary is shared with the AI schema; never forward model-generated proper nouns.
      const searched = new Map<string, SearchCandidate>(); let searchFailures = 0;
      for (const need of needs) {
        try { for (const candidate of await this.source.search(need.query, signal)) if (!searched.has(candidate.id)) searched.set(candidate.id, candidate); }
        catch { searchFailures++; }
      }
      if (needs.length && searchFailures === needs.length) throw new Error('SEARCH_FAILED');
      await this.db.skillDiscovery.updateMany({ where: { id, leaseId: lease, status: 'SEARCHING' }, data: { status: 'CHECKING', result: json(result) } });
      const staticCatalog = loadCatalog(this.now());
      const candidates = [...searched.values()].filter(x => !staticCatalog.items.some(i => i.repository === x.repository && i.name === x.name));
      // Prefer topical names first, then canonical suppliers over forks, then popularity as tie-breaker.
      const terms = new Set(needs.flatMap(n => n.query.split(' ')));
      const score = (x: SearchCandidate) => x.name.split('-').filter(w => terms.has(w)).length;
      candidates.sort((a, b) => score(b) - score(a) || b.installs - a.installs || a.id.localeCompare(b.id));
      const seenContent = new Set<string>();
      // Sequential package reads keep public API concurrency at one and remaining time bounded.
      for (const candidate of candidates.slice(0, 8)) {
        if (signal.aborted) throw new Error('TIMEOUT');
        try {
          const raw = await this.source.inspect(candidate, signal);
          const value = checkPackage(raw.id, raw.commit, raw.files.map(x => ({ path: x.path, content: x.content })), this.now(), this.secrets);
          if (value.id !== candidate.id) throw new Error('SOURCE_MISMATCH');
          const key = hash(value.name + '\n' + value.files.find(x => x.path === 'SKILL.md')!.content);
          if (seenContent.has(key) || packages.some(x => x.name === value.name) || staticSnapshots.some(x => x.name === value.name)) throw new Error('DUPLICATE_PACKAGE');
          seenContent.add(key); packages.push(value); result.checks.push({ candidateId: candidate.id, name: value.name, status: 'PASS', code: 'PACKAGE_CHECKED' });
        } catch (error) {
          const codes = new Set(['INVALID_PACKAGE', 'INVALID_PACKAGE_PATH', 'PACKAGE_TOO_LARGE', 'INVALID_SKILL_FORMAT', 'EXECUTABLE_DEPENDENCY', 'MISSING_PACKAGE_REFERENCE', 'LICENSE_UNCONFIRMED', 'LICENSE_PATH_CONFLICT', 'COMMIT_UNCONFIRMED', 'SKILL_PATH_UNCONFIRMED', 'PACKAGE_TREE_INCOMPLETE', 'EXECUTABLE_OR_EXTERNAL_REFERENCE', 'SECRET_DETECTED', 'UNSAFE_PACKAGE_INSTRUCTION', 'SOURCE_MISMATCH', 'DUPLICATE_PACKAGE', 'SKILL_SOURCE_RATE_LIMITED', 'SKILL_SOURCE_AUTH_FAILED']);
          const code = error instanceof Error && (codes.has(error.message) || error.message === 'SKILL_SOURCE_TOO_LARGE') ? error.message : 'PACKAGE_SOURCE_UNAVAILABLE';
          result.checks.push({ candidateId: candidate.id, name: candidate.name, status: 'BLOCKED', code });
          if (code === 'SKILL_SOURCE_RATE_LIMITED' || code === 'SKILL_SOURCE_AUTH_FAILED') { if (!packages.length) throw new Error(code); break; }
        }
      }
      if (candidates.length && !packages.length) throw new Error('PACKAGE_CHECK_FAILED');
      const rankingCandidates = [...packages.map(p => ({ id: p.id, name: p.name, content: rankContent(p.files.find(x => x.path === 'SKILL.md')!.content) })), ...staticSnapshots.map(p => ({ id: p.id, name: p.name, content: rankContent(p.files.find(x => x.path === 'SKILL.md')!.content) }))];
      const matches = needs.length ? validateSkillData<{ matches: SkillMatch[] }>('ranking', { matches: await this.ai.rank(needs, rankingCandidates, start.row.deadline.toISOString(), signal, budget) }).matches : [];
      assertNoSecretsData(matches, this.secrets);
      if (new Set(matches.map(x => x.candidateId)).size !== matches.length || matches.some(x => !rankingCandidates.some(c => c.id === x.candidateId) || !x.needIds.every(n => needs.some(need => need.id === n)))) throw new Error('INVALID_RANKING');
      const selected = new Map<string, SkillMatch>();
      for (const need of needs) {
        const match = matches.filter(x => x.score >= SKILL_RECOMMENDATION_MIN_SCORE && x.needIds.includes(need.id)).sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId))[0];
        if (match) selected.set(match.candidateId, match);
      }
      const optional = matches.filter(x => x.score >= SKILL_OPTIONAL_MIN_SCORE && x.score < SKILL_RECOMMENDATION_MIN_SCORE).sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId));
      result.matches = [...selected.values()].slice(0, 6).concat(optional);
      const accepted = packages.filter(p => result.matches.some(m => m.candidateId === p.id)); result.artifactIds = accepted.map(p => p.hash);
      await this.db.$transaction(async tx => {
        const project = await tx.project.findFirst({ where: { id: start.row.projectId, deletingAt: null }, include: { developerProfile: true, environmentProfile: true } });
        if (!project) return;
        const current = await lockOwnedProject(tx, project.ownerId, project.id);
        const row = await tx.skillDiscovery.findUnique({ where: { id } }); if (!row || row.leaseId !== lease || !active.includes(row.status)) return;
        if (row.deadline <= this.now()) { await tx.skillDiscovery.update({ where: { id }, data: { status: 'FAILED', errorCode: 'SKILL_DISCOVERY_TIMEOUT', leaseId: null, finishedAt: this.now() } }); return; }
        if (!sameBasis(row.basis as unknown as RecommendationBasis, basisOf(current, loadCatalog(this.now()).revision))) { await tx.skillDiscovery.update({ where: { id }, data: { status: 'STALE', leaseId: null, finishedAt: this.now() } }); return; }
        for (const p of accepted) {
          const checked = { package: json(p), checkedAt: new Date(p.checkedAt), expiresAt: new Date(p.expiresAt) };
          // Renew only after a full source inspection of exactly the same content hash.
          await tx.skillArtifact.upsert({ where: { id: p.hash }, create: { id: p.hash, ...checked }, update: checked });
        }
        await tx.skillDiscovery.update({ where: { id }, data: { status: 'SUCCEEDED', result: json(result), leaseId: null, finishedAt: this.now() } });
      }, { timeout: 5000 });
    } catch (error) {
      const aiErrors = new Set(['SKILL_AI_TIMEOUT', 'SKILL_AI_INVALID_RESPONSE', 'SKILL_AI_AUTH_FAILED', 'SKILL_AI_RATE_LIMITED', 'SKILL_AI_UNAVAILABLE', 'SKILL_BUDGET_EXCEEDED', 'SKILL_SOURCE_RATE_LIMITED', 'SKILL_SOURCE_AUTH_FAILED']);
      const errorCode = signal.aborted ? 'SKILL_DISCOVERY_TIMEOUT' : error instanceof Error && aiErrors.has(error.message) ? error.message : error instanceof Error && error.message === 'PACKAGE_CHECK_FAILED' ? 'SKILL_PACKAGE_CHECK_FAILED' : 'SKILL_DISCOVERY_FAILED';
      await this.db.skillDiscovery.updateMany({ where: { id, leaseId: lease, status: { in: active } }, data: { status: 'FAILED', result: json(result), leaseId: null, errorCode, finishedAt: this.now() } });
    }
  }
}
