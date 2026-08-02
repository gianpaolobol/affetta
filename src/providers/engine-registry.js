import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config, ROOT } from '../config.js';
import { splitCommand } from '../utils.js';

const cache = new Map();

function existing(paths) {
  return paths.filter(Boolean).find((candidate) => {
    try { return fs.existsSync(candidate) && fs.statSync(candidate).isFile(); } catch { return false; }
  }) || null;
}


function resolveExecutable(value) {
  const command = String(value || '').trim();
  if (!command) return null;
  if (/[\\/]/.test(command) || path.isAbsolute(command)) return existing([command]);
  const pathDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  for (const dir of pathDirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, process.platform === 'win32' && !path.extname(command) ? `${command}${extension}` : command);
      const found = existing([candidate]);
      if (found) return found;
    }
  }
  return null;
}

function findExecutableRecursive(root, names, maxDepth = 4) {
  if (!root || !fs.existsSync(root)) return null;
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && wanted.has(entry.name.toLowerCase())) return full;
      if (entry.isDirectory() && depth < maxDepth) stack.push({ dir: full, depth: depth + 1 });
    }
  }
  return null;
}

function listMatchingDirs(root, patterns) {
  if (!root || !fs.existsSync(root)) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && patterns.some((pattern) => entry.name.toLowerCase().includes(pattern)))
      .map((entry) => path.join(root, entry.name));
  } catch { return []; }
}

function windowsCandidates(engine) {
  const pf = process.env.ProgramFiles || process.env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  if (engine === 'prusa') {
    return [
      path.join(ROOT, 'runtime', 'engines', 'prusa', 'prusa-slicer-console.exe'),
      path.join(ROOT, 'runtime', 'engines', 'prusa', 'PrusaSlicer', 'prusa-slicer-console.exe'),
      path.join(pf, 'Prusa3D', 'PrusaSlicer', 'prusa-slicer-console.exe'),
      path.join(pf, 'PrusaSlicer', 'prusa-slicer-console.exe'),
      path.join(pf86, 'Prusa3D', 'PrusaSlicer', 'prusa-slicer-console.exe'),
      path.join(local, 'Programs', 'PrusaSlicer', 'prusa-slicer-console.exe')
    ];
  }
  if (engine === 'cura') {
    const dirs = [...listMatchingDirs(pf, ['ultimaker cura', 'cura']), ...listMatchingDirs(pf86, ['ultimaker cura', 'cura'])];
    return [
      path.join(ROOT, 'runtime', 'engines', 'cura', 'CuraEngine.exe'),
      ...dirs.flatMap((dir) => [path.join(dir, 'CuraEngine.exe'), path.join(dir, 'bin', 'CuraEngine.exe')])
    ];
  }
  if (engine === 'orca') {
    return [
      path.join(ROOT, 'runtime', 'engines', 'orca', 'orca-slicer.exe'),
      path.join(ROOT, 'runtime', 'engines', 'orca', 'OrcaSlicer.exe'),
      path.join(ROOT, 'runtime', 'engines', 'orca', 'OrcaSlicer', 'orca-slicer.exe'),
      path.join(pf, 'OrcaSlicer', 'orca-slicer.exe'),
      path.join(pf, 'OrcaSlicer', 'OrcaSlicer.exe'),
      path.join(pf86, 'OrcaSlicer', 'orca-slicer.exe'),
      path.join(local, 'Programs', 'OrcaSlicer', 'orca-slicer.exe'),
      path.join(local, 'Programs', 'OrcaSlicer', 'OrcaSlicer.exe'),
      path.join(local, 'OrcaSlicer', 'orca-slicer.exe'),
      path.join(local, 'OrcaSlicer', 'OrcaSlicer.exe')
    ];
  }
  if (engine === 'snapmaker_orca') {
    return [
      path.join(ROOT, 'runtime', 'engines', 'snapmaker_orca', 'snapmaker-orca.exe'),
      path.join(ROOT, 'runtime', 'engines', 'snapmaker_orca', 'Snapmaker_Orca_Windows_V2.3.5_portable', 'snapmaker-orca.exe'),
      path.join(pf, 'Snapmaker Orca', 'snapmaker-orca.exe'),
      path.join(pf86, 'Snapmaker Orca', 'snapmaker-orca.exe'),
      path.join(local, 'Programs', 'Snapmaker Orca', 'snapmaker-orca.exe')
    ];
  }
  if (engine === 'gpx') {
    return [
      path.join(ROOT, 'runtime', 'engines', 'gpx', 'gpx.exe'),
      path.join('C:\\AFFETTA_RUNTIME', 'engines', 'gpx', 'gpx.exe'),
      path.join(pf, 'GPX', 'gpx.exe'),
      path.join(pf86, 'GPX', 'gpx.exe')
    ];
  }
  return [];
}

