import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { buildApp, clearDb, makeUser } from '../helpers'
import { signJwt } from '../../src/lib/jwt'
import { db } from '../../src/db'
import * as ingest from '../../src/lib/release-ingest'

const repository = 'https://github.com/alice/cloud-plugin-echo-demo'
const assetUrl = 'https://example.com/echo-release.json'
const manifest = JSON.stringify({ name: 'echo-demo', version: '0.1.0', description: 'Release fixture' })

for (const route of ['preview', 'oauth'])
  describe(`POST submit/${route} release assets`, () => {
    beforeEach(clearDb)

    async function request(mode: 'valid' | 'invalid' | 'unavailable' | 'mismatch') {
      const user = await makeUser({ username: 'alice' })
      const token = await signJwt({
        sub: user.id,
        identityId: user.identityId,
        username: 'alice',
        providerInstanceId: 'github',
      })
      const hash = spyOn(ingest, 'hashReleaseAssetsAsync').mockResolvedValue(undefined)
      const mock = spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input)
        if (url === assetUrl)
          return new Response(
            mode === 'invalid' ? '{' : mode === 'mismatch' ? manifest.replace('0.1.0', '0.2.0') : manifest,
          )
        if (url.includes('/releases?'))
          return mode === 'unavailable'
            ? new Response('temporary outage', { status: 503 })
            : Response.json([
                {
                  tag_name: 'v0.1.0',
                  draft: false,
                  html_url: repository + '/releases/tag/v0.1.0',
                  assets: [{ name: 'tabularium.json', browser_download_url: assetUrl }],
                },
              ])
        if (url.endsWith('/hooks'))
          return Response.json(init?.method === 'POST' ? { id: 23 } : [], {
            status: init?.method === 'POST' ? 201 : 200,
          })
        if (url === 'https://api.github.com/repos/alice/cloud-plugin-echo-demo')
          return Response.json({ owner: { login: 'alice' }, permissions: { maintain: true } })
        // A valid source manifest must never mask an invalid published asset.
        if (url.includes('/contents/.tabularium')) return new Response(manifest)
        return new Response('not found', { status: 404 })
      })
      try {
        const app = await buildApp()
        return await app.handle(
          new Request('http://localhost/api/submit/' + route, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
            body: JSON.stringify({ repoUrl: repository }),
          }),
        )
      } finally {
        mock.mockRestore()
        hash.mockRestore()
      }
    }

    it('uses the asset logical identity instead of the prefixed repository slug', async () => {
      const response = await request('valid')
      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result.slug).toBe('echo-demo')
      if (route === 'preview') expect(result.fromManifest).toBe(true)
      else expect((await db.query.plugins.findFirst({ where: { id: 'echo-demo' } }))?.repoUrl).toBe(repository)
    })

    it('rejects invalid release metadata before any plugin claim', async () => {
      const response = await request('invalid')
      expect(response.status).toBe(422)
      expect(await db.query.plugins.findFirst({ where: { repoUrl: repository } })).toBeUndefined()
    })

    it('reports transient release lookup failure without inventing a provisional claim', async () => {
      const response = await request('unavailable')
      expect(response.status).toBe(503)
      expect(await db.query.plugins.findFirst({ where: { repoUrl: repository } })).toBeUndefined()
    })

    it('rejects an asset/tag version mismatch before claim', async () => {
      const response = await request('mismatch')
      expect(response.status).toBe(422)
      expect(await db.query.plugins.findFirst({ where: { repoUrl: repository } })).toBeUndefined()
    })
  })
