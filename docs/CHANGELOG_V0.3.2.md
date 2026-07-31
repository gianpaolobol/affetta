# Affetta Standalone v0.3.2

## Correzione caricamento STL

La v0.3.1 inizializzava gli eventi di caricamento soltanto dopo:

1. caricamento del catalogo API;
2. caricamento delle capability;
3. controllo sessione;
4. avvio del viewer WebGL.

Un errore in uno di questi passaggi lasciava la pagina visibile ma impediva al selettore file di funzionare.

La v0.3.2:

- collega immediatamente gli eventi di click, drag-and-drop e tastiera;
- inizializza il viewer prima delle chiamate API;
- mantiene l'upload operativo se capability o sessione non rispondono;
- usa `File.arrayBuffer()` con fallback `FileReader`;
- valida estensione, dimensione e contenuto STL;
- legge STL ASCII e binari;
- mostra nome, dimensione, ingombro e numero di triangoli;
- permette di sostituire il modello senza ricaricare la pagina.

## Viewer

- renderer WebGL interattivo come modalità principale;
- rotazione, zoom, centratura e reticolo;
- piano adattato alla stampante selezionata;
- fallback Canvas interattivo se WebGL non è disponibile;
- nessuna dipendenza da CDN o connessione esterna.

Il fallback non blocca più il resto dell'applicazione.

## Identità visiva

Ripristinati gli elementi preferiti della v0.2.1:

- logo circolare rosso con lettera A in carattere serif corsivo;
- scritta AFFETTA con tagline separata;
- tagline in Georgia corsivo;
- titoli in Georgia;
- palette avorio, nero e rosso della v0.2.1.

## Compatibilità

Gli endpoint API v1 e il core provider-agnostic restano invariati, quindi la futura integrazione con Stampa3DBologna e Reborn non richiederà la riscrittura del motore.
