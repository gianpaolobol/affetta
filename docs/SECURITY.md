# Sicurezza

- API key solo lato server.
- CORS limitato agli host autorizzati.
- dimensione massima file configurabile;
- supporto iniziale limitato a STL;
- nomi file normalizzati;
- nessun fetch di URL arbitrari;
- processi slicer eseguiti senza shell;
- timeout dei motori;
- download protetto da token;
- controllo preliminare del volume macchina;
- validazione prudenziale di coordinate e temperature del G-code.

La validazione automatica non sostituisce il collaudo dei profili. Ogni profilo deve essere provato sulla macchina reale prima di essere marcato `validated`.