function posixCandidates(engine) {
  if (engine === 'prusa') return [path.join(ROOT, 'runtime/engines/prusa/prusa-slicer'), '/usr/bin/prusa-slicer', '/usr/local/bin/prusa-slicer'];
  if (engine === 'cura') return [path.join(ROOT, 'runtime/engines/cura/CuraEngine'), '/usr/bin/CuraEngine', '/usr/local/bin/CuraEngine', '/opt/cura/CuraEngine'];
  if (engine === 'orca') return [path.join(ROOT, 'runtime/engines/orca/orca-slicer'), '/usr/bin/orca-slicer', '/usr/local/bin/orca-slicer'];
  if (engine === 'snapmaker_orca') return [path.join(ROOT, 'runtime/engines/snapmaker_orca/snapmaker-orca'), '/usr/bin/snapmaker-orca', '/usr/local/bin/snapmaker-orca'];
  if (engine === 'gpx') return [path.join(ROOT, 'runtime/engines/gpx/gpx'), '/usr/bin/gpx', '/usr/local/bin/gpx'];
  return [];
}

function envCommand(engine) {
  const custom = process.env[`AFFETTA_ENGINE_COMMAND_${engine.toUpperCase()}`];
  if (custom) {
    try {
      const parsed = JSON.parse(custom);
      if (Array.isArray(parsed) && parsed.length) return { command: parsed[0], prefix: parsed.slice(1), custom: true };
    } catch {}
  }
  const directByEngine = {
    prusa: process.env.PRUSA_SLICER_BIN,
    cura: process.env.CURA_ENGINE_BIN,
    orca: process.env.ORCA_SLICER_BIN,
    snapmaker_orca: process.env.SNAPMAKER_ORCA_BIN,
    gpx: process.env.GPX_BIN
  };
  const direct = directByEngine[engine] || null;
  if (direct && direct.trim()) {
    const resolvedDirect = resolveExecutable(direct);
    if (resolvedDirect) return { command: resolvedDirect, prefix: [], custom: false };
  }
  if (engine === 'kiri' && config.kiriCliCommand) {
    const parts = splitCommand(config.kiriCliCommand);
    return parts.length ? { command: parts[0], prefix: parts.slice(1), custom: false } : null;
  }
  if (engine === 'kiri') return null;
  const runtimeRoot = path.join(ROOT, 'runtime', 'engines', engine);
  const runtimeNamesByEngine = process.platform === 'win32'
    ? { prusa: ['prusa-slicer-console.exe'], cura: ['CuraEngine.exe'], orca: ['orca-slicer.exe', 'OrcaSlicer.exe'], snapmaker_orca: ['snapmaker-orca.exe'], gpx: ['gpx.exe'] }
    : { prusa: ['prusa-slicer'], cura: ['CuraEngine'], orca: ['orca-slicer', 'OrcaSlicer'], snapmaker_orca: ['snapmaker-orca'], gpx: ['gpx'] };
  const runtimeNames = runtimeNamesByEngine[engine] || [];
  const found = existing(process.platform === 'win32' ? windowsCandidates(engine) : posixCandidates(engine)) || findExecutableRecursive(runtimeRoot, runtimeNames);
  return found ? { command: found, prefix: [], custom: false } : null;
}

function findDirUp(start, candidates) {
  let current = path.dirname(start);
  for (let depth = 0; depth < 7; depth++) {
    for (const relative of candidates) {
      const candidate = path.resolve(current, relative);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
      } catch {}
    }
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return null;
}

function findDirectoryRecursive(root, directoryName, markerFile, maxDepth = 12) {
  if (!root || !fs.existsSync(root)) return null;
  const stack = [{ dir: root, depth: 0 }];
  const wanted = directoryName.toLowerCase();
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    if (path.basename(dir).toLowerCase() === wanted) {
      const marker = markerFile ? path.join(dir, markerFile) : null;
      if (!marker || fs.existsSync(marker)) return dir;
    }
    if (depth >= maxDepth) continue;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (/^(?:cache|logs?|temp|tmp|translations?)$/i.test(entry.name)) continue;
      stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return null;
}

function uniqueExistingRoots(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value) return false;
    const resolved = path.resolve(value);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key) || !fs.existsSync(resolved)) return false;
    seen.add(key);
    return true;
  });
}

function resourcesFor(engine, command) {
  if (!command || !/[\\/]/.test(command)) return {};
  if (engine === 'cura') {
    let definitions = findDirUp(command, [
      'share/cura/resources/definitions', 'resources/definitions', '../share/cura/resources/definitions', '../resources/definitions'
    ]);
    if (!definitions) {
      const runtimeRoot = path.join(ROOT, 'runtime', 'engines', 'cura');
      const commandDir = path.dirname(command);
      const roots = uniqueExistingRoots([
        runtimeRoot,
        commandDir,
        path.dirname(commandDir),
        path.dirname(path.dirname(commandDir)),
        path.dirname(path.dirname(path.dirname(commandDir)))
      ]);
      for (const root of roots) {
        definitions = findDirectoryRecursive(root, 'definitions', 'fdmprinter.def.json');
        if (definitions) break;
      }
    }
    return { definitions };
  }
  if (engine === 'orca' || engine === 'snapmaker_orca') {
    let profiles = findDirUp(command, ['resources/profiles', '../resources/profiles', 'profiles']);
    if (!profiles) {
      const runtimeRoot = path.join(ROOT, 'runtime', 'engines', engine);
      profiles = findDirectoryRecursive(runtimeRoot, 'profiles', null);
    }
    return { profiles };
  }
  return {};
}

