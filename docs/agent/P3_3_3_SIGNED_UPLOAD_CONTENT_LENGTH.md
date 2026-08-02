# P3.3.3 — Content-Length negli upload firmati

## Problema osservato

Il collaudo controllato completava pairing, download, slicing e validazione,
ma MinIO rifiutava il PUT del G-code con HTTP 411 `Length Required`.

Il client usava un `fs.ReadStream` come body di `fetch()`. Senza una lunghezza
esplicita, Node inviava il corpo con trasferimento chunked, non accettato dal
PUT firmato verso MinIO.

## Decisione

`uploadSignedFile()` esegue `stat()` sul file, verifica un eventuale valore
già firmato, imposta `Content-Length` esatto e conserva lo streaming. Il G-code
non viene caricato interamente in RAM.

## Test anti-regressione

Il mock storage restituisce HTTP 411 quando `Content-Length` manca e HTTP 400
quando non coincide con i byte ricevuti. Gli end-to-end verificano il valore.
