import Ajv2020 from 'ajv/dist/2020'

export type KindManifestSchema = Record<string, unknown>
const mapKeywords = new Set(['properties', 'patternProperties', 'dependentSchemas'])
const listKeywords = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
const childKeywords = new Set([
  'not',
  'if',
  'then',
  'else',
  'items',
  'contains',
  'additionalProperties',
  'propertyNames',
])
const scalarKeywords = new Set([
  'type',
  'enum',
  'const',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
  'minContains',
  'maxContains',
  'uniqueItems',
  'required',
  'description',
  'title',
  'default',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
  'pattern',
  'format',
  'dependentRequired',
])
const ajv = new Ajv2020({ strict: false, allErrors: false })
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Complete kind schemas are explicit, local and bounded; never resolve references. */
export function validateKindManifestSchema(input: unknown, kind: string): KindManifestSchema {
  if (!object(input) || new TextEncoder().encode(JSON.stringify(input)).byteLength > 1024 * 1024)
    throw new Error('manifestSchema: expected schema object at most 1 MiB')
  let nodes = 0
  function walk(node: unknown, depth: number): void {
    if (++nodes > 32768 || depth > 32) throw new Error('manifestSchema: schema complexity exceeds limits')
    if (typeof node === 'boolean') return
    if (!object(node)) throw new Error('manifestSchema: invalid schema node')
    for (const [key, value] of Object.entries(node)) {
      if (mapKeywords.has(key)) {
        if (!object(value) || Object.keys(value).length > 64)
          throw new Error('manifestSchema: at most 64 properties per map')
        for (const [name, child] of Object.entries(value)) {
          if (['__proto__', 'constructor', 'prototype'].includes(name))
            throw new Error('manifestSchema: forbidden property name')
          walk(child, depth + 1)
        }
      } else if (listKeywords.has(key)) {
        if (!Array.isArray(value) || value.length > 16) throw new Error('manifestSchema: at most 16 branches/items')
        for (const child of value) walk(child, depth + 1)
      } else if (childKeywords.has(key)) walk(value, depth + 1)
      else if (!scalarKeywords.has(key)) throw new Error(`manifestSchema: unsupported keyword ${key}`)
      if (key === 'pattern' && (typeof value !== 'string' || value.length > 500))
        throw new Error('manifestSchema: pattern exceeds 500 chars')
      if (key === 'description' && (typeof value !== 'string' || value.length > 2000))
        throw new Error('manifestSchema: description exceeds 2000 chars')
      if (key === 'title' && (typeof value !== 'string' || value.length > 200))
        throw new Error('manifestSchema: title exceeds 200 chars')
    }
  }
  walk(input, 0)
  // The accepted entry point is deliberately narrow: one closed kind object or
  // a bounded exact union of closed kind objects, not an implicit permissive root.
  const branches = 'oneOf' in input ? input.oneOf : [input]
  if (!Array.isArray(branches) || branches.length === 0 || branches.length > 16)
    throw new Error('manifestSchema: invalid root union')
  if ('oneOf' in input && Object.keys(input).some((key) => key !== 'oneOf'))
    throw new Error('manifestSchema: root union accepts only oneOf')
  for (const branch of branches) {
    if (
      !object(branch) ||
      branch.type !== 'object' ||
      branch.additionalProperties !== false ||
      !object(branch.properties) ||
      !object(branch.properties.kind) ||
      branch.properties.kind.const !== kind ||
      !Array.isArray(branch.required) ||
      !branch.required.includes('kind')
    ) {
      throw new Error('manifestSchema: each branch must be a closed object requiring its exact kind')
    }
  }
  if (!ajv.validateSchema(input)) throw new Error('manifestSchema: invalid JSON Schema')
  return structuredClone(input)
}
