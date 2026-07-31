import path from 'node:path';
import { loadEnvFile } from './src/env.js';
import { installProcessDiagnostics } from './src/runtime-diagnostics.js';

loadEnvFile();
installProcessDiagnostics({ dataDir: path.resolve(process.env.AFFETTA_DATA_DIR || 'data') });
await import('./server.js');
