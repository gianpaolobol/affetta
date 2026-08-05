# Requisiti OctoPrint

Gli installer di questo pacchetto configurano OctoBridge sopra un'istanza
OctoPrint locale già installata.

## Versione raccomandata

```text
OctoPrint 1.11.8
```

È la versione fissata nel repository Affetta corrente. Sul Raspberry Pi 1 con
Python 3.7 deve essere mantenuta la serie compatibile con Python 3.7; non usare
OctoPrint 2.x su quell'ambiente.

## Requisiti operativi

- endpoint locale: `http://127.0.0.1:5000`;
- API key valida;
- servizio systemd, normalmente `octoprint.service`;
- nessun plugin di slicing;
- nessun hook che modifichi il G-code;
- timelapse non necessario;
- file ricevuto da Affetta conservato senza trasformazioni.

L'installer verifica l'endpoint `/api/version` quando il servizio è attivo.
Non tenta di aggiornare automaticamente OctoPrint: l'immagine e la build
OctoPrint restano un prerequisito separato, perché Pi 1/ARMv6 e Pi Zero possono
richiedere procedure differenti.
