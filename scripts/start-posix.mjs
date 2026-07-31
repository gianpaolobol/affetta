import { spawn } from 'node:child_process';
import process from 'node:process';

const port = Number(process.env.AFFETTA_PORT || 8787);
const host = '127.0.0.1';
const url = `http://${host}:${port}`;
const child = spawn(process.execPath, ['bootstrap.js'], { stdio: 'inherit', env: process.env });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitReady() {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode != null) throw new Error(`Affetta si è arrestato con codice ${child.exitCode}.`);
    try {
      const response = await fetch(`${url}/api/v1/health`);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('Affetta non ha risposto al controllo di avvio.');
}

function openBrowser() {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const opener = spawn(command, [url], { stdio: 'ignore', detached: true });
  opener.on('error', () => console.log(`Apri manualmente ${url}`));
  opener.unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
try {
  await waitReady();
  console.log(`Affetta è pronto: ${url}`);
  openBrowser();
  await new Promise((resolve) => child.once('exit', resolve));
} catch (error) {
  child.kill('SIGTERM');
  console.error(error.message);
  process.exitCode = 1;
}
