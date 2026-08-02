import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { openApiDocument } from '../src/openapi.js';

const version = fs.readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();

test('interfaccia usa un solo flusso e include dashboard/registrazione', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/id="slice-form"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="quote-form"/);
  assert.match(html, /id="dashboard-view"/);
  assert.match(html, /id="register-username"/);
  assert.match(html, /id="register-email"/);
  assert.match(html, /id="register-phone"/);
  assert.match(html, /id="custom-color"/);
  assert.match(html, /id="auto-profile"/);
});

test('viewer è locale e non dipende da CDN', () => {
  const viewer = fs.readFileSync(new URL('../public/viewer.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(viewer, /https?:\/\//);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(viewer, /pointerdown/);
  assert.match(viewer, /wheel/);
  assert.match(viewer, /bedShape === 'circular'/);
  assert.match(viewer, /buildPlateSegments/);
});

test('lista stampanti non espone i profili interni e passa la geometria del piano al viewer', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const catalogBody = server.slice(server.indexOf('function publicCatalog()'), server.indexOf('async function capabilities'));
  assert.doesNotMatch(app, /printers\['auto-lab'\].*value = 'auto-lab'/);
  assert.match(app, /bed_shape: printer\.bed_shape/);
  assert.match(app, /build_diameter_mm: printer\.build_diameter_mm/);
  assert.match(catalogBody, /item\.visibility !== 'internal'/);
  assert.doesNotMatch(catalogBody, /printers\['auto-lab'\] =/);
});

test('OpenAPI mantiene il contratto unificato e gli endpoint futuri', () => {
  const document = openApiDocument();
  assert.equal(document.info.version, version);
  assert.ok(document.paths['/api/v1/affetta-jobs']);
  assert.ok(document.paths['/api/v1/user/pricing-profile']);
  assert.ok(document.paths['/api/v1/auth/register']);
  assert.ok(document.paths['/api/v1/slice-jobs']);
  assert.ok(document.paths['/api/v1/quotes']);
  assert.ok(document.paths['/api/v1/profile-preview']);
});

test('viewer usa un renderer WebGL reale e la build è riconoscibile', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const viewer = fs.readFileSync(new URL('../public/viewer.js', import.meta.url), 'utf8');
  assert.match(html, new RegExp(`v${version.replaceAll('.', '\\.')}`));
  assert.doesNotMatch(html.toLowerCase(), /calcola preventivo/);
  assert.match(viewer, /getContext\('webgl'/);
  assert.match(viewer, /gl\.drawArrays\(gl\.TRIANGLES/);
  assert.match(viewer, /getContext\('2d'/);
  assert.match(viewer, /CanvasFallbackViewer/);
});


test('upload STL viene attivato prima delle chiamate API e non dipende da WebGL', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const initBody = app.slice(app.indexOf('async function init()'), app.indexOf('function populateCatalog'));
  assert.ok(initBody.indexOf('bindEvents()') < initBody.indexOf("api('/api/v1/catalog')"));
  assert.ok(initBody.indexOf('createViewer') < initBody.indexOf("api('/api/v1/catalog')"));
  assert.match(app, /readFileAsArrayBuffer/);
  assert.match(app, /fileInput\.addEventListener\('change'/);
});

test('identità visiva riprende logo e font della v0.2.1', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(html, /class="tagline">Il G-code fatto semplice\./);
  assert.match(css, /brand-mark[\s\S]*border-radius:50%/);
  assert.match(css, /font-family:Georgia/);
});
