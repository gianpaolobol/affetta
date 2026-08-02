import { config } from './config.js';

export function openApiDocument() {
  const selections = {
    material_id: { type: 'string', example: 'pla' },
    quality_id: { type: 'string', example: 'standard' },
    strength_id: { type: 'string', example: 'standard' },
    color_id: { type: 'string', example: 'random' },
    custom_color: { type: 'string', maxLength: 80, example: 'Blu petrolio', description: 'Richiesto quando color_id è custom.' },
    quantity: { type: 'integer', minimum: 1, maximum: 999, default: 1 },
    filename: { type: 'string', example: 'pezzo.stl' },
    file_base64: { type: 'string', description: 'Contenuto STL codificato Base64.' },
    source: { type: 'string', example: 'standalone' },
    external_ref: { type: ['string', 'null'], example: 'ORDER-123' },
    metadata: { type: 'object', additionalProperties: true }
  };
  const sliceProperties = {
    ...selections,
    printer_id: { type: 'string', example: 'auto-lab', description: 'Usa auto-lab per il Profilo automatico laboratorio. Il profilo è interno e non compare nella lista pubblica delle stampanti.' },
    nozzle_mm: { type: ['number', 'null'], default: null, description: 'Può essere null con printer_id=auto-lab.' }
  };
  return {
    openapi: '3.1.0',
    info: {
      title: 'Affetta API',
      version: config.version,
      description: 'API v1 provider-agnostic. Lo stesso contratto alimenta Affetta standalone, Stampa3DBologna, Reborn e integrazioni esterne. I motori interni non sono esposti al client.'
    },
    servers: [{ url: config.publicBaseUrl }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Chiave API per integrazioni server-to-server.' },
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'affetta_session', description: 'Sessione utente della web app.' }
      },
      schemas: {

        RouteRequest: { type: 'object', required: ['filename', 'file_base64'], properties: selections },
        FleetUnit: {
          type: 'object',
          properties: {
            id: { type: 'string' }, label: { type: 'string' }, printer_id: { type: 'string' }, printer_label: { type: 'string' },
            technology: { type: 'string' }, build_mm: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            bed_shape: { type: 'string' }, filament_diameter_mm: { type: ['number','null'] }, default_nozzle_mm: { type: ['number','null'] },
            roles: { type: 'array', items: { type: 'string' } }, material_ids: { type: 'array', items: { type: 'string' } },
            production_ready: { type: 'boolean' }, calibration_status: { type: 'string' }
          }
        },
        RegistrationRequest: {
          type: 'object', required: ['name', 'username', 'email', 'phone', 'password'],
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 100 },
            username: { type: 'string', minLength: 3, maxLength: 32 },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string', minLength: 6, maxLength: 30 },
            password: { type: 'string', minLength: 10, format: 'password' }
          }
        },
        LoginRequest: { type: 'object', required: ['identity', 'password'], properties: { identity: { type: 'string' }, password: { type: 'string', format: 'password' } } },
        QuoteRequest: { type: 'object', required: ['filename', 'file_base64'], properties: selections },
        SliceRequest: { type: 'object', required: ['filename', 'file_base64', 'printer_id'], properties: sliceProperties },
        AffettaJobRequest: { type: 'object', required: ['filename', 'file_base64', 'printer_id'], properties: sliceProperties },
        PricingProfile: {
          type: 'object',
          properties: {
            setup_eur: { type: 'number', minimum: 0 }, labor_eur: { type: 'number', minimum: 0 },
            machine_eur_hour: { type: 'number', minimum: 0 }, energy_eur_hour: { type: 'number', minimum: 0 },
            material_markup: { type: 'number', minimum: 0 }, risk_percent: { type: 'number', minimum: 0 },
            margin_percent: { type: 'number', minimum: 0 }, minimum_eur: { type: 'number', minimum: 0 },
            vat_percent: { type: 'number', minimum: 0 }, materials_eur_kg: { type: 'object', additionalProperties: { type: 'number' } },
            quality_price_factor: { type: 'object', additionalProperties: { type: 'number' } },
            strength_price_factor: { type: 'object', additionalProperties: { type: 'number' } },
            color_price_factor: { type: 'object', additionalProperties: { type: 'number' } }
          }
        },
        Error: { type: 'object', properties: { success: { const: false }, error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } }
      }
    },
    paths: {
      '/api/v1/health': { get: { summary: 'Stato servizio', responses: { '200': { description: 'OK' } } } },
      '/api/v1/catalog': { get: { summary: 'Cataloghi pubblici', responses: { '200': { description: 'Catalogo' } } } },

      '/api/v1/fleet': { get: { summary: 'Elenca unità fisiche, ruoli, materiali assegnati e stato di calibrazione', responses: { '200': { description: 'Parco macchine del laboratorio' } } } },
      '/api/v1/route': {
        post: {
          summary: 'Seleziona automaticamente una unità produttiva già validata',
          security: [{ bearerAuth: [] }, {}],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RouteRequest' } } } },
          responses: { '200': { description: 'Unità selezionata e alternative' }, '422': { description: 'Nessuna unità produttiva validata compatibile' } }
        }
      },
      '/api/v1/capabilities': { get: { summary: 'Capacità disponibili senza esporre i motori', responses: { '200': { description: 'Capacità' } } } },
      '/api/v1/profile-preview': { get: { summary: 'Anteprima del profilo automatico applicato alla stampante', parameters: [
        { name:'printer_id', in:'query', required:true, schema:{type:'string'} },
        { name:'nozzle_mm', in:'query', required:true, schema:{type:'number'} },
        { name:'material_id', in:'query', required:true, schema:{type:'string'} },
        { name:'quality_id', in:'query', required:true, schema:{type:'string'} },
        { name:'strength_id', in:'query', required:true, schema:{type:'string'} }
      ], responses: { '200': { description: 'Profilo risolto' }, '400': { description: 'Combinazione non valida' } } } },
      '/api/v1/auth/register': {
        post: { summary: 'Registra un utente e invia la conferma email', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RegistrationRequest' } } } }, responses: { '201': { description: 'Registrazione creata' }, '409': { description: 'Email o username già usati' } } }
      },
      '/api/v1/auth/verify': {
        get: { summary: 'Conferma l’indirizzo email', parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }], responses: { '302': { description: 'Reindirizzamento alla web app' } } }
      },
      '/api/v1/auth/login': {
        post: { summary: 'Avvia la sessione utente', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } }, responses: { '200': { description: 'Sessione creata' }, '403': { description: 'Email non verificata' } } }
      },
      '/api/v1/auth/logout': { post: { summary: 'Termina la sessione', security: [{ sessionCookie: [] }], responses: { '200': { description: 'Sessione terminata' } } } },
      '/api/v1/auth/me': { get: { summary: 'Legge l’utente corrente', security: [{ sessionCookie: [] }, {}], responses: { '200': { description: 'Stato sessione' } } } },
      '/api/v1/user/pricing-profile': {
        get: { summary: 'Legge il profilo costi personale', security: [{ sessionCookie: [] }], responses: { '200': { description: 'Profilo costi' }, '401': { description: 'Account verificato richiesto' } } },
        put: { summary: 'Aggiorna il profilo costi personale', security: [{ sessionCookie: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PricingProfile' } } } }, responses: { '200': { description: 'Profilo aggiornato' } } }
      },
      '/api/v1/affetta-jobs': {
        post: {
          summary: 'Flusso unico: crea il G-code e, se autorizzato, allega il preventivo',
          description: 'Pubblico: job G-code senza prezzo. Sessione verificata: job G-code e prezzo personale. API partner: job G-code e prezzo del tenant.',
          security: [{ bearerAuth: [] }, { sessionCookie: [] }, {}],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/AffettaJobRequest' } } } },
          responses: { '202': { description: 'Job creato' }, '422': { description: 'Modello o quantità non compatibile col piano' } }
        }
      },
      '/api/v1/quotes': {
        post: { summary: 'Calcola un preventivo separato per client registrati o integrazioni', security: [{ bearerAuth: [] }, { sessionCookie: [] }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/QuoteRequest' } } } }, responses: { '200': { description: 'Preventivo calcolato' }, '401': { description: 'Autenticazione richiesta' } } }
      },
      '/api/v1/quotes/{quote_id}': {
        get: { summary: 'Recupera un preventivo dello stesso utente o tenant', security: [{ bearerAuth: [] }, { sessionCookie: [] }], parameters: [{ name: 'quote_id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Preventivo' }, '404': { description: 'Non trovato' } } }
      },
      '/api/v1/slice-jobs': {
        post: { summary: 'Avvia solo la generazione G-code', security: [{ bearerAuth: [] }, {}], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SliceRequest' } } } }, responses: { '202': { description: 'Job creato' } } }
      },
      '/api/v1/slice-jobs/{job_id}': {
        get: { summary: 'Legge lo stato del job', security: [{ bearerAuth: [] }, {}], parameters: [{ name: 'job_id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Stato job in coda, esecuzione o completato' }, '422': { description: 'Job concluso con errore; risposta JSON con fase e diagnosi' }, '404': { description: 'Non trovato' } } }
      },
      '/api/v1/slice-jobs/{job_id}/artifact': {
        get: { summary: 'Scarica il G-code con token temporaneo', parameters: [{ name: 'job_id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'token', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'File G-code' }, '404': { description: 'Artefatto assente o scaduto' } } }
      }
    }
  };
}
