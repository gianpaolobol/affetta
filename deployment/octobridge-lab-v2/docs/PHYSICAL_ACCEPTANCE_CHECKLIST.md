# Checklist collaudo fisico per ogni nodo

- [ ] modello e revision code Raspberry registrati
- [ ] alimentatore verificato sotto carico
- [ ] microSD identificata ed etichettata
- [ ] SHA-256 immagine verificato
- [ ] boot ripetibile 3/3
- [ ] rete e SSH stabili
- [ ] hostname `.local` corretto
- [ ] USB host e hub dati verificati con `lsusb`
- [ ] porta persistente `/dev/serial/by-id`
- [ ] OctoPrint 1.11.8 raggiungibile solo localmente dal bridge
- [ ] nessun plugin o hook G-code non autorizzato
- [ ] OctoBridge `/health` e `/v1/status` corretti
- [ ] upload e SHA-256 verificati
- [ ] avvio reale confermato
- [ ] pausa/ripresa/annullamento provati
- [ ] stampa completa
- [ ] Affetta spento dopo avvio senza interruzione
- [ ] riconciliazione alla riaccensione
- [ ] prova perdita rete
- [ ] prova riavvio bridge
- [ ] temperature e stato coerenti
- [ ] report e log archiviati
- [ ] approvazione operatore

Fino al completamento: `experimental=true`, `production_ready=false`.
