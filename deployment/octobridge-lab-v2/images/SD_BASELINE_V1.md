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

## Cosa si riusa e cosa NON si clona

### Riutilizzabile su tutti i nodi

La configurazione software sopra descritta, i gate, la policy camera, il fix ARMv6 quando applicabile e la configurazione di sicurezza di base.

### Deve restare univoco per ogni nodo

- `fleet_unit_id`
- hostname `affetta-<fleet_unit_id>`
- `bridge_id`
- `printer_profile_id`
- identità USB/seriale della stampante
- MAC e eventuale prenotazione DHCP
- credenziali e segreti
- SSH host keys se si effettua una clonazione binaria della SD

Per questo motivo una copia raw della SD non deve essere considerata pronta semplicemente perché avvia OctoPrint: prima dell'uso devono essere rigenerate/personalizzate le identità del nodo.

## Strategia consigliata

La configurazione corrente è salvata come `pilot_validated_partial`. Quando `taz-03` avrà superato anche USB/seriale, stampa controllata, stabilità 24h, continuità offline e riconciliazione al riavvio, la stessa baseline potrà essere promossa a `golden SD image`.

Fino a quel momento la baseline serve per eliminare il lavoro già risolto (immagine OctoPi, ARMv6, OctoPrint, camera e policy video) ma non per saltare i gate hardware specifici della singola stampante.

## Processo per una nuova stampante

1. Associare il nodo a una voce in `machines/index.json`.
2. Preparare la SD con OctoPi 1.1.0 32-bit oppure clonare la futura golden image.
3. Applicare la baseline comune.
4. Personalizzare hostname/bridge/printer profile/credenziali/identità SSH.
5. Verificare `pydantic_core` ARMv6 solo se il Raspberry è `armv6l`.
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

Pendenti:

- USB/seriale TAZ6
- test seriali controllati
- test print
- stabilità 24h
- continuità Affetta offline
- riconciliazione dopo restart

La baseline resta pertanto sperimentale e `production_ready=false`.
