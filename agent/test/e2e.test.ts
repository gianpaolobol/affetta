import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentDatabase } from '../src/db.js';
import { CloudClient } from '../src/cloud-client.js';
import { LocalAffettaClient } from '../src/local-affetta-client.js';
import { Logger } from '../src/logger.js';
import { AgentService } from '../src/agent-service.js';
import { startMockCloud, startMockLocal } from './support/mocks.js';
import { testConfig } from './support/test-config.js';

function removeTestRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
}

async function runAgent(root: string, cloudBaseUrl: string, localBaseUrl: string): Promise<{ db: AgentDatabase; service: AgentService }> {
  const config = testConfig(root, cloudBaseUrl, localBaseUrl);
  for (const directory of [config.dataDir, config.downloadDir, config.uploadDir, config.logDir]) fs.mkdirSync(directory, { recursive: true });
  const db = await AgentDatabase.open(config.databasePath, config.secretKeyPath);
  const cloud = new CloudClient(config, db.getCredentials());
  const local = new LocalAffettaClient(config);
  const service = new AgentService(config, db, cloud, local, new Logger(config));
  await service.start({ once: true });
  return { db, service };
}

test('completa end-to-end un job X3G con checksum, GPX e capability sperimentali', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-agent-e2e-'));
  const local = await startMockLocal();
  const cloud = await startMockCloud();
  const { db } = await runAgent(root, cloud.baseUrl, local.baseUrl);
  t.after(async () => { db.close(); await cloud.close(); await local.close(); removeTestRoot(root); });
  const stored = db.getJob('job_mock_01');
  assert.equal(stored?.state, 'completed');
  assert.equal(local.createCount(), 1);
  assert.deepEqual(cloud.uploaded(), local.output);
  assert.equal(cloud.uploadContentLength(), String(local.output.length));
  const completion = cloud.completedResult() as { result?: { result?: { output_format?: string; postprocessors?: unknown[]; validation?: { valid?: boolean } } } };
  assert.equal(completion.result?.result?.output_format, 'x3g');
  assert.equal(completion.result?.result?.postprocessors?.length, 1);
  assert.equal(completion.result?.result?.validation?.valid, true);
  assert.equal(cloud.heartbeatCount() >= 1, true);
});

test('riprende dopo un upload fallito senza creare un secondo job locale', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-agent-recovery-'));
  const local = await startMockLocal();
  const cloud = await startMockCloud({ failFirstUpload: true });
  const first = await runAgent(root, cloud.baseUrl, local.baseUrl);
  assert.equal(first.db.getJob('job_mock_01')?.state, 'retrying');
  first.db.close();

  const second = await runAgent(root, cloud.baseUrl, local.baseUrl);
  t.after(async () => { second.db.close(); await cloud.close(); await local.close(); removeTestRoot(root); });
  assert.equal(second.db.getJob('job_mock_01')?.state, 'completed');
  assert.equal(local.createCount(), 1);
  assert.deepEqual(cloud.uploaded(), local.output);
  assert.equal(cloud.uploadContentLength(), String(local.output.length));
  assert.equal(cloud.failCount(), 1);
});

test('revoca le credenziali locali quando il backend revoca l’Agent', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-agent-revoked-'));
  const local = await startMockLocal();
  const cloud = await startMockCloud({ revokeHeartbeat: true });
  const config = testConfig(root, cloud.baseUrl, local.baseUrl);
  for (const directory of [config.dataDir, config.downloadDir, config.uploadDir, config.logDir]) fs.mkdirSync(directory, { recursive: true });
  const db = await AgentDatabase.open(config.databasePath, config.secretKeyPath);
  t.after(async () => { db.close(); await cloud.close(); await local.close(); removeTestRoot(root); });
  const client = new CloudClient(config, db.getCredentials());
  const service = new AgentService(config, db, client, new LocalAffettaClient(config), new Logger(config));
  await assert.rejects(service.start({ once: true }), /revocato/i);
  assert.equal(db.getCredentials(), null);
});
