export class BackendError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, options: {
    statusCode?: number;
    retryable?: boolean;
    details?: Record<string, unknown>;
  } = {}) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
    this.statusCode = options.statusCode ?? 400;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? {};
  }
}

export function asBackendError(error: unknown): BackendError {
  if (error instanceof BackendError) return error;
  return new BackendError('internal_error', 'Errore interno del backend.', {
    statusCode: 500,
    retryable: true,
    details: { cause: error instanceof Error ? error.message : String(error) }
  });
}
