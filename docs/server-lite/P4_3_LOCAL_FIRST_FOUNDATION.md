# P4.3 — Server Lite local-first foundation

## Stato consegna

Implementazione e test automatici completati nell'ambiente di preparazione. Collaudo sulla LAN reale e sui controller fisici ancora pendente.

## Contratto funzionale

Ogni stampante espone uno snapshot normalizzato con:

- stato connessione e ultimo contatto;
- stato macchina;
- stato del lavoro;
- percentuale, fase, tempo trascorso/residuo e layer quando disponibili;
- file e identificativo remoto;
- temperature e segnalazioni;
- errore strutturato;
- dipendenza o autonomia dal server.

## Adattatori P4.3

- `moonraker`: lettura stato FLSUN V400/Klipper;
- `octoprint`: lettura stato Predator tramite OctoPrint;
- `mock`: collaudi ripetibili;
- `bambu-lan`: contratto riservato, implementazione pendente;
- `snapmaker-lan`: contratto riservato, implementazione pendente.

## Riconciliazione

All'avvio e durante il polling:

1. carica i lavori non terminali;
2. interroga ogni stampante abilitata;
3. associa il lavoro tramite identificativo remoto o nome file;
4. aggiorna stato e percentuale;
5. registra gli eventi persistenti;
6. non dichiara completato un lavoro senza evidenza del controller.

## Accettazione automatica

- 9 test Node superati;
- smoke test con lavoro autonomo in stampa;
- persistenza SQLite verificata;
- API locale e dashboard diagnostica verificate.

## Collaudi fisici pendenti

- indirizzo e API Moonraker della V400;
- OctoPrint sul Pi Zero 2 W collegato alla Predator;
- comportamento dopo spegnimento e riaccensione del portatile;
- latenza e stabilità attraverso i due router della LAN;
- implementazione e collaudo X1C/U1.
