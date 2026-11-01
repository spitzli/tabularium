import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { clearDb } from '../helpers'
import {
  ManifestValidationError,
  resolveSubmissionManifest,
  resolveManifestFromReleaseAssets,
} from '../../src/lib/manifest'
import { parseRepoUrl } from '../../src/lib/providers'

const raw = JSON.stringify({ name: 'echo-demo', version: '0.1.0', description: 'Immutable release fixture' })
const asset = { name: 'tabularium.json', url: 'https://example.com/echo-release.json' }

describe('submission manifest release identity', () => {
  beforeEach(clearDb)

  it('prefers immutable assets over a repository name and source authoring manifest', async () => {
    const ref = parseRepoUrl('https://github.com/alice/cloud-plugin-echo-demo')!
    const source: string[] = []
    const mock = spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === asset.url) return new Response(raw)
      if (url.includes('/contents/.tabularium')) source.push(url)
      return new Response('not found', { status: 404 })
    })
    try {
      const result = await resolveSubmissionManifest('test-token', ref, { tag: 'v0.1.0', assets: [asset] })
      expect(result?.parsed.name).toBe('echo-demo')
      expect(result?.raw).toBe(raw)
      expect(source).toEqual([])
    } finally {
      mock.mockRestore()
    }
  })

  it('never sends forge OAuth to a foreign asset or a CDN redirect', async () => {
    const initial = 'https://github.com/alice/demo/releases/download/v0.1.0/tabularium.json'
    const requests: string[] = []
    const mock = spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      requests.push(url)
      expect(new Headers(init?.headers).get('authorization')).toBeNull()
      expect(init?.redirect).toBe('manual')
      return url === initial ? new Response(null, { status: 302, headers: { location: asset.url } }) : new Response(raw)
    })
    try {
      const result = await resolveManifestFromReleaseAssets('test-sensitive-oauth', [{ ...asset, url: initial }])
      expect(result?.parsed.name).toBe('echo-demo')
      expect(requests).toEqual([initial, asset.url])
      const direct = await resolveManifestFromReleaseAssets('test-sensitive-oauth', [asset])
      expect(direct?.parsed.name).toBe('echo-demo')
    } finally {
      mock.mockRestore()
    }
  })

  it('enforces the stream cap when the server omits content-length', async () => {
    const ref = parseRepoUrl('https://github.com/alice/cloud-plugin-echo-demo')!
    let canceled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024))
        controller.enqueue(new Uint8Array(1))
      },
      cancel() {
        canceled = true
      },
    })
    const mock = spyOn(global, 'fetch').mockResolvedValue(new Response(body))
    try {
      await expect(
        resolveSubmissionManifest('test-token', ref, { tag: 'v0.1.0', assets: [asset] }),
      ).rejects.toBeInstanceOf(ManifestValidationError)
      expect(canceled).toBe(true)
    } finally {
      mock.mockRestore()
    }
  })

  it('does not hide an invalid published asset behind a valid source file', async () => {
    const ref = parseRepoUrl('https://github.com/alice/cloud-plugin-echo-demo')!
    let sourceRequests = 0
    const mock = spyOn(global, 'fetch').mockImplementation(async (input) => {
      if (String(input) === asset.url) return new Response('{')
      sourceRequests++
      return new Response(raw)
    })
    try {
      await expect(
        resolveSubmissionManifest('test-token', ref, { tag: 'v0.1.0', assets: [asset] }),
      ).rejects.toBeInstanceOf(ManifestValidationError)
      expect(sourceRequests).toBe(0)
    } finally {
      mock.mockRestore()
    }
  })

  it('does not turn a missing declared manifest asset into a source-only release', async () => {
    const ref = parseRepoUrl('https://github.com/alice/cloud-plugin-echo-demo')!
    const mock = spyOn(global, 'fetch').mockResolvedValue(new Response('missing', { status: 404 }))
    try {
      await expect(
        resolveSubmissionManifest('test-token', ref, { tag: 'v0.1.0', assets: [asset] }),
      ).rejects.toBeInstanceOf(ManifestValidationError)
    } finally {
      mock.mockRestore()
    }
  })

  it('keeps source-only releases working when no manifest asset is declared', async () => {
    const ref = parseRepoUrl('https://github.com/alice/source-only')!
    const mock = spyOn(global, 'fetch').mockImplementation(async (input) =>
      String(input).includes('/contents/.tabularium') ? new Response(raw) : new Response('not found', { status: 404 }),
    )
    try {
      const result = await resolveSubmissionManifest('test-token', ref, { tag: 'v0.1.0', assets: [] })
      expect(result?.parsed.name).toBe('echo-demo')
    } finally {
      mock.mockRestore()
    }
  })

  it('rejects a valid asset whose version differs from the release tag', async () => {
    const ref = parseRepoUrl('https://github.com/alice/cloud-plugin-echo-demo')!
    const mock = spyOn(global, 'fetch').mockImplementation(async (input) =>
      String(input) === asset.url ? new Response(raw) : new Response('missing', { status: 404 }),
    )
    try {
      await expect(
        resolveSubmissionManifest('test-token', ref, { tag: 'v0.2.0', assets: [asset] }),
      ).rejects.toBeInstanceOf(ManifestValidationError)
    } finally {
      mock.mockRestore()
    }
  })
})
