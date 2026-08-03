# P4.4.1 — Preparazione del Raspberry pilota per Anycubic Predator

## Stato

- Canale: `experimental`
- `production_ready: false`
- Primo controller pilota: Raspberry Pi Zero V1.3
- Prima stampante: Anycubic Predator
- Le stampanti con rete nativa (FLSUN V400, Bambu Lab X1C e Snapmaker U1) sono escluse da OctoBridge.

## Sistema operativo di riferimento per il primo collaudo

Per ridurre il numero di variabili durante il primo test ARMv6, usare:

```text
Raspberry Pi OS (Legacy, 32-bit) Lite
Debian Bookworm
senza desktop
```

Questa scelta è un riferimento di collaudo, non una dichiarazione di incompatibilità definitiva con Trixie.

## Preparazione con Raspberry Pi Imager

Impostazioni suggerite:

```text
hostname: octobridge-predator-01
utente: affetta
timezone: Europe/Rome
keyboard: it
SSH: abilitato con password
Wi-Fi: rete locale 2,4 GHz
country wireless: IT
```

Il Raspberry Pi Zero V1.3 non ha Wi-Fi integrato. Collegare l'adattatore MT7601U e l'hub alimentato prima del primo avvio. In alternativa, completare il primo accesso con un adattatore USB-Ethernet o con monitor e tastiera.

Non installare OctoPi, OctoPrint, plugin, slicer o software webcam aggiuntivo prima dell'installer Affetta.

## Hardware minimo

- Raspberry Pi Zero V1.3;
- microSD affidabile, consigliati almeno 16 GB;
- alimentatore stabile 5 V / 2,5 A;
- cavo di alimentazione corto e di buona sezione;
- hub USB alimentato;
- adattatore Wi-Fi USB MT7601U;
- camera CSI compatibile;
- cavo USB dati verso la Predator;
- eventuale USB power blocker per impedire back-powering dalla stampante.

## Primo avvio: solo inventario

Dopo aver raggiunto il Pi via SSH, non installare ancora OctoBridge. Eseguire prima:

```bash
uname -a
cat /proc/device-tree/model
cat /etc/os-release
python3 --version
lsusb
modinfo mt7601u
lsmod | grep mt7601u
ip -brief address
vcgencmd get_throttled
```

Dopo il trasferimento del repository o del pacchetto, usare:

```bash
chmod +x ~/octobridge-zero/scripts/inventory-hardware.sh
~/octobridge-zero/scripts/inventory-hardware.sh
```

Conservare il report prodotto.

## Gate prima dell'installazione

Procedere con `installer/install.sh` soltanto se:

- modello rilevato coerente con Raspberry Pi Zero V1.3;
- architettura `armv6l`;
- sistema 32-bit;
- rete locale stabile;
- driver `mt7601u` disponibile;
- nessuna sottotensione corrente;
- microSD con spazio libero sufficiente;
- nessuna precedente installazione OctoPrint.

## Installazione successiva

Solo dopo la verifica dell'inventario:

```bash
cd ~/octobridge-zero
sudo bash installer/install.sh
```

La configurazione della Predator sarà eseguita in un passaggio separato, dopo la validazione dei servizi e della camera senza stampante.
