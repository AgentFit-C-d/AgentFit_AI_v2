import { getServerlessRuntime, queueClient } from '../../src/serverless-runtime';
import { AppError } from '../../src/http/errors';
// Only Vercel's private queue trigger may invoke this function. Never mount on Express.
export default queueClient.handleNodeCallback(async input => {
  try { const runtime = await getServerlessRuntime(); if (!runtime.outbox) throw new Error(); await runtime.outbox.process(input as never); }
  catch { throw new AppError('QUEUE_JOB_FAILED', 503); }
});
