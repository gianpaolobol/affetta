# Piano immagini SD OctoBridge

## Immagine candidata primaria

- **OctoPi 1.1.0 32-bit**
- **OctoPrint 1.11.8**
- SHA-256 ufficiale: `5cfb364cee2c4d73e6b16db2297bbc5f86895e840820f135d9832a002442fdc2`
- Installazione consigliata: Raspberry Pi Imager → Other Specific Purpose OS → 3D printing → OctoPi → stable.

La pagina ufficiale dichiara l’immagine compatibile con Raspberry Pi 1 e Raspberry Pi Zero, ma questi modelli non sono raccomandati per carichi elevati. Per Affetta vanno quindi usati senza webcam continua, senza timelapse, senza slicing e senza plugin non indispensabili.

## Regole di preparazione

1. Una SD per un solo nodo/stampante.
2. Hostname uguale al manifest macchina.
3. SSH abilitato e password univoca.
4. Paese Wi-Fi `IT`; usare 2,4 GHz quando necessario.
5. Nessuna password o API key nel repository.
6. Prima installazione con `serial_printing_enabled=false`.
7. Webcam disabilitata sui Pi 1/Zero fino al test di stabilità.
8. Verificare SHA-256 dell’immagine scaricata.

## Sequenza al ricevimento delle SD

- inventario e foto del Raspberry;
- lettura revision code;
- scrittura immagine;
- primo boot senza stampante;
- rete e SSH;
- `lsusb`;
- installazione bridge dedicato;
- test software;
- collegamento stampante;
- test seriale e stampa fisica;
- riconciliazione Affetta.

Nessun nodo passa a `production_ready=true` automaticamente.
