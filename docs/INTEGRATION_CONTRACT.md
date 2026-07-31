# Contratto di integrazione

## Obiettivo

Collegare in seguito Stampa3DBologna e Reborn senza modificare il core Affetta.

## Autenticazione partner

Ogni sito usa una chiave distinta:

```http
Authorization: Bearer CHIAVE_TENANT
```

Le chiavi vengono configurate in `AFFETTA_API_KEYS` e non devono essere inviate al browser.

## Endpoint raccomandato

`POST /api/v1/affetta-jobs` è il contratto principale. Accetta file e selezioni normalizzate; restituisce:

- job asincrono G-code;
- preventivo associato al tenant;
- ID esterno conservato per correlare ordini/modelli;
- risultati senza nomi di provider.

## Compatibilità futura

Il router può cambiare motore, profilo o strategia di stima senza cambiare:

- nomi degli endpoint;
- payload pubblico;
- stati dei job;
- struttura normalizzata del preventivo.

I client `integration/php/affetta_client.php` e `integration/js/affetta-client.js` includono `createAffettaJob()` e mantengono i metodi separati precedenti.
