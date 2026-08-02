import { loadConfig } from './config.js';
import { AgentDatabase } from './db.js';
import { CloudClient } from './cloud-client.js';
import { LocalAffettaClient } from './local-affetta-client.js';
import { Logger } from './logger.js';
import { AgentService } from './agent-service.js';
import { normalizeAgentError } from './errors.js';
import { PidLock } from './pid-lock.js';

const config = loadConfig();
const logger = new Logger(config);
const pidLock = PidLock.acquire(config.pidPath);
const database = await AgentDatabase.open(config.databasePath, config.secretKeyPath);
const cloud = new CloudClient(config, database.getCredentials());
const local = new LocalAffettaClient(config);
const service = new AgentService(config, database, cloud, local, logger);
const once = process.argv.includes('--once');

const stop = (signal: string): void => {
  logger.info('shutdown_requested', { signal });
  service.stop();
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

try {
  await service.start({ once });
} catch (error) {
  logger.error('agent_fatal_error', { error: normalizeAgentError(error, 'startup') });
  process.exitCode = 1;
} finally {
  database.close();
  pidLock.release();
}
