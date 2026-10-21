import { getServerlessRuntime, queueClient } from '../../src/serverless-runtime';
import { AppError } from '../../src/http/errors';
export default queueClient.handleNodeCallback(async input => {
  try { const runtime = await getServerlessRuntime(); if (!runtime.outbox) throw new Error(); await runtime.recovery.process(input, runtime.db, runtime.outbox); await runtime.diagnostics?.purgeExpiredDiagnostics(new Date()); }
  catch { throw new AppError('QUEUE_RECOVERY_FAILED', 503); }
});
