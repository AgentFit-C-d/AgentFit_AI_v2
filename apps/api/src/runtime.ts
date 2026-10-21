import { toNodeHandler } from 'better-auth/node';
import { createApp } from './app';
import type { ServerConfig } from './config';
import { createDatabase } from './db';
import { createAuth } from './auth/auth';
import { sessionReader } from './auth/session';
import { PrismaProjectRepository } from './projects/prisma-repository';
import { PrismaUploadRepository } from './storage/prisma-uploads';
import { LocalInputStore } from './storage/local-store';
import { UploadService } from './storage/uploads';
import { CleanupService } from './storage/cleanup';
import { PrismaAttemptRepository } from './analysis/prisma-repository';
import { HttpAiPort } from './analysis/http-ai';
import { AnalysisWorker } from './analysis/worker';
import { LocalQueue, LocalWorkerLoop } from './analysis/local-queue';
import { OutboxDispatcher } from './analysis/outbox';
import { AnalysisService } from './analysis/service';
import { internalRoutes } from './analysis/internal-routes';
import { BudgetService } from './analysis/budget';
import { SolarBudgetService } from './analysis/solar-budget';
import { DiagnosticStore } from './diagnostics/store';
import { DeleteProjectService } from './projects/delete';
import type { TemporaryInputStore } from './storage/ports';
import type { QueuePort } from './analysis/queue-port';
import { blobRoutes } from './storage/blob-routes';
import { ProfileRepository } from './recommendations/profiles';
import { RecommendationService } from './recommendations/service';
import { ConfigurationService } from './configuration/service';
import { SkillDiscoveryService } from './skills/service';
import { PublicSkillSource } from './skills/source';
import { HttpSkillAi } from './skills/ai';
import type { SkillAi } from './skills/ai';
import type { SkillSource } from './skills/source';
import { resolveProjectCatalog } from './skills/catalog';
export async function createRuntime(config: ServerConfig, ports: { inputs: TemporaryInputStore; queue: QueuePort; blob?: { token: string; apiOrigin: string }; skills?: { ai: SkillAi; source: SkillSource } }, knownSecrets: readonly string[] = []) {
  const db = createDatabase(config.databaseUrl); await db.$connect();
  const auth = createAuth(db, config); const projects = new PrismaProjectRepository(db);
  const inputs = ports.inputs; const uploadRepository = new PrismaUploadRepository(db);
  const cleanup = new CleanupService(uploadRepository, inputs);
  let loop: LocalWorkerLoop | undefined;
  let analysis: AnalysisService | undefined;
  let uploads: UploadService | undefined;
  let internal: ReturnType<typeof internalRoutes> | undefined;
  let outbox: OutboxDispatcher | undefined;
  let discovery: SkillDiscoveryService | undefined;
  const publish = async (id: string) => { if (!outbox) throw new Error('ANALYSIS_NOT_CONFIGURED'); await outbox.publishTarget(id); };
  const diagnostics = config.diagnosticKey ? new DiagnosticStore(db, config.diagnosticKey, publish, knownSecrets) : undefined;
  const deletion = new DeleteProjectService(db, cleanup, publish);
  if (config.analysis) {
    discovery = new SkillDiscoveryService(db, ports.skills?.ai ?? new HttpSkillAi(config.analysis.url, config.analysis.token, fetch, knownSecrets), ports.skills?.source ?? new PublicSkillSource(fetch, knownSecrets, { githubToken: config.githubSkillsReadToken, githubApp: config.github }), publish, knownSecrets);
    const attempts = new PrismaAttemptRepository(db);
    const worker = new AnalysisWorker(attempts, new HttpAiPort(config.analysis.url, config.analysis.token, fetch, Date.now, diagnostics ? (request, raw, receivedAt) => diagnostics.saveFailureDiagnostic(request.attemptId, request.leaseId, raw, receivedAt) : undefined, knownSecrets), async id => { await cleanup.cleanupUpload(id, true); }, Date.now, knownSecrets);
    outbox = new OutboxDispatcher(db, ports.queue, worker, attempts, cleanup, Date.now, { purge: async (id, now) => { if (!diagnostics) throw new Error('DIAGNOSTICS_NOT_CONFIGURED'); await diagnostics.expireDiagnostic(id, now); }, deletion: id => deletion.resumeDelete(id), discover: id => discovery!.process(id), discoverExpire: id => discovery!.expire(id) });
    uploads = new UploadService(inputs, uploadRepository, async (owner, project) => !!await projects.findOwned(owner, project), publish);
    analysis = new AnalysisService(attempts, uploads, publish, cleanup, knownSecrets);
    internal = internalRoutes({ db, token: config.analysis.token, inputs, budget: new BudgetService(db, config.analysis.budgetMicroUsd, config.analysis.priceMicroUsd), solarBudget: new SolarBudgetService(db, config.analysis.budgetMicroUsd) });
    if (inputs.storage === 'local') loop = new LocalWorkerLoop(outbox);
  }
  const session = sessionReader(auth);
  const blob = ports.blob && uploads ? blobRoutes({ ...ports.blob, webOrigin: config.webOrigin, session, uploads }) : undefined;
  const profiles = new ProfileRepository(db, knownSecrets);
  const recommendations = new RecommendationService(db, undefined, knownSecrets, resolveProjectCatalog);
  const configuration = new ConfigurationService(db, undefined, knownSecrets, undefined, resolveProjectCatalog);
  const app = createApp({ webOrigin: config.webOrigin, projects, session, authHandler: toNodeHandler(auth), analysis, uploads, internal, githubConfigured: !!config.github, knownSecrets, deletion, blob, profiles, recommendations, configuration, discovery });
  return { app, db, inputs, loop, outbox, diagnostics };
}
export async function createLocalRuntime(config: ServerConfig, knownSecrets: readonly string[] = [], skills?: { ai: SkillAi; source: SkillSource }) {
  const inputs = new LocalInputStore();
  try { return { ...await createRuntime(config, { inputs, queue: new LocalQueue(), skills }, knownSecrets), inputs }; }
  catch (error) { inputs.dispose(); throw error; }
}
