import { loadConfig } from './config.js';
import { AgentDatabase } from './db.js';
import { LocalAffettaClient } from './local-affetta-client.js';
import { collectCapabilities } from './capabilities.js';
import { normalizeAgentError } from './errors.js';

const config = loadConfig();
const database = await AgentDatabase.open(config.databasePath, config.secretKeyPath);
const local = new LocalAffettaClient(config);
const credentials = database.getCredentials();
const report: Record<string, unknown> = {
  generated_at: new Date().toISOString(),
  configuration: {
    cloud_origin: new URL(config.cloudBaseUrl).origin,
    local_origin: new URL(config.localBaseUrl).origin,
    data_dir: config.dataDir,
    artifact_allowed_hosts: [...config.artifactAllowedHosts].sort(),
    insecure_http_enabled: config.allowInsecureHttp
  },
  paired: Boolean(credentials),
  agent_id: credentials?.agent_id ?? null,
  database: database.summary()
};
try {
  report.local_health = await local.getHealth();
  if (credentials) report.capabilities = await collectCapabilities(config, database, local, credentials.agent_id);
} catch (error) {
  report.local_error = normalizeAgentError(error, 'diagnostics');
  process.exitCode = 2;
} finally {
  database.close();
}
console.log(JSON.stringify(report, null, 2));
