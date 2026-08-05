# Affetta OctoBridge Lab V2

Pacchetto riscritto da zero per configurare **un Raspberry Pi per una singola
unità fisica seriale del laboratorio**, assegnandole:

- ID fisico Affetta;
- nome leggibile;
- hostname `.local`;
- bridge ID univoco;
- profilo macchina;
- token dedicato;
- registrazione Server Lite;
- porta seriale stabile, quando disponibile;
- servizio systemd isolato;
- comunicazione bidirezionale Affetta ↔ OctoBridge.

## Modello bidirezionale

La bidirezionalità è realizzata senza rendere il Raspberry dipendente dalla
presenza continua del server:

```text
Affetta Server Lite → OctoBridge
  upload G-code, verifica, transfer, start, pause, resume, cancel

OctoBridge → Affetta Server Lite
  risposte API, stato reale, progressione, temperature, eventi,
  snapshot, pending-sync e riconciliazione
```

Il Server Lite interroga periodicamente il bridge. Non è necessario un push
continuo dal Raspberry: alla riaccensione di Affetta il server riprende a
leggere stato ed eventi. Questo conserva il comportamento local-first e
store-and-forward.

## Unità seriali con installer dedicato

- `taz-01` — LulzBot TAZ 4
- `taz-02` — LulzBot TAZ 5
- `taz-03` — LulzBot TAZ 6
- `mini-01` — LulzBot Mini A
- `mini-02` — LulzBot Mini B
- `wasp-2040-01` — Delta WASP 2040 1
- `wasp-2040-02` — Delta WASP 2040 2
- `wasp-2040-03` — Delta WASP 2040 3
- `wasp-turbo-01` — Delta WASP 2040 Turbo 1
- `wasp-turbo-02` — Delta WASP 2040 Turbo 2
- `predator-01` — Anycubic Predator 1
- `predator-02` — Anycubic Predator 2

Il pool Prusa non ha ancora unità fisiche censite. Per questo esiste un
installer parametrico, che obbliga a scegliere un numero univoco.

## Macchine escluse da OctoBridge seriale

Non usare questi installer per:

- Bambu Lab X1C: adapter LAN Bambu;
- Snapmaker U1: adapter LAN Snapmaker;
- FLSUN V400: Moonraker/Klipper;
- Thing-O-Matic: X3G e flusso GPX separato;
- Phrozen Sonic Mini 4K: flusso resina separato.

## Prerequisiti sul Raspberry

- Linux con systemd;
- Python 3.7 o superiore;
- OctoPrint già installato e raggiungibile su `127.0.0.1:5000`;
- API key OctoPrint;
- accesso a Internet per clonare Affetta, oppure clone Affetta copiato sul Pi;
- mDNS/Avahi consigliato;
- collegamento USB dati affidabile.

Gli script sono compatibili sintatticamente con Python 3.7 e non usano
l’heredoc Python interpolato che rendeva fragili i precedenti installer.

## Installazione

Copiare l’intero pacchetto sul Raspberry e lanciare lo script della macchina:

```bash
cd AFFETTA_OCTOBRIDGE_LAB_V2
sudo bash installers/install-predator-01.sh
```

Per usare un clone Affetta già copiato sul Pi:

```bash
sudo bash installers/install-predator-01.sh \
  --affetta-source /home/pi/affetta
```

Per una porta seriale specifica:

```bash
sudo bash installers/install-predator-01.sh \
  --serial-port /dev/serial/by-id/usb-...
```

L’installer non abilita automaticamente la stampa. Per il collaudo:

```bash
sudo bash installers/install-predator-01.sh \
  --enable-experimental-printing
```

Anche in questo caso rimane:

```text
release_channel=experimental
production_ready=false
```

## Prusa i3 autocostruite

Dopo aver numerato fisicamente ogni unità:

```bash
sudo bash installers/install-prusa-i3-autocostruita.sh \
  --unit 01 \
  --name "Prusa i3 autocostruita 01"
```

## Registrazione in Affetta Server Lite

Sul Raspberry:

```bash
sudo bash lib/export-registration.sh
```

Copiare tutti i file `*.server-lite-registration.json` in una cartella del PC
Affetta, quindi aprire PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass

.\server-lite\Import-AffettaOctoBridgeRegistrations.ps1 `
  -SourceDirectory 'C:\Users\LUISA\Downloads\registrazioni-octobridge'
```

Avvio Server Lite con caricamento dei token:

```powershell
.\server-lite\Start-AffettaServerLite-WithBridges.ps1
```

Test di tutti i bridge:

```powershell
.\server-lite\Test-AffettaOctoBridgeFleet.ps1
```

## Sicurezza

- token bridge diverso per ogni macchina;
- chiavi non incluse nei manifest;
- config `root:octobridge 0640`;
- token Server Lite conservati in `C:\AFFETTA_RUNTIME\secrets`;
- OctoPrint resta sul loopback;
- nessun TLS: usare soltanto LAN privata;
- nessun `production_ready=true` automatico;
- nessun `WatchdogSec` fittizio;
- systemd usa `Wants=octoprint.service`, non una dipendenza forte `Requires=`;
- scritture JSON atomiche.

## Diagnostica

```bash
sudo bash lib/diagnostics.sh
journalctl -u affetta-octobridge -f
curl http://localhost:8792/health
```

## Attivazione sperimentale successiva

```bash
sudo bash lib/enable-experimental-printing.sh
```

Richiede di digitare il bridge ID esatto. Non promuove mai la macchina a
produzione.

## P4.4.2 — Software readiness prima delle microSD

Il pacchetto include ora un simulatore OctoPrint deterministico e una suite
end-to-end che usa il codice reale presente in `octobridge-zero` e
`server-lite`.

Su Windows, dal repository Affetta:

```powershell
Set-ExecutionPolicy -Scope Process Bypass

.\deployment\octobridge-lab-v2\tests\Invoke-AffettaOctoBridgeReadiness.ps1 `
  -RepoRoot 'C:\AFFETTA_GITHUB_0412' `
  -RuntimeRoot 'C:\AFFETTA_RUNTIME'
```

La suite verifica:

- autenticazione OctoPrint e Bearer token OctoBridge;
- upload multipart e conservazione byte-per-byte;
- dimensione e SHA-256 locale/remoto;
- errore di checksum e retry;
- transfer, start, pausa, ripresa e annullamento;
- completamento e fallimento;
- pending-sync e acknowledge;
- completamento mentre Affetta è spento;
- riavvio del bridge e riconciliazione;
- OctoPrint irraggiungibile senza perdita dell’API bridge;
- adapter Server Lite reale;
- test Python, Node e inventario di laboratorio;
- assenza di `production_ready=true` e segreti evidenti.

I report vengono salvati in:

```text
C:\AFFETTA_RUNTIME\reports\octobridge-readiness
```

Il workflow da installare come
`.github/workflows/octobridge-readiness.yml` ripete gli stessi test su GitHub,
inclusa una verifica dedicata in Python 3.7.

### Simulatore manuale

```powershell
.\deployment\octobridge-lab-v2\simulator\Start-FakeOctoPrint.ps1
```

Il simulatore ascolta solo su `127.0.0.1` e non deve essere usato come server
reale di stampa.

### Preparazione SD

```powershell
.\deployment\octobridge-lab-v2\images\Prepare-AffettaSdPlan.ps1
```

La cartella runtime generata contiene matrice immagine, assegnazioni nodi ed
etichette. Il collaudo fisico resta obbligatorio e nessun test software imposta
`production_ready=true`.
