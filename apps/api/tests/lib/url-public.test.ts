import { describe, expect, it } from 'bun:test'
import { isPublicHttpUrl } from '../../src/lib/url'

function production(check: () => void) {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    check()
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
  }
}

describe('public asset URL literal guard', () => {
  it('rejects canonical bracketed local and mapped/translated IPv6', () =>
    production(() => {
      for (const host of [
        '[fd00::1]',
        '[fc00::1]',
        '[fe80::1]',
        '[febf::1]',
        '[fec0::1]',
        '[::1]',
        '[::]',
        '[::ffff:127.0.0.1]',
        '[::ffff:169.254.169.254]',
        '[64:ff9b::a9fe:a9fe]',
        '[ff02::1]',
      ])
        expect(isPublicHttpUrl('https://' + host + '/manifest.json')).toBe(false)
    }))

  it('rejects private IPv4, metadata/CGNAT and trailing-dot localhost forms', () =>
    production(() => {
      for (const host of [
        '127.1',
        '2130706433',
        '0x7f000001',
        '10.1.2.3',
        '172.31.0.1',
        '192.168.1.1',
        '169.254.169.254',
        '100.100.100.200',
        '198.18.0.1',
        '224.0.0.1',
        'localhost.',
        'child.localhost.',
        'service.internal.',
      ])
        expect(isPublicHttpUrl('https://' + host + '/manifest.json')).toBe(false)
    }))

  it('retains real public IPv4/IPv6, public DNS names and scheme restrictions', () =>
    production(() => {
      for (const host of ['github.com', 'fcdn.example.com', '8.8.8.8', '[2606:4700:4700::1111]'])
        expect(isPublicHttpUrl('https://' + host + '/manifest.json')).toBe(true)
      expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false)
      expect(isPublicHttpUrl('https://user:secret@example.com/asset')).toBe(false)
    }))
})
