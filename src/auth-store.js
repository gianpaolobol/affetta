import path from 'node:path';
import { config } from './config.js';
import { createJsonStore } from './store.js';

export const userStore = createJsonStore(path.join(config.dataDir, 'users.json'), 'users');
export const sessionStore = createJsonStore(path.join(config.dataDir, 'sessions.json'), 'sessions');
export const verificationStore = createJsonStore(path.join(config.dataDir, 'verification-tokens.json'), 'tokens');

export function findUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return userStore.list({ limit: 100000 }).find((user) => user.email === normalized) || null;
}

export function findUserByUsername(username) {
  const normalized = String(username || '').trim().toLowerCase();
  return userStore.list({ limit: 100000 }).find((user) => user.username_normalized === normalized) || null;
}
