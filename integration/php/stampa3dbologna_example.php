<?php
declare(strict_types=1);
require_once __DIR__ . '/affetta_client.php';

// Configurare in .env/.htaccess lato server, mai nel JavaScript pubblico.
$client = new AffettaClient(
    getenv('AFFETTA_BASE_URL') ?: 'http://127.0.0.1:8787',
    getenv('AFFETTA_STAMPA3DBOLOGNA_KEY') ?: ''
);

/**
 * Esempio da richiamare dopo l'upload STL nel preventivatore esistente.
 */
function calcolaPreventivoAffettaStampa3DBologna(
    AffettaClient $client,
    string $stlPath,
    array $scelteUtente,
    string $requestId
): array {
    return $client->quoteFile($stlPath, [
        'source' => 'stampa3dbologna',
        'external_ref' => $requestId,
        'pricing_mode' => 'stampa3dbologna',
        'material_id' => $scelteUtente['materiale'] ?? 'pla',
        'quality_id' => $scelteUtente['qualita'] ?? 'standard',
        'strength_id' => $scelteUtente['resistenza'] ?? 'standard',
        'color_id' => $scelteUtente['colore'] ?? 'random',
        'quantity' => (int) ($scelteUtente['quantita'] ?? 1),
    ]);
}
