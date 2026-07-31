import { round } from './utils.js';

function emptyStats() {
  return {
    triangles: 0,
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
    signedVolume: 0,
    surfaceArea: 0
  };
}

function updateStats(stats, a, b, c) {
  for (const v of [a, b, c]) {
    for (let i = 0; i < 3; i++) {
      stats.min[i] = Math.min(stats.min[i], v[i]);
      stats.max[i] = Math.max(stats.max[i], v[i]);
    }
  }
  const cross = [
    b[1] * c[2] - b[2] * c[1],
    b[2] * c[0] - b[0] * c[2],
    b[0] * c[1] - b[1] * c[0]
  ];
  stats.signedVolume += (a[0] * cross[0] + a[1] * cross[1] + a[2] * cross[2]) / 6;

  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const areaCross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  ];
  stats.surfaceArea += Math.hypot(...areaCross) / 2;
  stats.triangles += 1;
}

function isBinaryStl(buffer) {
  if (buffer.length < 84) return false;
  const count = buffer.readUInt32LE(80);
  return 84 + count * 50 === buffer.length;
}

function parseBinary(buffer) {
  const stats = emptyStats();
  const count = buffer.readUInt32LE(80);
  let offset = 84;
  for (let i = 0; i < count; i++, offset += 50) {
    const a = [buffer.readFloatLE(offset + 12), buffer.readFloatLE(offset + 16), buffer.readFloatLE(offset + 20)];
    const b = [buffer.readFloatLE(offset + 24), buffer.readFloatLE(offset + 28), buffer.readFloatLE(offset + 32)];
    const c = [buffer.readFloatLE(offset + 36), buffer.readFloatLE(offset + 40), buffer.readFloatLE(offset + 44)];
    updateStats(stats, a, b, c);
  }
  return stats;
}

function parseAscii(buffer) {
  const text = buffer.toString('utf8');
  const values = [];
  const regex = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let match;
  while ((match = regex.exec(text))) {
    values.push([Number(match[1]), Number(match[2]), Number(match[3])]);
  }
  if (values.length < 3 || values.length % 3 !== 0) {
    throw new Error('STL ASCII non valido o privo di triangoli.');
  }
  const stats = emptyStats();
  for (let i = 0; i < values.length; i += 3) updateStats(stats, values[i], values[i + 1], values[i + 2]);
  return stats;
}

export function analyzeStl(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) throw new Error('File STL vuoto o non valido.');
  const stats = isBinaryStl(buffer) ? parseBinary(buffer) : parseAscii(buffer);
  const size = stats.max.map((max, i) => max - stats.min[i]);
  const volume = Math.abs(stats.signedVolume);
  const warnings = [];
  if (!Number.isFinite(volume) || volume <= 0.001) warnings.push('Volume chiuso non rilevato: il modello potrebbe essere aperto o non manifold.');
  if (size.some((v) => !Number.isFinite(v) || v <= 0)) warnings.push('Dimensioni del modello non valide.');
  return {
    format: isBinaryStl(buffer) ? 'stl-binary' : 'stl-ascii',
    triangles: stats.triangles,
    bounds_mm: {
      min: stats.min.map((v) => round(v, 3)),
      max: stats.max.map((v) => round(v, 3)),
      size: size.map((v) => round(v, 3))
    },
    volume_mm3: round(volume, 3),
    surface_area_mm2: round(stats.surfaceArea, 3),
    warnings
  };
}

function readTriangles(buffer) {
  if (isBinaryStl(buffer)) {
    const count = buffer.readUInt32LE(80);
    const triangles = [];
    let offset = 84;
    for (let i = 0; i < count; i++, offset += 50) {
      triangles.push({
        normal: [buffer.readFloatLE(offset), buffer.readFloatLE(offset + 4), buffer.readFloatLE(offset + 8)],
        vertices: [
          [buffer.readFloatLE(offset + 12), buffer.readFloatLE(offset + 16), buffer.readFloatLE(offset + 20)],
          [buffer.readFloatLE(offset + 24), buffer.readFloatLE(offset + 28), buffer.readFloatLE(offset + 32)],
          [buffer.readFloatLE(offset + 36), buffer.readFloatLE(offset + 40), buffer.readFloatLE(offset + 44)]
        ]
      });
    }
    return triangles;
  }
  const text = buffer.toString('utf8');
  const vertices = [];
  const regex = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let match;
  while ((match = regex.exec(text))) vertices.push([Number(match[1]), Number(match[2]), Number(match[3])]);
  if (vertices.length < 3 || vertices.length % 3 !== 0) throw new Error('STL ASCII non valido o privo di triangoli.');
  const triangles = [];
  for (let i = 0; i < vertices.length; i += 3) triangles.push({ normal: [0, 0, 0], vertices: [vertices[i], vertices[i + 1], vertices[i + 2]] });
  return triangles;
}

