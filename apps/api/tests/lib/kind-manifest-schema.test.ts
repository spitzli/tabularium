import { beforeEach, expect, test } from 'bun:test'
import { createKind, getKind, updateKind } from '../../src/lib/kinds'
import { buildMergedSchema } from '../../src/lib/manifest-schema'
import { parseManifestText } from '../../src/lib/manifest'
import { validateManifest } from '@tabularium/manifest'
import { setSetting, initSettings } from '../../src/lib/settings'
import { db } from '../../src/db'
import { settings } from '../../src/db/schema'

// These admission checks need only the isolated test database's settings.
// Keep them independent of provider/MCP application startup.
beforeEach(async () => {
  await db.delete(settings)
  await initSettings()
})
const schema = {
  oneOf: [1, 2].map((n) => ({
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      version: { type: 'string' },
      kind: { const: 'extension' },
      protocolVersion: { const: n },
      sdkVersion: { const: n },
      dataProtocolVersion: { const: n },
    },
    required: ['name', 'version', 'kind', 'protocolVersion', 'sdkVersion', 'dataProtocolVersion'],
  })),
}
const manifest = {
  name: 'demo',
  version: '1.0.0',
  kind: 'extension',
  protocolVersion: 2,
  sdkVersion: 2,
  dataProtocolVersion: 2,
}

test('kind schema persists, survives metadata-only updates and controls strict ingestion/discovery', async () => {
  await createKind({ key: 'extension', label: 'Extensions', description: null, manifestSchema: schema })
  expect(getKind('extension')?.manifestSchema).toEqual(schema)
  await updateKind('extension', { key: 'extension', label: 'Renamed', description: null })
  expect(getKind('extension')?.manifestSchema).toEqual(schema)
  expect(parseManifestText(JSON.stringify(manifest))).toEqual(manifest)
  expect(() => parseManifestText(JSON.stringify({ ...manifest, privileged: true }))).toThrow()
  expect(() => parseManifestText(JSON.stringify({ ...manifest, sdkVersion: 1 }))).toThrow()
  expect(validateManifest(manifest, buildMergedSchema()).ok).toBe(true)
  expect(validateManifest({ ...manifest, protocolVersion: 1 }, buildMergedSchema()).ok).toBe(false)
  await updateKind('extension', { key: 'extension', label: 'Extensions', description: null, manifestSchema: null })
  expect(getKind('extension')?.manifestSchema).toBeNull()
})

test('strict kind validation retains the existing manifest byte cap', async () => {
  await createKind({ key: 'extension', label: 'Extensions', description: null, manifestSchema: schema })
  expect(() => parseManifestText(' '.repeat(65537))).toThrow(/64 KiB/)
})

test('invalid persisted root policy fails closed instead of silently dropping the kind', async () => {
  await setSetting(
    'plugin_kinds',
    JSON.stringify([{ key: 'extension', label: 'Extensions', description: null, manifestSchema: { type: 'object' } }]),
  )
  expect(() => getKind('extension')).toThrow()
  expect(() => parseManifestText(JSON.stringify(manifest))).toThrow()
})

test('corrupted present kind settings cannot bypass admission through legacy fallback', async () => {
  for (const corrupted of ['', '{', '{}', 'null', 'true', '[null]', '[{}]']) {
    await setSetting('plugin_kinds', corrupted)
    expect(() => getKind('extension')).toThrow()
    expect(() => buildMergedSchema()).toThrow()
    expect(() => parseManifestText(JSON.stringify({ ...manifest, sdkVersion: 1, privileged: true }))).toThrow()
  }
})
