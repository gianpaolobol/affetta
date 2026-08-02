import fs from 'node:fs/promises';
import path from 'node:path';
import { BackendError } from './errors.js';
import type { AgentCapabilitiesV1, ContractValidator, JobRequestV1, JobResultV1 } from './types.js';

type ValidateFunction = ((value: unknown) => boolean) & { errors?: unknown };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class StructuralContractValidator implements ContractValidator {
  validateJobRequest(value: unknown): asserts value is JobRequestV1 {
    if (!object(value) || value.schema_version !== 'affetta.job.v1' || value.operation !== 'slice' ||
        typeof value.request_id !== 'string' || typeof value.idempotency_key !== 'string' ||
        !object(value.input) || typeof value.input.artifact_id !== 'string' ||
        typeof value.input.sha256 !== 'string' || !object(value.print_intent) ||
        !object(value.routing)) {
      throw new BackendError('invalid_job_request', 'Richiesta job non conforme ad affetta.job.v1.', { statusCode: 422 });
    }
  }

  validateJobResult(value: unknown): asserts value is JobResultV1 {
    if (!object(value) || value.schema_version !== 'affetta.result.v1' || value.status !== 'completed' ||
        typeof value.job_id !== 'string' || !object(value.result) || !Array.isArray(value.result.artifacts)) {
      throw new BackendError('invalid_job_result', 'Risultato job non conforme ad affetta.result.v1.', { statusCode: 422 });
    }
  }

  validateAgentCapabilities(value: unknown): asserts value is AgentCapabilitiesV1 {
    if (!object(value) || value.schema_version !== 'affetta.agent-capabilities.v1' ||
        typeof value.agent_id !== 'string' || !Array.isArray(value.protocol_versions) ||
        !Array.isArray(value.output_formats) || !Array.isArray(value.printer_profiles)) {
      throw new BackendError('invalid_agent_capabilities', 'Capability Agent non conformi al contratto v1.', { statusCode: 422 });
    }
  }
}

export async function createAjvContractValidator(contractsRoot: string): Promise<ContractValidator> {
  const moduleName = 'ajv/dist/2020.js';
  const imported = await import(moduleName) as { default: new (options: Record<string, unknown>) => {
    addSchema(schema: unknown): void;
    compile(schema: unknown): ValidateFunction;
  } };
  const Ajv2020 = imported.default;
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  const names = [
    'common-v1.schema.json',
    'error-v1.schema.json',
    'job-request-v1.schema.json',
    'job-result-v1.schema.json',
    'job-event-v1.schema.json',
    'agent-capabilities-v1.schema.json'
  ];
  const schemas = new Map<string, unknown>();
  for (const name of names) {
    const parsed = JSON.parse(await fs.readFile(path.join(contractsRoot, name), 'utf8')) as Record<string, unknown>;
    schemas.set(name, parsed);
    ajv.addSchema(parsed);
  }
  const request = ajv.compile(schemas.get('job-request-v1.schema.json'));
  const result = ajv.compile(schemas.get('job-result-v1.schema.json'));
  const capabilities = ajv.compile(schemas.get('agent-capabilities-v1.schema.json'));

  function assertValid<T>(validator: ValidateFunction, value: unknown, code: string, message: string): asserts value is T {
    if (!validator(value)) {
      throw new BackendError(code, message, {
        statusCode: 422,
        details: { validation_errors: validator.errors ?? [] }
      });
    }
  }

  return {
    validateJobRequest(value: unknown): asserts value is JobRequestV1 {
      assertValid<JobRequestV1>(request, value, 'invalid_job_request', 'Richiesta job non conforme ad affetta.job.v1.');
    },
    validateJobResult(value: unknown): asserts value is JobResultV1 {
      assertValid<JobResultV1>(result, value, 'invalid_job_result', 'Risultato job non conforme ad affetta.result.v1.');
    },
    validateAgentCapabilities(value: unknown): asserts value is AgentCapabilitiesV1 {
      assertValid<AgentCapabilitiesV1>(capabilities, value, 'invalid_agent_capabilities', 'Capability Agent non conformi al contratto v1.');
    }
  };
}
