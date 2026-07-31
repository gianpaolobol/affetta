# Uso standalone

Affetta viene eseguito come servizio Node.js locale o remoto. L’utente accede tramite browser; non deve aprire direttamente i file HTML.

## Modalità locale

- server: `127.0.0.1:8787`;
- email: outbox locale;
- dati: cartella `data/`;
- viewer: locale e senza dipendenze esterne;
- fallback di stima: ammesso per sviluppo;
- G-code reale: disponibile solo per motori configurati.

## Modalità pubblica

Prima della pubblicazione:

1. impostare HTTPS e `AFFETTA_PUBLIC_BASE_URL`;
2. configurare SMTP;
3. impostare chiavi API forti e origini ammesse;
4. installare/validare i motori;
5. predisporre backup e retention;
6. completare privacy, consensi e termini d’uso;
7. eseguire revisione di sicurezza e test di carico.
