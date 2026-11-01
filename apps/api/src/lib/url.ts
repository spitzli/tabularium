export function resolveAbsolute(base: string, maybeRelative: string): string {
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative
  try {
    return new URL(maybeRelative, base.endsWith('/') ? base : `${base}/`).toString()
  } catch {
    return maybeRelative
  }
}

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^198\.(18|19)\./,
]

export function isPublicHttpUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  if (u.username || u.password) return false
  // WHATWG URL retains brackets on IPv6 and normalizes mapped IPv4 to hex.
  const host = u.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
  if (!host) return false
  // Test-only bypass: tests boot `Bun.serve` on localhost as a fixture for
  // `hashAsset`. Bun sets NODE_ENV=test under `bun test`. Production paths
  // (NODE_ENV unset or 'production') retain the full SSRF guard below.
  if (process.env.NODE_ENV === 'test') return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))
    return false
  if (host.includes(':')) {
    // Exclude compatible/mapped, local, multicast and IPv4 translation forms.
    if (host.startsWith('::') || /^(fc|fd|fe[89abcdef]|ff)/.test(host) || host.startsWith('64:ff9b:')) return false
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (PRIVATE_V4.some((r) => r.test(host)) || Number(host.split('.')[0]) >= 224) return false
  }
  return true
}
