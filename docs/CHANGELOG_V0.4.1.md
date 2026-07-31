# Affetta Standalone v0.4.2

- inclusi i pacchetti originali PrusaSlicer 2.9.6, Cura 5.13.0, OrcaSlicer 2.4.2 e Snapmaker Orca 2.3.5;
- aggiunta preparazione offline con verifica SHA-256;
- aggiunto motore distinto `snapmaker_orca` per Snapmaker U1;
- Snapmaker U1 usa il fork del produttore come motore principale e OrcaSlicer standard come fallback;
- supporto profili U1 per ugelli 0,2 / 0,4 / 0,6 / 0,8 mm;
- corretto il resolver Orca affinché selezioni preset della stessa macchina/vendor, evitando processi o filamenti di famiglie estranee;
- verificati 220 abbinamenti reali macchina/processo/materiale nei preset Orca e Snapmaker;
- self-test esteso a quattro famiglie e al G-code reale su Windows;
- API v1 e integrazioni future restano compatibili.
