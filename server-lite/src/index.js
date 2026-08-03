import { loadServerLiteConfig } from './config.js';
import { ServerLiteDatabase } from './db.js';
import { AdapterRegistry } from './adapter-registry.js';
import { ServerLiteService } from './service.js';
import { createServerLiteHttp } from './http.js';

const config = loadServerLiteConfig();
const db = new ServerLiteDatabase(config.database_path);
const registry = new AdapterRegistry({ timeoutMs: config.request_timeout_ms });
const service = new ServerLiteService({ db, registry, printers: config.printers });
const server = createServerLiteHttp({ service, config });

let polling = null;
let reconciling = false;

async function reconcile(source) {
  if (reconciling) return;
  reconciling = true;
  try {
    const result = await service.reconcileAll(source);
    console.log(`[server-lite] riconciliazione ${source}: ${result.summary.totals.connected}/${result.summary.totals.configured} connesse`);
  } catch (error) {
    console.error('[server-lite] riconciliazione fallita:', error);
  } finally {
    reconciling = false;
  }
}

server.listen(config.port, config.host, async () => {
  console.log(`Affetta Server Lite attivo su http://${config.host}:${config.port}`);
  console.log(`Database locale: ${config.database_path}`);
  await reconcile('startup');
  polling = setInterval(() => reconcile('poll'), config.poll_seconds * 1000);
  polling.unref?.();
});

function shutdown(signal) {
  console.log(`[server-lite] arresto richiesto: ${signal}`);
  if (polling) clearInterval(polling);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
