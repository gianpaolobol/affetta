import path from 'node:path';
import { config } from './config.js';
import { createJsonStore } from './store.js';

export const jobStore = createJsonStore(path.join(config.dataDir, 'jobs.json'), 'jobs');
