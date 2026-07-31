import path from 'node:path';
import { config } from './config.js';
import { createJsonStore } from './store.js';

export const quoteStore = createJsonStore(path.join(config.dataDir, 'quotes.json'), 'quotes');
