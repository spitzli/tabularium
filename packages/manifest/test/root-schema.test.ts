import { expect, test } from 'bun:test'
import { ManifestSchema } from '../src/core'
import { buildSchema } from '../src/schema'
import { validateManifest } from '../src/validate'
import { validateKindManifestSchema } from '../src/root-schema'

const branch = (version: number) => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    version: { type: 'string' },
    kind: { const: 'extension' },
    protocolVersion: { const: version },
    sdkVersion: { const: version },
    dataProtocolVersion: { const: version },
  },
  required: ['name', 'version', 'kind', 'protocolVersion', 'sdkVersion', 'dataProtocolVersion'],
})
const union = { oneOf: [branch(1), branch(2)] }

test('root union applies identically in selected-kind and kindless discovery', () => {
  const checked = validateKindManifestSchema(union, 'extension')
  for (const kind of ['extension', null]) {
    const schema = buildSchema({ coreSchema: ManifestSchema, kind, kindSchemas: { extension: checked } })
    const manifest = {
      name: 'demo',
      version: '0.1.0',
      kind: 'extension',
      protocolVersion: 2,
      sdkVersion: 2,
      dataProtocolVersion: 2,
    }
    expect(validateManifest(manifest, schema).ok).toBe(true)
    expect(validateManifest({ ...manifest, sdkVersion: 1 }, schema).ok).toBe(false)
    expect(validateManifest({ ...manifest, root: true }, schema).ok).toBe(false)
    expect(validateManifest({ ...manifest, name: 'INVALID NAME' }, schema).ok).toBe(false)
  }
})

test('root safety checks traverse every schema container and bound data', () => {
  for (const container of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
    expect(() =>
      validateKindManifestSchema({ ...union, [container]: [{ $ref: 'https://invalid/schema' }] }, 'extension'),
    ).toThrow()
  }
  for (const container of ['not', 'if', 'then', 'else', 'items', 'contains', 'additionalProperties', 'propertyNames']) {
    expect(() =>
      validateKindManifestSchema({ ...union, [container]: { $ref: 'https://invalid/schema' } }, 'extension'),
    ).toThrow()
  }
  for (const container of ['properties', 'patternProperties', 'dependentSchemas']) {
    expect(() =>
      validateKindManifestSchema({ ...union, [container]: { nested: { $dynamicRef: 'x' } } }, 'extension'),
    ).toThrow()
  }
  expect(() => validateKindManifestSchema({ oneOf: Array(17).fill(branch(1)) }, 'extension')).toThrow()
  expect(() => validateKindManifestSchema({ ...union, description: 'x'.repeat(2001) }, 'extension')).toThrow()
  expect(() => validateKindManifestSchema({ ...union, ignoredKeyword: true }, 'extension')).toThrow()
  expect(() =>
    validateKindManifestSchema({ type: 'object', properties: {}, additionalProperties: true }, 'extension'),
  ).toThrow()
  expect(() =>
    validateKindManifestSchema({ ...branch(2), properties: { ...branch(2).properties, kind: {} } }, 'extension'),
  ).toThrow()
  let deep: any = {}
  for (let i = 0; i < 34; i++) deep = { not: deep }
  expect(() => validateKindManifestSchema({ ...branch(2), allOf: [deep] }, 'extension')).toThrow()
  expect(() => validateKindManifestSchema({ ...branch(2), pattern: 'x'.repeat(501) }, 'extension')).toThrow()
  expect(() => validateKindManifestSchema({ ...branch(2), default: 'x'.repeat(1024 * 1024) }, 'extension')).toThrow()
  expect(() =>
    validateKindManifestSchema(
      { ...branch(2), properties: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`x${i}`, {}])) },
      'extension',
    ),
  ).toThrow()
})

test('root policies retain latest locked id and conditional legacy name semantics', () => {
  const complete = branch(2)
  complete.properties = { ...complete.properties, id: {} } as typeof complete.properties
  const root = validateKindManifestSchema(complete, 'extension')
  for (const kind of ['extension', null]) {
    const schema = buildSchema({ coreSchema: ManifestSchema, kind, kindSchemas: { extension: root } })
    const candidate = {
      name: 'Human Display Name',
      version: '0.1.0',
      kind: 'extension',
      protocolVersion: 2,
      sdkVersion: 2,
      dataProtocolVersion: 2,
    }
    expect(validateManifest(candidate, schema).ok).toBe(false)
    expect(validateManifest({ ...candidate, id: 'valid-id' }, schema).ok).toBe(true)
    expect(validateManifest({ ...candidate, id: 'INVALID ID' }, schema).ok).toBe(false)
  }
})
