export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Affetta Backend API',
    version: '0.2.0',
    description: 'Backend Affetta per beta web, account, Agent, job, lease e artefatti.'
  },
  servers: [{ url: '/' }],
  components: {
    securitySchemes: {
      ApiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
      AgentBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' },
      BetaBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque-session' }
    },
    schemas: {
      StructuredError: {
        type: 'object', required: ['code', 'message', 'stage', 'retryable', 'details'],
        properties: {
          code: { type: 'string' }, message: { type: 'string' }, stage: { type: 'string' },
          retryable: { type: 'boolean' }, details: { type: 'object' }, correlation_id: { type: 'string' }
        }
      }
    }
  },
  paths: {
    '/beta/': { get: { summary: 'Interfaccia web beta gratuita', responses: { '200': { description: 'Pagina beta' } } } },
    '/v1/beta/limits': { get: { summary: 'Limiti piano Free', responses: { '200': { description: 'Limiti beta' } } } },
    '/v1/beta/register': { post: { summary: 'Registra account beta', responses: { '201': { description: 'Account creato' } } } },
    '/v1/beta/verify-email': { post: { summary: 'Verifica email beta', responses: { '200': { description: 'Email verificata' } } } },
    '/v1/beta/login': { post: { summary: 'Crea sessione beta', responses: { '200': { description: 'Sessione creata' } } } },
    '/v1/beta/me': { get: { summary: 'Legge account beta', security: [{ BetaBearer: [] }], responses: { '200': { description: 'Account e limiti' } } } },
    '/v1/beta/me/cost-profile': { patch: { summary: 'Aggiorna profilo costi', security: [{ BetaBearer: [] }], responses: { '200': { description: 'Profilo aggiornato' } } } },
    '/v1/beta/logout': { post: { summary: 'Revoca sessione beta', security: [{ BetaBearer: [] }], responses: { '200': { description: 'Sessione revocata' } } } },
    '/healthz': { get: { summary: 'Liveness', responses: { '200': { description: 'Backend attivo' } } } },
    '/metrics': { get: { summary: 'Metriche Prometheus', responses: { '200': { description: 'Metriche backend' } } } },
    '/readyz': { get: { summary: 'Readiness dipendenze', responses: { '200': { description: 'Dipendenze disponibili' }, '503': { description: 'Dipendenza non pronta' } } } },
    '/v1/pairing-codes': { post: { summary: 'Crea codice pairing', security: [{ ApiKey: [] }], responses: { '201': { description: 'Codice creato' } } } },
    '/v1/agents/pair': { post: { summary: 'Associa un Agent', responses: { '200': { description: 'Token Agent emesso' } } } },
    '/v1/agents/{id}/heartbeat': { post: { summary: 'Aggiorna capability Agent', security: [{ AgentBearer: [] }], responses: { '200': { description: 'Heartbeat registrato' } } } },
    '/v1/agents/{id}/lease': { post: { summary: 'Acquisisce un job con lease', security: [{ AgentBearer: [] }], responses: { '200': { description: 'Lease o null' } } } },
    '/v1/artifacts/prepare-upload': { post: { summary: 'Prepara upload artefatto input', security: [{ ApiKey: [] }], responses: { '201': { description: 'URL firmato' } } } },
    '/v1/artifacts/{id}/upload-complete': { post: { summary: 'Verifica upload e checksum', security: [{ ApiKey: [] }, { AgentBearer: [] }], responses: { '200': { description: 'Artefatto verificato' } } } },
    '/v1/jobs': { post: { summary: 'Crea job idempotente', security: [{ ApiKey: [] }], responses: { '201': { description: 'Job creato' }, '200': { description: 'Job idempotente esistente' } } } },
    '/v1/jobs/{id}': { get: { summary: 'Legge job ed eventi', security: [{ ApiKey: [] }], responses: { '200': { description: 'Stato job' } } } },
    '/v1/jobs/{id}/ack': { post: { summary: 'Conferma lease', security: [{ AgentBearer: [] }], responses: { '200': { description: 'ACK registrato' } } } },
    '/v1/jobs/{id}/progress': { post: { summary: 'Aggiorna stato e rinnova lease', security: [{ AgentBearer: [] }], responses: { '200': { description: 'Lease rinnovato' } } } },
    '/v1/jobs/{id}/complete': { post: { summary: 'Completa job idempotentemente', security: [{ AgentBearer: [] }], responses: { '200': { description: 'Completato' } } } },
    '/v1/jobs/{id}/fail': { post: { summary: 'Fallisce o ripianifica job', security: [{ AgentBearer: [] }], responses: { '200': { description: 'Stato aggiornato' } } } },
    '/v1/jobs/{id}/cancel': { post: { summary: 'Richiede cancellazione', security: [{ ApiKey: [] }], responses: { '200': { description: 'Cancellazione registrata' } } } }
  }
} as const;
