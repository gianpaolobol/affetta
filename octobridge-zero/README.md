# Affetta OctoBridge Zero Snapshot

**Versione:** `0.1.0-experimental+p4.4`  
**Canale:** `experimental`  
**Stato:** `production_ready: false`  
**Target:** Raspberry Pi Zero V1.3, ARMv6, Raspberry Pi OS Lite 32-bit, adattatore Wi-Fi USB MT7601U, camera CSI.

## Che cos'è

OctoBridge è un controller locale leggero per stampanti FDM seriali. Affetta continua a essere l'unico componente responsabile di:

- modello e profilo della stampante;
- scelta del motore di slicing;
- generazione e validazione del G-code;
- associazione del lavoro alla stampante corretta.

OctoBridge si occupa esclusivamente di:

- ricezione del file già generato;
- verifica di dimensione e SHA-256;
- memorizzazione completa prima dell'avvio;
- trasferimento locale verso OctoPrint senza modificare i byte;
- connessione seriale, avvio, pausa, ripresa e annullamento;
- monitoraggio, eventi, snapshot e sincronizzazione con Affetta.

Non include slicer, plugin di slicing, correzioni del G-code o conversioni di formato.

## Autonomia dal server

Dopo che Affetta ha trasferito il file e OctoBridge ha verificato sia la copia locale sia quella memorizzata da OctoPrint, la stampa può essere avviata. Da quel momento **Affetta Server può essere spento**, mentre il Raspberry Pi Zero deve restare acceso e collegato alla stampante: OctoPrint sul Pi è il controller autonomo che continua il flusso seriale.

Alla riaccensione, Affetta interroga OctoBridge, scarica eventi e immagini non ancora sincronizzati e riconcilia lo stato reale. Quando OctoPrint non fornisce prove sufficienti, il risultato resta `outcome_unknown`; non viene inventato un completamento.

## Flusso vincolante

```text
Affetta genera il G-code
→ POST metadati (dimensione + SHA-256)
→ PUT dell'intero file
→ verifica atomica locale
→ upload streaming a OctoPrint
→ download locale da OctoPrint e nuova verifica SHA-256
→ stato transferred
→ snapshot 00_pre_print.jpg
→ avvio consentito
→ Affetta Server può essere spento
```

Il comando di avvio viene rifiutato se manca anche una sola verifica.

## Snapshot

Per ogni job viene creata una directory persistente:

```text
/var/lib/affetta-octobridge/jobs/<job-id>/
├── metadata.json
├── events.jsonl
├── gcode/<file>.gcode
├── 00_pre_print.jpg
├── 01_progress_25.jpg
├── 02_progress_50.jpg
├── 03_progress_75.jpg
└── 04_completed.jpg
```

In caso di esito anomalo, l'ultimo file diventa:

- `04_failed.jpg`;
- `04_cancelled.jpg`;
- `04_interrupted.jpg`.

Le acquisizioni 25/50/75 sono idempotenti e scattano al primo superamento della soglia. Se tra due polling il progresso passa, per esempio, dal 24% al 51%, vengono prodotte entrambe le immagini previste.

## Video live temporaneo

Il live è disattivato di default e nasce solo tramite una richiesta API autenticata. Vincoli codificati:

- una sola sessione;
- durata predefinita 45 secondi;
- durata massima non superabile di 120 secondi;
- risoluzione massima 800 × 600, predefinita 640 × 480;
- massimo 5 FPS, predefiniti 2 FPS;
- arresto automatico;
- arresto immediato se deve essere acquisito uno snapshot del job.

Il live non viene avviato automaticamente e non crea timelapse continuo.

## Profili selezionabili

Il catalogo contiene tutte le macchine del laboratorio. La selezione serve soltanto a identificazione, seriale e capacità; **non modifica il G-code**.

Candidati seriali sperimentali:

- Anycubic Predator;
- LulzBot TAZ 4, TAZ 5, TAZ 6;
- LulzBot Mini prima generazione;
- Delta WASP 2040, 2040 PRO, 2040 Turbo/Turbo2;
- Prusa i3 autocostruita;
- Zed, base Prusa, area 100 × 100 mm.

Visibili ma bloccati nel trasporto seriale OctoBridge:

- Bambu Lab X1C + AMS: integrazione LAN dedicata;
- Snapmaker U1: integrazione LAN dedicata;
- FLSUN V400: percorso Moonraker/Klipper;
- Thing-O-Matic: Affetta produce X3G; OctoBridge non esegue GPX né conversioni;
- Phrozen Sonic Mini 4K: flusso resina separato.

