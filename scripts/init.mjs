import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const force = process.argv.includes('--force');
if (fs.existsSync(envPath) && !force) {
  console.log('.env già presente. Usa npm run init -- --force per rigenerarlo.');
  process.exit(0);
}

const token = () => crypto.randomBytes(24).toString('hex');
const admin = token();
const stampa = token();
const reborn = token();
const content = `# Affetta standalone v0.4.12 — configurazione locale
AFFETTA_PORT=8787
AFFETTA_HOST=127.0.0.1
AFFETTA_PUBLIC_MODE=true
AFFETTA_PUBLIC_BASE_URL=http://127.0.0.1:8787
AFFETTA_MAX_FILE_MB=25
AFFETTA_ALLOWED_ORIGINS=http://127.0.0.1:8787,http://localhost:8787
AFFETTA_ADMIN_TOKEN=${admin}
AFFETTA_API_KEYS=stampa3dbologna:${stampa},reborn:${reborn}
AFFETTA_REQUIRE_KIRI=false
AFFETTA_ALLOW_GEOMETRY_FALLBACK=true
AFFETTA_ALLOW_DEMO_GCODE=false
AFFETTA_EXPOSE_ENGINE_NAMES=false
AFFETTA_ARTIFACT_TTL_HOURS=72
AFFETTA_SESSION_DAYS=30
AFFETTA_EMAIL_VERIFICATION_HOURS=24

# In locale le email vengono salvate in data/mail-outbox.
# Per inviarle realmente imposta AFFETTA_MAIL_MODE=smtp e compila SMTP.
AFFETTA_MAIL_MODE=log
AFFETTA_MAIL_FROM=Affetta <noreply@affetta.local>
AFFETTA_SMTP_HOST=
AFFETTA_SMTP_PORT=587
AFFETTA_SMTP_SECURE=false
AFFETTA_SMTP_USER=
AFFETTA_SMTP_PASS=
AFFETTA_SMTP_HELO=affetta.local

# Motore di stima e motori G-code (da installare e validare prima dell'uso produttivo)
# KIRI_CLI_COMMAND=node /percorso/grid-apps/src/kiri-run/cli
# PRUSA_SLICER_BIN=prusa-slicer
# CURA_ENGINE_BIN=CuraEngine
# ORCA_SLICER_BIN=orca-slicer
# AFFETTA_CURA_DEFINITIONS_DIR=C:\\percorso\\resources\\definitions
# AFFETTA_ORCA_PROFILES_DIR=C:\\percorso\\resources\\profiles
`;
fs.writeFileSync(envPath, content, { mode: 0o600 });
for (const dir of ['data/uploads', 'data/artifacts', 'data/mail-outbox']) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
}
const stores = {
  'users.json': { users: {} },
  'sessions.json': { sessions: {} },
  'verification-tokens.json': { tokens: {} },
  'jobs.json': { jobs: {} },
  'quotes.json': { quotes: {} }
};
for (const [file, initial] of Object.entries(stores)) {
  const target = path.join(root, 'data', file);
  if (!fs.existsSync(target)) fs.writeFileSync(target, `${JSON.stringify(initial, null, 2)}\n`);
}
console.log('Configurazione Affetta v0.4.12 creata in .env');
console.log(`Token amministratore: ${admin}`);
console.log('Modalità email locale attiva: le conferme saranno salvate in data/mail-outbox.');
console.log('Le chiavi partner sono predisposte per le integrazioni future con Stampa3DBologna e Reborn.');
