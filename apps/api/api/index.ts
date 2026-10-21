import type { IncomingMessage, ServerResponse } from 'node:http';
import { getServerlessRuntime } from '../src/serverless-runtime';
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try { (await getServerlessRuntime()).app(req, res); }
  catch { res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: { code: 'SERVER_NOT_READY' } })); }
}
