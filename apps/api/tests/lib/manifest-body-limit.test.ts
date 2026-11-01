import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { clearDb } from '../helpers'
import { ManifestValidationError, resolveManifest } from '../../src/lib/manifest'
import { parseRepoUrl } from '../../src/lib/providers'

describe('repository manifest body boundary', () => {
  beforeEach(clearDb)

  for (const declaredLength of [false, true])
    it(`rejects and cancels oversized source, length=${declaredLength}`, async () => {
      const ref = parseRepoUrl('https://github.com/alice/bounded-source')!
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
      const mock = spyOn(global, 'fetch').mockImplementation((async (input: string | URL | Request) =>
        String(input).includes('/contents/.tabularium')
          ? new Response(body, { headers: declaredLength ? { 'content-length': String(64 * 1024 + 1) } : {} })
          : new Response('not found', { status: 404 })) as unknown as typeof fetch)
      try {
        await expect(resolveManifest('test-token', ref)).rejects.toBeInstanceOf(ManifestValidationError)
        expect(canceled).toBe(true)
      } finally {
        mock.mockRestore()
      }
    })
})