function writeBinaryTriangles(triangles, headerText = 'Affetta arranged STL') {
  const output = Buffer.alloc(84 + triangles.length * 50);
  output.fill(0, 0, 80);
  output.write(headerText.slice(0, 80), 0, 'ascii');
  output.writeUInt32LE(triangles.length, 80);
  let offset = 84;
  for (const triangle of triangles) {
    for (let i = 0; i < 3; i++) output.writeFloatLE(Number(triangle.normal?.[i]) || 0, offset + i * 4);
    let cursor = offset + 12;
    for (const vertex of triangle.vertices) {
      for (let i = 0; i < 3; i++, cursor += 4) output.writeFloatLE(Number(vertex[i]) || 0, cursor);
    }
    output.writeUInt16LE(0, offset + 48);
    offset += 50;
  }
  return output;
}

/**
 * Duplica un STL su una griglia centrata. Restituisce un unico STL binario.
 * È intenzionalmente prudente: tutte le copie devono stare su un solo piano.
 */
export function arrangeStlCopies(buffer, quantity, buildMm, { spacingMm = 5, maxTriangles = 5_000_000 } = {}) {
  const units = Math.max(1, Math.trunc(Number(quantity) || 1));
  const analysis = analyzeStl(buffer);
  if (units === 1) return { buffer, analysis, layout: { quantity: 1, columns: 1, rows: 1, spacing_mm: 0 } };
  const [sizeX, sizeY, sizeZ] = analysis.bounds_mm.size;
  if (![sizeX, sizeY, sizeZ].every((value) => Number.isFinite(value) && value > 0)) throw new Error('Dimensioni STL non valide per la disposizione multipla.');
  const [buildX, buildY, buildZ] = buildMm;
  if (sizeZ > buildZ + 0.01) throw Object.assign(new Error('Il modello supera l’altezza utile della stampante.'), { code: 'model_too_large', statusCode: 422 });

  let best = null;
  for (let columns = 1; columns <= units; columns++) {
    const rows = Math.ceil(units / columns);
    const width = columns * sizeX + (columns - 1) * spacingMm;
    const depth = rows * sizeY + (rows - 1) * spacingMm;
    if (width <= buildX + 0.01 && depth <= buildY + 0.01) {
      const score = Math.max(width / buildX, depth / buildY) + Math.abs(columns - rows) * 0.001;
      if (!best || score < best.score) best = { columns, rows, width, depth, score };
    }
  }
  if (!best) {
    throw Object.assign(new Error(`Le ${units} copie non entrano tutte sul piano selezionato. Riduci la quantità o scegli una stampante più grande.`), { code: 'quantity_does_not_fit', statusCode: 422 });
  }

  const source = readTriangles(buffer);
  if (source.length * units > maxTriangles) throw Object.assign(new Error('La quantità richiesta produrrebbe un file troppo complesso.'), { code: 'arrangement_too_complex', statusCode: 422 });
  const translated = [];
  const min = analysis.bounds_mm.min;
  const originX = -best.width / 2;
  const originY = -best.depth / 2;
  for (let index = 0; index < units; index++) {
    const column = index % best.columns;
    const row = Math.floor(index / best.columns);
    const tx = originX + column * (sizeX + spacingMm) - min[0];
    const ty = originY + row * (sizeY + spacingMm) - min[1];
    const tz = -min[2];
    for (const triangle of source) {
      translated.push({
        normal: triangle.normal,
        vertices: triangle.vertices.map(([x, y, z]) => [x + tx, y + ty, z + tz])
      });
    }
  }
  const arranged = writeBinaryTriangles(translated, `Affetta ${units} copies`);
  return {
    buffer: arranged,
    analysis: analyzeStl(arranged),
    layout: {
      quantity: units,
      columns: best.columns,
      rows: best.rows,
      spacing_mm: spacingMm,
      footprint_mm: [round(best.width, 3), round(best.depth, 3), round(sizeZ, 3)]
    }
  };
}