function runProbe(command, args, timeoutMs = 7000) {
  return new Promise((resolve) => {
    if (!command) return resolve({ available: false, detail: 'Comando non configurato.' });
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let output = '';
    child.stdout?.on('data', (d) => { output += d; });
    child.stderr?.on('data', (d) => { output += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ available: false, detail: error.code === 'ENOENT' ? 'Eseguibile non trovato.' : error.message, output });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ available: code === 0 || Boolean(output.trim()), detail: output.trim().slice(0, 600) || `Codice uscita ${code}`, output, code });
    });
  });
}

function extractVersion(output = '') {
  return output.match(/(?:PrusaSlicer|OrcaSlicer|Snapmaker[ _-]?Orca|CuraEngine|GPX|Affetta test slicer)[^0-9]*(\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?)/i)?.[1] || null;
}

export function getEngineInstall(engine, { refresh = false } = {}) {
  if (!refresh && cache.has(engine)) return cache.get(engine);
  const cmd = envCommand(engine);
  const result = cmd ? { engine, ...cmd, resources: resourcesFor(engine, cmd.command) } : { engine, command: null, prefix: [], custom: false, resources: {} };
  cache.set(engine, result);
  return result;
}

export function getEngineCommand(engine) {
  const install = getEngineInstall(engine);
  return install.command ? [install.command, ...install.prefix] : [];
}

export async function probeEngine(engine, { refresh = false } = {}) {
  const install = getEngineInstall(engine, { refresh });
  if (!install.command) return { engine, available: false, configured: false, detail: 'Non configurato.', resources: install.resources };
  let probeArgs = (engine === 'orca' || engine === 'snapmaker_orca' || engine === 'gpx') ? ['--help'] : ['--version'];
  let result = await runProbe(install.command, [...install.prefix, ...probeArgs]);
  if (!result.available && engine !== 'orca' && engine !== 'snapmaker_orca') result = await runProbe(install.command, [...install.prefix, '--help']);
  const resourcesReady = install.custom || (engine === 'cura' ? Boolean(install.resources.definitions) : (engine === 'orca' || engine === 'snapmaker_orca') ? Boolean(install.resources.profiles) : true);
  return {
    engine,
    configured: true,
    available: result.available,
    resources_ready: resourcesReady,
    version: extractVersion(result.output || result.detail),
    command: install.command,
    resources: install.resources,
    detail: result.detail
  };
}

export async function systemCapabilities(printers, { refresh = false } = {}) {
  const engines = ['kiri', 'prusa', 'cura', 'orca', 'snapmaker_orca', 'gpx'];
  const results = Object.fromEntries(await Promise.all(engines.map(async (engine) => [engine, await probeEngine(engine, { refresh })])));
  const fffPrinters = Object.entries(printers).filter(([, printer]) => (printer.technology || 'fff') === 'fff');
  const manualProcesses = Object.fromEntries(Object.entries(printers)
    .filter(([, printer]) => (printer.technology || 'fff') !== 'fff')
    .map(([id, printer]) => [id, {
      technology: printer.technology,
      profile_status: printer.status,
      slicer: printer.resin?.slicer || printer.engines?.[0] || null,
      output_format: printer.output_format || printer.resin?.output_format || null
    }]));
  const printerCapabilities = Object.fromEntries(fffPrinters.map(([id, printer]) => {
    const routes = printer.engines.map((engine) => ({
      engine,
      available: Boolean(results[engine]?.available),
      resources_ready: results[engine]?.resources_ready !== false
    }));
    const postprocessor = printer.postprocess?.engine || null;
    const postprocessReady = !postprocessor || Boolean(results[postprocessor]?.available);
    return [id, {
      slice_available: routes.some((route) => route.available && route.resources_ready) && postprocessReady,
      profile_status: printer.status,
      output_format: printer.output_format || 'gcode',
      postprocessor: postprocessor ? {
        engine: postprocessor,
        available: Boolean(results[postprocessor]?.available)
      } : null,
      routes: routes.map(({ engine, available, resources_ready }) => ({ engine, available, resources_ready }))
    }];
  }));
  return {
    estimate: {
      slicer_available: Boolean(results.kiri.available),
      geometry_fallback: config.allowGeometryFallback,
      ready: Boolean(results.kiri.available || config.allowGeometryFallback)
    },
    slicing: {
      ready_printers: Object.values(printerCapabilities).filter((p) => p.slice_available).length,
      total_printers: Object.keys(printerCapabilities).length,
      printers: printerCapabilities
    },
    manual_processes: manualProcesses,
    engines: results
  };
}
