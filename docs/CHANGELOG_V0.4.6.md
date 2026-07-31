# Affetta v0.4.6

- Corretto il validatore G-code per le stampanti con movimenti di servizio fuori dall’area nominale, come la purge/wipe zone di Bambu Lab X1C.
- Aggiunto un inviluppo di movimento specifico per X1C senza modificare il controllo preventivo del modello sul piano.
- Corretto l’argomento CLI Orca/Snapmaker `--allow-newer-file 1`.
- Snapmaker U1 usa il binario headless stabile di OrcaSlicer con i profili ufficiali estratti da Snapmaker Orca; il fork vendor resta installato e disponibile.
- CuraEngine accetta un G-code strutturalmente completo anche quando alcune build Windows restituiscono un codice di uscita non zero.
- Il self-test prova ogni motore senza nascondere eventuali fallback e registra provider effettivo, tentativi, coordinate osservate e avvisi.
