# ADR-010 — Affetta OctoBridge Zero Snapshot

## Stato

Accettata come fondazione sperimentale. `production_ready: false`.

## Contesto

Affetta Server Lite deve poter trasferire un lavoro a un controller locale e poi essere spento. Il Raspberry Pi Zero V1.3 ha risorse limitate, non dispone di Wi-Fi integrato e deve gestire contemporaneamente seriale, camera CSI, rete MT7601U e persistenza locale.

## Decisione

Adottare due processi separati:

1. OctoPrint core, senza plugin di slicing o plugin pesanti, vincolato a localhost;
2. un companion Affetta scritto con libreria standard Python, esposto alla LAN sulla porta 8792.

OctoPrint viene avviato permanentemente con `--safe`; timelapse, plugin non essenziali e hook G-code configurabili sono disattivati. Il companion non è un plugin OctoPrint. Questa separazione riduce l'accoppiamento con il ciclo di aggiornamento dei plugin, mantiene esplicito il confine di responsabilità e permette ad Affetta di usare un protocollo stabile e minimale.

## Integrità del file

Il G-code è trattato come sequenza opaca di byte:

- nessun parsing finalizzato alla riscrittura;
- nessun filtro, script o conversione;
- verifica di dimensione e SHA-256 durante la ricezione;
- rinomina atomica solo dopo verifica;
- nuova verifica prima dell'upload;
- upload streaming a OctoPrint;
- download locale della copia memorizzata da OctoPrint e confronto SHA-256 prima di dichiarare `transferred`.

L'avvio è consentito esclusivamente dallo stato `transferred`.

## Persistenza e riconciliazione

Metadata ed eventi sono scritti su disco con sostituzione atomica e `fsync`. Gli eventi usano JSON Lines e sequenza monotona. Alla riaccensione:

- se OctoPrint espone lo stesso file attivo, lo stato viene riconciliato a `printing` o `paused`;
- se OctoPrint registra esplicitamente l'ultimo esito, viene usato quell'esito;
- in assenza di prova sufficiente, si usa `outcome_unknown`.

Non si deduce il completamento dalla sola percentuale.

## Immagini

Gli snapshot sono locali e idempotenti. Il live è temporaneo, con risoluzione/FPS limitati, una sola sessione e stop automatico. Uno snapshot di lavoro ha priorità e interrompe il live.

## Profili

Il catalogo elenca tutte le stampanti, ma distingue:

- candidate seriali sperimentali;
- macchine con integrazione nativa di rete;
- formati non G-code come X3G;
- flussi resina.

La selezione non modifica mai il file.

## Conseguenze

Positive:

- Affetta Server può essere spento dopo l'avvio;
- file, eventi e immagini sopravvivono alla disconnessione;
- niente dipendenza da slicing sul Pi;
- superficie LAN ridotta: OctoPrint resta localhost;
- comportamento verificabile con hash e test.

Negative/rischi:

- il Pi deve restare acceso per tutta la stampa seriale;
- la doppia lettura del file aumenta l'I/O prima dell'avvio;
- OctoPrint moderno su ARMv6 richiede collaudo reale e può richiedere compilazione lenta delle dipendenze;
- camera e live possono stressare CPU, RAM, alimentazione e bus USB;
- TLS non è incluso nella build iniziale;
- la chiave globale OctoPrint è una soluzione locale e transitoria, da sostituire con application key prima di aggiornamenti incompatibili.
