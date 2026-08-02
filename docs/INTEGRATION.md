# Integrazione con Stampa3DBologna e Reborn

## Stampa3DBologna

Nel punto in cui `preventivo.php` ha già ricevuto e validato il file STL:

1. tradurre le opzioni esistenti in `material_id`, `quality_id`, `strength_id`, `color_id`;
2. chiamare Affetta dal server PHP;
3. salvare `quote_id`, hash modello, stima e prezzo nell'ordine;
4. se Affetta non risponde, non cancellare l'upload: loggare l'errore e mostrare una richiesta di riprova.

Il file `integration/php/stampa3dbologna_example.php` contiene il punto di partenza.

## Reborn

Affetta deve essere chiamato quando un modello è già presente e può essere preventivato. Reborn mantiene:

- modello e validazione;
- caso di riparazione;
- wallet/token;
- maker/provider;
- storico.

Affetta riceve il file validato e restituisce il preventivo. Non deve conoscere hash immagine, classificazione AI o dettagli interni del caso oltre a `external_ref`.

## Sicurezza del trasferimento file

Il chiamante deve inviare i byte del modello. Affetta non accetta URL arbitrari per evitare SSRF. Se il modello è remoto, Stampa3DBologna o Reborn devono scaricarlo soltanto dopo i propri controlli di host e autorizzazione e poi trasmettere il contenuto Base64.

## Regola v0.5.1

Per Stampa3DBologna il valore consigliato sarà `printer_id=auto-lab`. Il sito non deve scegliere stampante, motore o ugello. Affetta restituirà l’unità fisica selezionata e conserverà il routing nel job. Fino al completamento della calibrazione, solo le unità con `production_ready=true` possono essere assegnate automaticamente.
