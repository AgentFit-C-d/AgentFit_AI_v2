// Actual Solar + public search/package probe on owned synthetic projects only.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createDatabase } from '../apps/api/src/db';
import { readConfig } from '../apps/api/src/config';
import { SkillDiscoveryService } from '../apps/api/src/skills/service';
import { HttpSkillAi } from '../apps/api/src/skills/ai';
import { PublicSkillSource } from '../apps/api/src/skills/source';
import { ProfileRepository } from '../apps/api/src/recommendations/profiles';
import { PrismaProjectRepository } from '../apps/api/src/projects/prisma-repository';
import { RecommendationService } from '../apps/api/src/recommendations/service';
import { resolveProjectCatalog } from '../apps/api/src/skills/catalog';
import { emptyProfile } from '../packages/contracts/src';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url)); require('dotenv').config({ path: '.env', quiet: true });
const config = readConfig(process.env);
if (!config.analysis || process.env.RUNTIME_MODE !== 'local' || !['localhost', '127.0.0.1'].includes(new URL(config.databaseUrl).hostname)) throw new Error('LOCAL_EVALUATION_REQUIRED');
const db = createDatabase(config.databaseUrl); const owner = `skill-eval-${randomUUID()}`; const jobs: string[] = []; const records: unknown[] = [];
const secrets = Object.entries(process.env).filter(([key]) => /SECRET|TOKEN|KEY|DATABASE_URL/.test(key)).map(([,value]) => value!).filter(Boolean);
const source = new PublicSkillSource(fetch, secrets);
const ai = new HttpSkillAi(config.analysis.url, config.analysis.token, fetch, secrets);
const discovery = new SkillDiscoveryService(db, ai, source, async () => {}, secrets);
const selectedFixture = process.argv[2]; if (selectedFixture && !['payments', 'rag'].includes(selectedFixture)) throw new Error('INVALID_EVALUATION_SCOPE');
const reportPath = `work/harness/solar-migration/discovery-${Date.now()}.json`;
try {
  await db.user.create({ data: { id: owner, name: 'Isolated evaluation', email: `${owner}@example.invalid` } });
  for (const fixture of [{ type: 'payments', features: ['결제 승인과 환불', '중복 주문 방지와 거래 일관성'], integrations: ['결제 API'] }, { type: 'rag', features: ['PDF 문서에서 문단을 추출하고 임베딩 검색', '검색 근거를 인용하는 RAG 답변'], integrations: ['임베딩 API'] }]) {
    if (selectedFixture && selectedFixture !== fixture.type) continue;
    const row = await db.project.create({ data: { ownerId: owner, name: 'Synthetic evaluation' } });
    await new PrismaProjectRepository(db).saveProfile(owner, row.id, { expectedVersion: 1, profile: { ...emptyProfile(), frontend: ['React'], backend: ['Node.js'], features: fixture.features, external_integrations: fixture.integrations } });
    const profiles = new ProfileRepository(db, secrets);
    await profiles.putDeveloper(owner, row.id, { expectedVersion: 0, data: { role: 'FULL_STACK', responsibilities: ['서비스 기능 구현과 API 검증'], experienceLevel: null } });
    await profiles.putEnvironment(owner, row.id, { expectedVersion: 0, data: { os: { family: 'WINDOWS', version: '11' }, client: { id: 'codex-desktop', version: null }, runtimes: [], installedComponents: [], configurationKnowledge: 'USER_SAYS_EMPTY', authenticationReadiness: [] } });
    const started = Date.now(); const job = await discovery.start(owner, row.id, { expectedVersions: { project: 2, developer: 1, environment: 1 } }); jobs.push(job.id);
    await discovery.process(job.id); const done = await discovery.get(owner, row.id, job.id);
    const rec = await new RecommendationService(db, undefined, secrets, resolveProjectCatalog).create(owner, row.id, { expectedVersions: { project: 2, developer: 1, environment: 1 } });
    const record = { type: fixture.type, elapsedMs: Date.now() - started, status: done.status, errorCode: done.errorCode, needs: done.needs, checks: done.checks, functional: rec.items.filter(x => x.category === 'PROJECT').map(x => ({ name: x.tool?.name ?? x.catalogItemId, reason: x.reason, packageOnly: !!x.tool })), common: rec.items.filter(x => x.category !== 'PROJECT').map(x => x.catalogItemId), actualCodexUse: 'NOT_RUN' };
    records.push(record); await writeFile(reportPath, JSON.stringify(records, null, 2)); console.info(JSON.stringify({ reportPath, ...record }));
  }
} catch { console.error('SKILL_EVALUATION_FAILED'); process.exitCode = 1; }
finally {
  await db.jobOutbox.deleteMany({ where: { targetId: { in: jobs }, kind: { in: ['discover', 'discover_expire'] } } });
  await db.user.deleteMany({ where: { id: owner } }); await db.$disconnect();
}
