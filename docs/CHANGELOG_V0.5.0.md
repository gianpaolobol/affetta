# Affetta 0.5.0 — Lab Fleet Router

- censimento del parco fisico Stampa3DBologna;
- distinzione fra modello stampante e singola unità;
- filamento 2,85 mm esclusivo per LulzBot TAZ/Mini e 1,75 mm per le altre FDM;
- supporto piani circolari e disposizione copie su delta;
- profili LulzBot, WASP, Predator, V400, Phrozen e Prusa i3 custom;
- routing automatico `auto-lab` con motivazioni e alternative;
- ruoli, materiali e ugelli dedicati per unità;
- esclusione dal routing produttivo delle unità non validate fisicamente;
- endpoint `/api/v1/fleet` e `/api/v1/route`;
- self-test statico della matrice e collaudo reale dei motori del parco;
- installer/rollback Windows 0.5.0.
