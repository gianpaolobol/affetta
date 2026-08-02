import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackendError } from './errors.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(moduleDir, '..', '..', 'public', 'beta');
const assets = new Map<string, { contentType: string; filename: string }>([
  ['/beta', { contentType: 'text/html; charset=utf-8', filename: 'index.html' }],
  ['/beta/', { contentType: 'text/html; charset=utf-8', filename: 'index.html' }],
  ['/beta/app.js', { contentType: 'text/javascript; charset=utf-8', filename: 'app.js' }],
  ['/beta/styles.css', { contentType: 'text/css; charset=utf-8', filename: 'styles.css' }]
]);
const cache = new Map<string, string>();

export async function readBetaAsset(requestPath: string): Promise<{ contentType: string; body: string } | null> {
  const asset = assets.get(requestPath);
  if (!asset) return null;
  let body = cache.get(asset.filename);
  if (body === undefined) {
    try { body = await fs.readFile(path.join(publicDir, asset.filename), 'utf8'); }
    catch (error) {
      throw new BackendError('beta_asset_missing', 'Risorsa web beta non disponibile.', {
        statusCode: 500, details: { filename: asset.filename, reason: error instanceof Error ? error.message : String(error) }
      });
    }
    cache.set(asset.filename, body);
  }
  return { contentType: asset.contentType, body };
}
