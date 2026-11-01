import { expect, test } from 'bun:test'
import { factorSchema } from '../src/factor-schema'
import { validateManifest } from '../src/validate'

test('factors repeated schema nodes without changing positive or negative validation', () => {
  const field = {
    type: 'object',
    properties: { text: { type: 'string', minLength: 1, maxLength: 100, description: 'bounded text '.repeat(30) } },
    required: ['text'],
    additionalProperties: false,
  }
  const schema = {
    type: 'object',
    properties: { a: field, b: field, literal: { const: { $ref: 'literal-data' } } },
    required: ['a', 'b'],
    additionalProperties: false,
  }
  const compact = factorSchema(schema)
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(schema).length)
  for (const data of [
    { a: { text: 'ok' }, b: { text: 'ok' } },
    { a: { text: '' }, b: { text: 'ok' } },
    { a: { text: 'ok', root: true }, b: { text: 'ok' } },
  ]) {
    expect(validateManifest(data, compact).ok).toBe(validateManifest(data, schema).ok)
  }
  expect(
    validateManifest({ a: { text: 'ok' }, b: { text: 'ok' }, literal: { $ref: 'literal-data' } }, compact).ok,
  ).toBe(true)
})

test('preserves schemas that already have reference scopes instead of rewriting them', () => {
  for (const schema of [
    { $defs: { x: { type: 'string' } }, $ref: '#/$defs/x' },
    { properties: { child: { $id: 'https://example.com/schema', type: 'string' } } },
  ]) {
    expect(factorSchema(schema)).toBe(schema)
  }
})
