# Affetta OctoBridge — SD Baseline V1

## Scopo

Questa baseline conserva la configurazione software e le decisioni validate sul pilot `taz-03` in modo da poter preparare gli altri nodi OctoBridge senza ripetere il debug manuale.

La baseline NON rende tutte le stampanti automaticamente `production_ready`: ogni macchina conserva i propri gate USB/seriale, movimento, stampa reale e stabilità.

## Baseline comune salvata

- OctoPi 1.1.0 32-bit
- OctoPrint 1.11.8
- Python 3.11.2
- timezone `Europe/Rome`
- SSH abilitato
- OctoPrint come servizio systemd
- bind OctoPrint `127.0.0.1:5000`
- `camera_auto_detect=1`
- camera CSI gestita dal servizio webcam di OctoPi
- live MJPEG come sorgente primaria video
- nessun accesso concorrente diretto a `/dev/video0` mentre `mjpg_streamer` lo possiede
- snapshot milestone Affetta non obbligatori
- serial printing disabilitato di default
- nessun aggiornamento automatico di OctoPi/OctoPrint/pip/Pydantic durante la fase pilot

## Fix ARMv6 congelato

Sui nodi `armv6l` la baseline usa:

- `pydantic == 2.13.4`
- `pydantic_core == 2.46.4`
- wheel tag: `cp311-cp311-linux_armv6l`
- SHA-256 wheel validata:
  `641aa429ed5be3c52d0d69b1d01e20019efc7d6139fdc224884ebf1dd4e67e02`

Il fix va applicato solo quando il nodo è realmente ARMv6 e il pacchetto installato non è compatibile. Non fare upgrade/downgrade casuali per aggirare il problema.

## Camera

Il pilot ha validato un sensore `OV5647` via CSI. La policy Affetta diventa:

1. `camera_auto_detect=1`.
2. OctoPi/Webcamd/MJPG Streamer possiede il device video.
3. Affetta usa il live stream come sorgente primaria.
4. Gli snapshot pre-stampa/25%/50%/75%/terminale non sono più requisito obbligatorio.
5. Se serve una foto statica, deve essere ricavata on-demand dallo stream o da un endpoint compatibile, senza contendere `/dev/video0` a `mjpg_streamer`.

## Golden image sperimentale

La decisione operativa è di creare subito, senza attendere lo stato `production_ready`, una immagine raw riutilizzabile della SD attualmente validata sul pilot `taz-03`.

Nome artefatto previsto:

`AFFETTA_OCTOBRIDGE_SD_V1_EXPERIMENTAL_2026-08-13.img`

Ruolo:

- base comune per nuovi nodi OctoBridge ancora sperimentali;
- evita di ripetere installazione OctoPi, fix ARMv6, configurazione OctoPrint e configurazione camera;
- NON trasferisce automaticamente la validazione hardware della TAZ6 alle altre stampanti;
- ogni clone resta `production_ready=false` finché non supera i gate specifici della propria stampante.

Il file raw va catturato dalla SD fisica validata dopo arresto corretto del Raspberry. Il repository include `Capture-AffettaGoldenSd.ps1`, che effettua una lettura raw della SD su Windows, genera SHA-256 e manifest e non modifica la SD sorgente.

## Cosa si riusa e cosa deve essere personalizzato

### Riutilizzabile su tutti i nodi

La configurazione software sopra descritta, i gate, la policy camera, il fix ARMv6 quando applicabile e la configurazione di sicurezza di base.

### Deve restare univoco per ogni nodo

- `fleet_unit_id`
- hostname `affetta-<fleet_unit_id>`
- `bridge_id`
- `printer_profile_id`
- identità USB/seriale della stampante
- MAC e eventuale prenotazione DHCP
- SSH host keys dopo una clonazione raw
- credenziali/segreti quando richiesto dalla policy del nodo

Non avviare contemporaneamente sulla stessa LAN la SD sorgente e più cloni raw non ancora re-identificati: hostname e SSH host keys della copia sono inizialmente quelli della SD sorgente.

## Processo per una nuova stampante

1. Scrivere `AFFETTA_OCTOBRIDGE_SD_V1_EXPERIMENTAL_2026-08-13.img` su una SD della stessa capacità o superiore.
2. Avviare un solo clone alla volta durante la fase di re-identificazione.
3. Personalizzare hostname, `fleet_unit_id`, `bridge_id` e `printer_profile_id`.
4. Rigenerare le SSH host keys del clone prima dell'uso parallelo in LAN.
5. Registrare MAC e prenotazione DHCP se prevista.
6. Verificare OctoPrint `active`.
7. Verificare camera/live stream se prevista.
8. Solo dopo collegare la stampante e iniziare il gate USB/seriale specifico.

## Stato attuale

Passati sul pilot `taz-03`:

- boot
- rete Ethernet
- SSH
- fix ARMv6 `pydantic_core`
- import Pydantic
- OctoPrint active
- camera CSI rilevata
- OV5647 rilevata
- streaming gestito da `mjpg_streamer`

Pendenti e volutamente NON incorporati come validazione hardware globale:

- USB/seriale TAZ6
- test seriali controllati
- test print
- stabilità 24h
- continuità Affetta offline
- riconciliazione dopo restart

La golden image V1 resta quindi sperimentale e `production_ready=false` per definizione.
