import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import { config } from './config.js';
import { ensureDir, safeFilename } from './utils.js';

function encodeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value), 'utf8').toString('base64')}?=`;
}

function messageText({ to, subject, html, text }) {
  const boundary = `affetta_${Date.now().toString(36)}`;
  const from = config.mailFrom;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    '',
    `--${boundary}--`,
    ''
  ].join('\r\n');
}

function smtpSession(socket) {
  let buffer = '';
  const waiters = [];
  function flush() {
    while (waiters.length) {
      const lines = buffer.split(/\r?\n/);
      let end = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^\d{3} /.test(lines[i])) { end = i; break; }
      }
      if (end < 0) return;
      const block = lines.slice(0, end + 1).join('\n');
      buffer = lines.slice(end + 1).join('\n');
      waiters.shift()(block);
    }
  }
  socket.on('data', (chunk) => { buffer += chunk.toString('utf8'); flush(); });
  const response = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout SMTP.')), 15000);
    waiters.push((value) => { clearTimeout(timer); resolve(value); });
    flush();
  });
  const command = async (value, expected = /^[23]/) => {
    if (value != null) socket.write(`${value}\r\n`);
    const reply = await response();
    if (!expected.test(reply)) throw new Error(`Errore SMTP: ${reply.slice(0, 500)}`);
    return reply;
  };
  return { response, command };
}

async function connectSocket() {
  const options = { host: config.smtpHost, port: config.smtpPort, servername: config.smtpHost };
  return new Promise((resolve, reject) => {
    const socket = config.smtpSecure ? tls.connect(options, () => resolve(socket)) : net.connect(options, () => resolve(socket));
    socket.setTimeout(20000, () => socket.destroy(new Error('Timeout connessione SMTP.')));
    socket.once('error', reject);
  });
}

async function sendSmtp({ to, subject, html, text }) {
  let socket = await connectSocket();
  let session = smtpSession(socket);
  await session.command(null);
  let hello = await session.command(`EHLO ${config.smtpHelo}`);
  if (!config.smtpSecure && /STARTTLS/i.test(hello)) {
    await session.command('STARTTLS', /^220/);
    socket = await new Promise((resolve, reject) => {
      const secure = tls.connect({ socket, servername: config.smtpHost }, () => resolve(secure));
      secure.once('error', reject);
    });
    session = smtpSession(socket);
    hello = await session.command(`EHLO ${config.smtpHelo}`);
  }
  if (config.smtpUser) {
    const plain = Buffer.from(`\u0000${config.smtpUser}\u0000${config.smtpPass}`).toString('base64');
    await session.command(`AUTH PLAIN ${plain}`, /^235/);
  }
  const fromAddress = config.mailFrom.match(/<([^>]+)>/)?.[1] || config.mailFrom;
  await session.command(`MAIL FROM:<${fromAddress}>`, /^250/);
  await session.command(`RCPT TO:<${to}>`, /^(250|251)/);
  await session.command('DATA', /^354/);
  const payload = messageText({ to, subject, html, text }).replace(/^\./gm, '..');
  socket.write(`${payload}\r\n.\r\n`);
  const dataReply = await session.response();
  if (!/^250/.test(dataReply)) throw new Error(`Errore SMTP DATA: ${dataReply}`);
  try { await session.command('QUIT', /^221/); } catch {}
  socket.end();
  return { mode: 'smtp' };
}

function logMessage({ to, subject, html, text }) {
  ensureDir(config.mailOutboxDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(config.mailOutboxDir, `${stamp}-${safeFilename(to)}.eml`);
  fs.writeFileSync(file, messageText({ to, subject, html, text }), 'utf8');
  return { mode: 'log', file };
}

export async function sendMail(message) {
  if (config.mailMode === 'smtp') {
    if (!config.smtpHost) throw new Error('SMTP non configurato. Imposta AFFETTA_SMTP_HOST.');
    return sendSmtp(message);
  }
  return logMessage(message);
}

export async function sendVerificationEmail({ user, verificationUrl }) {
  const subject = 'Conferma la registrazione ad Affetta';
  const text = `Ciao ${user.name},\n\nconferma il tuo indirizzo email aprendo questo link:\n${verificationUrl}\n\nIl link scade tra ${config.emailVerificationHours} ore.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto"><h1 style="font-size:28px">Affetta</h1><p>Ciao ${escapeHtml(user.name)},</p><p>conferma il tuo indirizzo email per attivare il profilo costi personale.</p><p><a href="${verificationUrl}" style="display:inline-block;padding:13px 20px;background:#ef5b3f;color:#fff;text-decoration:none;border-radius:8px">Conferma email</a></p><p style="font-size:13px;color:#666">Il link scade tra ${config.emailVerificationHours} ore.</p></div>`;
  return sendMail({ to: user.email, subject, text, html });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}
