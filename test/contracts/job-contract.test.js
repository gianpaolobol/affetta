import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const clone = (value) => structuredClone(value);

const schemas = {
  common: readJson('schemas/common-v1.schema.json'),
  error: readJson('schemas/error-v1.schema.json'),
  request: readJson('schemas/job-request-v1.schema.json'),
  result: readJson('schemas/job-result-v1.schema.json'),
  event: readJson('schemas/job-event-v1.schema.json'),
  agent: readJson('schemas/agent-capabilities-v1.schema.json')
};

const examples = {
  requestGcode: readJson('docs/contracts/examples/job-request-gcode.json'),
  requestX3g: readJson('docs/contracts/examples/job-request-x3g.json'),
  resultGcode: readJson('docs/contracts/examples/job-result-gcode.json'),
  resultX3g: readJson('docs/contracts/examples/job-result-x3g.json'),
  event: readJson('docs/contracts/examples/job-event.json'),
  agent: readJson('docs/contracts/examples/agent-capabilities.json'),
  error: readJson('docs/contracts/examples/error.json')
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const schema of Object.values(schemas)) ajv.addSchema(schema);

const validators = {
  request: ajv.getSchema(schemas.request.$id),
  result: ajv.getSchema(schemas.result.$id),
  event: ajv.getSchema(schemas.event.$id),
  agent: ajv.getSchema(schemas.agent.$id),
  error: ajv.getSchema(schemas.error.$id)
};

function expectValid(validator, value) {
  assert.equal(validator(value), true, JSON.stringify(validator.errors, null, 2));
}

function expectInvalid(validator, value) {
  assert.equal(validator(value), false, 'Il payload doveva essere rifiutato');
  assert.ok(validator.errors?.length);
}


test('i vincoli condizionali dichiarano i tipi richiesti da Ajv strictTypes', () => {
  const [gcodeCondition, x3gCondition] = schemas.result.properties.result.allOf;
  assert.equal(gcodeCondition.then.properties.artifacts.type, 'array');
  assert.equal(x3gCondition.then.properties.artifacts.type, 'array');
  assert.equal(x3gCondition.then.properties.postprocessors.type, 'array');
});

test('gli schemi v1 compilano e le fixture canoniche restano valide', () => {
  expectValid(validators.request, examples.requestGcode);
  expectValid(validators.request, examples.requestX3g);
  expectValid(validators.result, examples.resultGcode);
  expectValid(validators.result, examples.resultX3g);
  expectValid(validators.event, examples.event);
  expectValid(validators.agent, examples.agent);
  expectValid(validators.error, examples.error);
});

test('la richiesta richiede SHA-256, quantità positiva e filename portabile', () => {
  const missingHash = clone(examples.requestGcode);
  delete missingHash.input.sha256;
  expectInvalid(validators.request, missingHash);

  const badHash = clone(examples.requestGcode);
  badHash.input.sha256 = 'not-a-sha256';
  expectInvalid(validators.request, badHash);

  const zeroQuantity = clone(examples.requestGcode);
  zeroQuantity.print_intent.quantity = 0;
  expectInvalid(validators.request, zeroQuantity);

  const localPath = clone(examples.requestGcode);
  localPath.input.filename = 'C:\\AFFETTA\\uploads\\supporto.stl';
  expectInvalid(validators.request, localPath);
});

test('l’idempotency key è obbligatoria e limitata a caratteri trasportabili', () => {
  const missing = clone(examples.requestGcode);
  delete missing.idempotency_key;
  expectInvalid(validators.request, missing);

  const unsafe = clone(examples.requestGcode);
  unsafe.idempotency_key = 'ordine con spazi';
  expectInvalid(validators.request, unsafe);
});

test('completed richiede result e failed richiede un errore strutturato', () => {
  const completedWithoutResult = clone(examples.resultGcode);
  delete completedWithoutResult.result;
  expectInvalid(validators.result, completedWithoutResult);

  const failedWithoutError = clone(examples.resultGcode);
  failedWithoutError.status = 'failed';
  delete failedWithoutError.result;
  expectInvalid(validators.result, failedWithoutError);

  const failed = clone(examples.resultGcode);
  failed.status = 'failed';
  delete failed.result;
  failed.error = examples.error;
  expectValid(validators.result, failed);
});

test('un risultato X3G richiede artefatto X3G e post-processore GPX', () => {
  const noGpx = clone(examples.resultX3g);
  delete noGpx.result.postprocessors;
  expectInvalid(validators.result, noGpx);

  const wrongArtifact = clone(examples.resultX3g);
  wrongArtifact.result.artifacts[0].type = 'gcode';
  wrongArtifact.result.artifacts[0].format = 'gcode';
  expectInvalid(validators.result, wrongArtifact);
});

test('le proprietà locali o non contrattuali sono respinte; extensions resta namespaced', () => {
  const localPath = clone(examples.agent);
  localPath.engines[0].binary_path = 'C:\\AFFETTA_RUNTIME\\engines\\cura\\CuraEngine.exe';
  expectInvalid(validators.agent, localPath);

  const validExtension = clone(examples.requestGcode);
  validExtension.extensions = { 'it.stampa3dbologna.order': { order_id: '184' } };
  expectValid(validators.request, validExtension);

  const invalidExtension = clone(examples.requestGcode);
  invalidExtension.extensions = { order: { order_id: '184' } };
  expectInvalid(validators.request, invalidExtension);
});

test('la capability Thing-O-Matic resta sperimentale e non produttiva', () => {
  const thingOMatic = examples.agent.printer_profiles.find((profile) => profile.profile_id.startsWith('thing-o-matic'));
  assert.ok(thingOMatic);
  assert.equal(thingOMatic.profile_status, 'experimental');
  assert.equal(thingOMatic.production_ready, false);
  assert.equal(thingOMatic.physical_validation, 'pending');
  assert.equal(thingOMatic.output_format, 'x3g');
});
