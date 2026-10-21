import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config';
import { createLocalRuntime } from './runtime';
loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
try {
  const config = readConfig(process.env);
  if (process.env.RUNTIME_MODE && process.env.RUNTIME_MODE !== 'local') throw new Error('USE_SERVERLESS_ENTRYPOINT');
  const knownSecrets = Object.entries(process.env).filter(([key]) => /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(key)).map(([, value]) => value!).filter(Boolean);
  const { app, db, inputs, loop } = await createLocalRuntime(config, knownSecrets);
  loop?.start();
  const server = app.listen(config.port, '127.0.0.1', () => console.info(`API listening on 127.0.0.1:${config.port}; GitHub OAuth ${config.github ? 'configured' : 'not configured'}`));
  const shutdown = () => { loop?.stop(); inputs.dispose(); server.close(() => { void db.$disconnect(); }); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
} catch {
  console.error('SERVER_NOT_READY: check local DB and required environment settings.');
  process.exitCode = 1;
}
