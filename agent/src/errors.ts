import type { AgentStructuredError } from './types.js';

export class AgentError extends Error {
  readonly code: string;
  readonly stage: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;
  readonly statusCode: number | undefined;

  constructor(code: string, message: string, options: {
    stage?: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
    statusCode?: number;
    cause?: unknown;
  } = {}) {
    super(message, { cause: options.cause });
    this.name = 'AgentError';
    this.code = code;
    this.stage = options.stage ?? 'unknown';
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? {};
    this.statusCode = options.statusCode;
  }
}

export function normalizeAgentError(error: unknown, fallbackStage = 'unknown'): AgentStructuredError {
  if (error instanceof AgentError) {
    return {
      code: error.code,
      message: error.message,
      stage: error.stage,
      retryable: error.retryable,
      details: error.details
    };
  }
  if (error instanceof Error) {
    return {
      code: 'agent_unexpected_error',
      message: error.message,
      stage: fallbackStage,
      retryable: false,
      details: { name: error.name }
    };
  }
  return {
    code: 'agent_unknown_error',
    message: String(error),
    stage: fallbackStage,
    retryable: false,
    details: {}
  };
}
