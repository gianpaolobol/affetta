import { loadConfig } from './config.js';
import { createBackendRuntime } from './factory.js';
import { createNodeServer } from './http.js';

const config = loadConfig();
const runtime = await createBackendRuntime(config);
const server = createNodeServer(runtime.api, config.maxJsonBytes);

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(config.port, config.host, () => resolve());
});

console.log(JSON.stringify({
  time: new Date().toISOString(),
  level: 'info',
  event: 'backend_started',
  host: config.host,
  port: config.port,
  mode: config.mode
}));

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ time: new Date().toISOString(), level: 'info', event: 'backend_stopping', signal }));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await runtime.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}
