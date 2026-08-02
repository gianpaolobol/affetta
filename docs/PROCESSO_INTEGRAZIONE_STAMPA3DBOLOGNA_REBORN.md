# Processo di integrazione Affetta → Stampa3DBologna → Reborn

## Principio

Affetta è il motore tecnico autorevole. Stampa3DBologna gestisce preventivo commerciale, cliente, ordine e produzione. Reborn identifica o genera il modello e lo passa allo stesso preventivatore.

```text
FASE A — Parco macchine Affetta
  A1 inventario modelli e unità fisiche
  A2 ruoli produttivi dedicati
  A3 profili per materiale/qualità/resistenza/ugello
  A4 collaudo motori CLI
  A5 calibrazione fisica di ogni unità
  A6 abilitazione nel router produttivo

FASE B — Motore di stima rapida
  B1 Kiri:Moto self-hosted e versione bloccata
  B2 profili commerciali equivalenti
  B3 stima tempo/materiale/supporti
  B4 confronto e calibrazione contro Affetta

FASE C — Stampa3DBologna
  C1 analisi del calcolo preventivo esistente
  C2 sostituzione del costo geometrico con stima Kiri:Moto
  C3 pricing server-side privato
  C4 quote_id firmato e scadenza preventivo
  C5 coda HTTPS Stampa3DBologna → Affetta Agent
  C6 slicing definitivo e G-code Affetta

FASE D — Reborn
  D1 modello validato → preventivatore Stampa3DBologna
  D2 modello Meshy validato → stesso flusso
  D3 conservazione hash, provenienza e versione profilo
  D4 eventuale routing verso provider Reborn

FASE E — Produzione
  E1 disponibilità e manutenzione unità
  E2 capacità e data promessa
  E3 report scarti, tempi reali e consumo reale
  E4 ricalibrazione automatica dei coefficienti
```

## Stato della versione 0.5.1

La fase A1–A3 è implementata. A4 è automatizzata tramite script; A5 deve avvenire sul laboratorio reale. Soltanto X1C e Snapmaker U1 partono come `production_ready=true`, perché già verificate nelle versioni precedenti. Tutte le nuove unità restano censite e collaudabili ma escluse dal routing produttivo automatico fino alla calibrazione fisica.

## Contratto futuro con Stampa3DBologna

Il sito invierà a una coda protetta:

- hash e file del modello;
- materiale;
- qualità: bozza, standard, dettaglio;
- resistenza: leggera, standard, resistente;
- colore casuale o definito;
- quantità;
- riferimento ordine.

Affetta restituirà:

- unità fisica selezionata;
- profilo e versione;
- motore usato;
- tempo e materiale definitivi;
- numero di piatti;
- G-code;
- diagnostica e stato di validazione.
