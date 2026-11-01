import Ajv2020 from 'ajv/dist/2020'
import type { ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import { mapAjvErrors, type ValidationError } from './errors'

function makeAjv(options: { removeAdditional?: true } = {}) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    verbose: true, // so err.data lands in our ValidationError.actual via mapAjvErrors
    removeAdditional: options.removeAdditional,
  })
  addFormats(ajv)
  return ajv
}

export type ValidateResult =
  | { ok: true; normalized: Record<string, unknown>; errors: [] }
  | { ok: false; normalized: null; errors: ValidationError[] }

export type ValidateOptions = { lenient?: boolean }
const validators = new Map<string, ValidateFunction>()

function compiled(schema: Record<string, unknown>, lenient: boolean): ValidateFunction {
  const key = `${lenient}:` + JSON.stringify(schema)
  const cached = validators.get(key)
  if (cached) return cached
  // A full kind union produces a large compiled function. Release the previous
  // heavyweight validator before compiling another under a 512 MiB runtime.
  if (key.length > 64 * 1024) {
    for (const existing of validators.keys()) if (existing.length > 64 * 1024) validators.delete(existing)
  }
  if (validators.size >= 4) validators.delete(validators.keys().next().value!)
  const validate = makeAjv(lenient ? { removeAdditional: true } : {}).compile(schema)
  // Complete per-kind unions are expensive to compile. Bound both entry count
  // and retained key size; content keys also prevent stale object-mutation hits.
  if (key.length <= 1024 * 1024) {
    validators.set(key, validate)
  }
  return validate
}

export function validateManifest(
  parsed: unknown,
  schema: Record<string, unknown>,
  options: ValidateOptions = {},
): ValidateResult {
  const { lenient = false } = options
  // In lenient mode: removeAdditional strips unknown fields from the clone.
  // In strict mode: additionalProperties violations surface as errors.
  // Only strip where additionalProperties:false is declared. 'all' would
  // erase id/version in the conditional legacy-name constraint.
  const validate = compiled(schema, lenient)
  // Clone so ajv's data mutations (removeAdditional) don't leak to the caller.
  const dataCopy = structuredClone(parsed)
  const ok = validate(dataCopy)
  if (lenient) {
    // Lenient mode: unknown fields were already stripped from dataCopy by ajv.
    // Only hard errors (type mismatches, pattern failures, etc.) cause ok:false.
    if (ok) {
      return { ok: true, normalized: dataCopy as Record<string, unknown>, errors: [] }
    }
    // Filter out additionalProperties errors — those were handled by removeAdditional.
    const errors = mapAjvErrors(validate.errors).filter((e) => e.code !== 'additionalProperties')
    if (errors.length === 0) {
      return { ok: true, normalized: dataCopy as Record<string, unknown>, errors: [] }
    }
    return { ok: false, normalized: null, errors }
  }
  if (ok) {
    return {
      ok: true,
      normalized: dataCopy as Record<string, unknown>,
      errors: [],
    }
  }
  return {
    ok: false,
    normalized: null,
    errors: mapAjvErrors(validate.errors),
  }
}
