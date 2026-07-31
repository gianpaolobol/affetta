<?php
declare(strict_types=1);
require_once __DIR__ . '/affetta_client.php';

$client = new AffettaClient(
    getenv('AFFETTA_BASE_URL') ?: 'http://127.0.0.1:8787',
    getenv('AFFETTA_REBORN_KEY') ?: ''
);

/**
 * Reborn invia solo modelli validati o autorizzati alla preventivazione.
 * Il file viene passato server-to-server; Affetta non deve scaricare URL arbitrari.
 */
function calcolaPreventivoAffettaReborn(
    AffettaClient $client,
    string $validatedModelPath,
    string $rebornModelId,
    array $scelteUtente
): array {
    return $client->quoteFile($validatedModelPath, [
        'source' => 'reborn',
        'external_ref' => $rebornModelId,
        'pricing_mode' => 'reborn',
        'material_id' => $scelteUtente['materiale'] ?? 'pla',
        'quality_id' => $scelteUtente['qualita'] ?? 'standard',
        'strength_id' => $scelteUtente['resistenza'] ?? 'standard',
        'color_id' => $scelteUtente['colore'] ?? 'random',
        'quantity' => (int) ($scelteUtente['quantita'] ?? 1),
    ]);
}
