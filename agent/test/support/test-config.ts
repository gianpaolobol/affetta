import path from 'node:path';
import type { AgentConfig } from '../../src/config.js';

export function testConfig(root: string, cloudBaseUrl: string, localBaseUrl: string): AgentConfig {
  const cloudHost = new URL(cloudBaseUrl).host.toLowerCase();
  return {
    cloudBaseUrl,
    localBaseUrl,
    localApiKey: 'local-admin-token',
    pairingCode: 'pair-code',
    agentName: 'Test Agent',
    dataDir: root,
    downloadDir: path.join(root, 'downloads'),
    uploadDir: path.join(root, 'uploads'),
    logDir: path.join(root, 'logs'),
    databasePath: path.join(root, 'agent.db'),
    secretKeyPath: path.join(root, 'secret.key'),
    pidPath: path.join(root, 'agent.pid'),
    artifactAllowedHosts: new Set([cloudHost]),
    pollMs: 5,
    heartbeatMs: 50,
    leaseRenewMs: 25,
    httpTimeoutMs: 5000,
    localJobTimeoutMs: 5000,
    maxDownloadBytes: 1024 * 1024,
    allowInsecureHttp: true
  };
}
