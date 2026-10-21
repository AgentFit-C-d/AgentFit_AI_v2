import { QueueClient } from '@vercel/queue';
import { readConfig } from './config';
import { createRuntime } from './runtime';
import { PrivateBlobStore } from './storage/private-blob';
import { VercelQueue } from './analysis/vercel-queue';
import { QueueRecovery } from './analysis/queue-recovery';
import { AppError } from './http/errors';
export const queueClient = new QueueClient({ deploymentId: null, telemetry: { isEnabled: false } });
let ready: Promise<Awaited<ReturnType<typeof makeRuntime>>> | undefined;
async function makeRuntime() {
  const config = readConfig(process.env);
  const token = process.env.BLOB_READ_WRITE_TOKEN; const apiOrigin = process.env.API_INTERNAL_URL;
  if (process.env.RUNTIME_MODE !== 'vercel' || !token || !config.analysis || !config.diagnosticKey || !apiOrigin) throw new AppError('SERVER_NOT_CONFIGURED', 503);
  const url = new URL(apiOrigin);
  if (url.origin !== apiOrigin || url.protocol !== 'https:') throw new AppError('INVALID_API_URL', 503);
  const recovery = new QueueRecovery(queueClient, 'agentfit-recovery');
  const queue = new VercelQueue('agentfit-jobs', queueClient);
  const knownSecrets = Object.entries(process.env).filter(([key]) => /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(key)).map(([, value]) => value!).filter(Boolean);
  const runtime = await createRuntime(config, { inputs: new PrivateBlobStore(token), queue: { publish: async (message, options) => { await recovery.schedule(); await queue.publish(message, options); } }, blob: { token, apiOrigin } }, knownSecrets);
  return { ...runtime, recovery };
}
export function getServerlessRuntime() {
  ready ??= makeRuntime().catch(error => { ready = undefined; throw error; });
  return ready;
}
