<?php
declare(strict_types=1);

/**
 * Client PHP minimale per Affetta API.
 * Compatibile con PHP 8.x e integrabile nei flussi esistenti di Stampa3DBologna e Reborn.
 */
final class AffettaClient
{
    public function __construct(
        private readonly string $baseUrl,
        private readonly string $apiKey,
        private readonly int $timeoutSeconds = 180
    ) {}

    public function quoteFile(string $filePath, array $options = []): array
    {
        $payload = $this->modelPayload($filePath, $options);
        return $this->request('POST', '/api/v1/quotes', $payload);
    }

    public function createSliceJob(string $filePath, array $options): array
    {
        $payload = $this->modelPayload($filePath, $options);
        return $this->request('POST', '/api/v1/slice-jobs', $payload);
    }

    /**
     * Flusso unificato: genera il G-code e restituisce anche il prezzo
     * quando la chiave API appartiene a Stampa3DBologna/Reborn.
     */
    public function createAffettaJob(string $filePath, array $options): array
    {
        $payload = $this->modelPayload($filePath, $options);
        return $this->request('POST', '/api/v1/affetta-jobs', $payload);
    }

    public function getQuote(string $quoteId): array
    {
        return $this->request('GET', '/api/v1/quotes/' . rawurlencode($quoteId));
    }

    public function getSliceJob(string $jobId): array
    {
        return $this->request('GET', '/api/v1/slice-jobs/' . rawurlencode($jobId));
    }

    public function downloadArtifact(string $artifactUrl, string $destination): void
    {
        $url = str_starts_with($artifactUrl, 'http')
            ? $artifactUrl
            : rtrim($this->baseUrl, '/') . '/' . ltrim($artifactUrl, '/');

        $fp = fopen($destination, 'wb');
        if ($fp === false) {
            throw new RuntimeException('Impossibile creare il file di destinazione.');
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_FILE => $fp,
            CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $this->apiKey],
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        $ok = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        fclose($fp);
        if ($ok === false || $status >= 400) {
            @unlink($destination);
            throw new RuntimeException('Download Affetta fallito: ' . ($error ?: 'HTTP ' . $status));
        }
    }

    private function modelPayload(string $filePath, array $options): array
    {
        if (!is_file($filePath) || !is_readable($filePath)) {
            throw new InvalidArgumentException('File STL non leggibile: ' . $filePath);
        }
        $bytes = file_get_contents($filePath);
        if ($bytes === false) {
            throw new RuntimeException('Impossibile leggere il file STL.');
        }
        return array_merge([
            'filename' => basename($filePath),
            'file_base64' => base64_encode($bytes),
            'material_id' => 'pla',
            'quality_id' => 'standard',
            'strength_id' => 'standard',
            'color_id' => 'random',
            'quantity' => 1,
        ], $options);
    }

    private function request(string $method, string $path, ?array $payload = null): array
    {
        $url = rtrim($this->baseUrl, '/') . '/' . ltrim($path, '/');
        $ch = curl_init($url);
        $headers = [
            'Accept: application/json',
            'Authorization: Bearer ' . $this->apiKey,
            'X-Affetta-Client: php',
        ];
        $options = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_FOLLOWLOCATION => false,
        ];
        if ($payload !== null) {
            $encoded = json_encode($payload, JSON_THROW_ON_ERROR);
            $headers[] = 'Content-Type: application/json';
            $options[CURLOPT_POSTFIELDS] = $encoded;
        }
        $options[CURLOPT_HTTPHEADER] = $headers;
        curl_setopt_array($ch, $options);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($raw === false) {
            throw new RuntimeException('Affetta non raggiungibile: ' . $error);
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('Risposta Affetta non valida.');
        }
        if ($status >= 400 || ($decoded['success'] ?? false) !== true) {
            $message = $decoded['error']['message'] ?? ('HTTP ' . $status);
            throw new RuntimeException('Affetta: ' . $message);
        }
        return $decoded;
    }
}
