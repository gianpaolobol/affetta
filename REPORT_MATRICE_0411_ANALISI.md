# Report analisi risultati matrice Affetta 0.4.11

## Esito ricevuto

- Combinazioni logiche rappresentate: 5.754.240
- Slicing reali: 960
- Superati: 672
- Falliti: 288
- Server stabile: sì

## Errori reali raggruppati

| Problema | Casi | Stampanti |
|---|---:|---|
| Cool Plate incompatibile col filamento | 128 | Bambu X1C |
| Punta supporto organico inferiore alla larghezza supporto | 160 | X1C 80, Snapmaker U1 80 |
| Quantità oltre piano classificata HTTP 500 anziché 422 | 4 controlli | tutte e tre |

Non risultano guasti Prusa né crash del processo Node.

## Anomalia aggiuntiva

I 672 casi superati riportavano esclusivamente 3, 4, 5 o 8 secondi. Il G-code massimo pesava 38.503.761 byte e conteneva 1.334.756 movimenti. La causa era il parser dei commenti temporali, non lo slicer.