Tutti i profili restano `production_ready: false` in questa build.

## Prerequisito di sicurezza

Usare una **Raspberry Pi OS Lite pulita**, senza una precedente installazione OctoPrint.
L'installer rifiuta plugin locali e script G-code perché OctoBridge deve trasmettere il file prodotto da Affetta senza trasformazioni. OctoPrint viene inoltre avviato sempre con `--safe`, con timelapse disattivato e con tutti gli hook G-code configurabili impostati a `null`. Una reinstallazione della stessa build richiede l'opzione esplicita `--allow-existing-octoprint`.

## Installazione sul Pi

1. Installare Raspberry Pi OS Lite 32-bit aggiornato e abilitare SSH.
2. Collegare camera CSI, hub USB alimentato correttamente, MT7601U e cavo dati verso la stampante.
3. Copiare la cartella `octobridge-zero` sul Pi.
4. Eseguire:

```bash
cd ~/octobridge-zero
sudo bash installer/install.sh
```

L'installazione senza profilo lascia il bridge in stato sicuro `UNCONFIGURED` e con invio seriale disabilitato.

Per predisporre il primo collaudo della Predator:

```bash
sudo python3 /opt/affetta-octobridge/scripts/configure.py \
  --profile anycubic-predator \
  --bridge-id predator-zero-01 \
  --enable-experimental-printing \
  --restart
```

Questo comando abilita soltanto i test sperimentali; non modifica `production_ready: false`.

## Wi-Fi MT7601U

Il kernel deve esporre il modulo `mt7601u`. Lo script di installazione tenta di caricarlo e installa il firmware disponibile nei repository del sistema. Per configurare la rete:

```bash
sudo /opt/affetta-octobridge/scripts/configure-wifi.sh "NOME_RETE"
```

La password viene richiesta senza essere stampata. Verificare poi:

```bash
lsusb
lsmod | grep mt7601u
ip -brief address
```

## API e sicurezza

- OctoPrint ascolta solo su `127.0.0.1:5000` e non è esposto direttamente alla LAN.
- OctoBridge ascolta sulla porta `8792` e richiede sempre `Authorization: Bearer <token>`, eccetto `/health`.
- Le chiavi vengono generate localmente e salvate con permessi restrittivi in `/etc/affetta-octobridge/config.json`.
- Il token non viene stampato dall'installer né inserito nel repository.
- OctoPrint è fissato alla versione dichiarata nel package e non deve essere aggiornato separatamente durante il collaudo.
- La chiave globale OctoPrint è usata soltanto sul loopback nella build sperimentale; prima di future versioni che la rimuovano sarà necessario migrare a una application key.
- La rete locale deve essere considerata affidabile; questa build non implementa TLS.

Per assistenza di emergenza all'interfaccia OctoPrint, usare un tunnel SSH invece di aprire la porta:

```bash
ssh -L 5000:127.0.0.1:5000 utente@IP_DEL_PI
```

Poi aprire `http://127.0.0.1:5000` sul PC.

## Verifica e diagnostica

```bash
sudo /opt/affetta-octobridge/scripts/validate.sh
sudo /opt/affetta-octobridge/scripts/diagnostics.sh
```

Il secondo comando genera un report con credenziali oscurate.

## Test software inclusi

```bash
cd /opt/affetta-octobridge
PYTHONPATH=. python3 -m unittest discover -s tests -v
```

I test coprono:

- ricezione atomica e verifica SHA-256;
- blocco di upload e trasferimenti pesanti durante una stampa attiva;
- rifiuto dell'avvio prima del trasferimento verificato;
- snapshot pre-print, 25%, 50% e completamento;
- idempotenza delle immagini;
- annullamento esplicito;
- riconciliazione con `outcome_unknown` quando le prove non bastano.

## Limiti dichiarati

- Non è stata costruita né verificata un'immagine SD preconfigurata.
- L'installer non è ancora stato eseguito sul Raspberry Pi Zero V1.3 reale.
- OctoPrint, camera CSI, MT7601U, seriale e stampe lunghe devono essere collaudati fisicamente.
- Le prestazioni del live devono essere verificate senza compromettere la comunicazione seriale.
- Nessuna macchina può diventare `production_ready: true` tramite gli script di questa milestone.
