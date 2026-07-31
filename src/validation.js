import { catalogs, config } from './config.js';
import { safeFilename } from './utils.js';

function requiredCatalogValue(catalog, value, field) {
  if (!catalog[value]) throw Object.assign(new Error(`${field} non valido.`), { statusCode: 400, code: 'invalid_option' });
  return value;
}

export function decodeModelPayload(body) {
  if (!body || typeof body !== 'object') throw Object.assign(new Error('Payload JSON mancante.'), { statusCode: 400 });
  const filename = safeFilename(body.filename || 'model.stl');
  if (!filename.toLowerCase().endsWith('.stl')) throw Object.assign(new Error('La versione standalone 0.2 accetta file STL.'), { statusCode: 415, code: 'unsupported_file_type' });
  if (typeof body.file_base64 !== 'string' || !body.file_base64) throw Object.assign(new Error('file_base64 è obbligatorio.'), { statusCode: 400 });
  let buffer;
  try { buffer = Buffer.from(body.file_base64.replace(/^data:.*?;base64,/, ''), 'base64'); }
  catch { throw Object.assign(new Error('Contenuto base64 non valido.'), { statusCode: 400 }); }
  if (!buffer.length) throw Object.assign(new Error('File vuoto.'), { statusCode: 400 });
  if (buffer.length > config.maxFileBytes) throw Object.assign(new Error('File troppo grande.'), { statusCode: 413 });
  return { filename, buffer };
}

export function validateQuoteOptions(body) {
  return {
    material_id: requiredCatalogValue(catalogs.materials, body.material_id || 'pla', 'material_id'),
    quality_id: requiredCatalogValue(catalogs.qualities, body.quality_id || 'standard', 'quality_id'),
    strength_id: requiredCatalogValue(catalogs.strengths, body.strength_id || 'standard', 'strength_id'),
    color_id: requiredCatalogValue(catalogs.colors, body.color_id || 'random', 'color_id'),
    custom_color: body.color_id === 'custom' ? String(body.custom_color || '').trim().slice(0, 80) : null,
    quantity: Math.max(1, Math.min(999, Number.parseInt(body.quantity || '1', 10) || 1)),
    pricing_mode: typeof body.pricing_mode === 'string' ? body.pricing_mode : null,
    source: String(body.source || 'affetta-public').slice(0, 80),
    external_ref: body.external_ref ? String(body.external_ref).slice(0, 160) : null,
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? Object.fromEntries(Object.entries(body.metadata).slice(0, 20).map(([key, value]) => [String(key).slice(0, 80), String(value).slice(0, 500)])) : {}
  };
}

export function validateSliceOptions(body) {
  const quote = validateQuoteOptions(body);
  if (quote.color_id === 'custom' && !quote.custom_color) throw Object.assign(new Error('Specifica il colore desiderato.'), { statusCode: 400, code: 'custom_color_required' });
  const printerId = body.printer_id || 'generic-reprap-marlin';
  const printer = catalogs.printers[printerId];
  if (!printer) throw Object.assign(new Error('printer_id non valido.'), { statusCode: 400, code: 'invalid_printer' });
  if (printer.materials && !printer.materials.includes(quote.material_id)) throw Object.assign(new Error('Materiale non compatibile con il profilo stampante selezionato.'), { statusCode: 400, code: 'material_not_supported' });
  const nozzle = Number(body.nozzle_mm || printer.default_nozzle || 0.4);
  if (!printer.nozzles.includes(nozzle)) throw Object.assign(new Error('Diametro ugello non previsto dal profilo selezionato.'), { statusCode: 400, code: 'invalid_nozzle' });
  return { ...quote, printer_id: printerId, nozzle_mm: nozzle };
}
