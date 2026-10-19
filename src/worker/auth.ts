const encoder = new TextEncoder()

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

export interface TelegramIdentity {
  userId: string
  firstName?: string
}

async function hmac(keyBytes: Uint8Array, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', arrayBuffer(keyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, arrayBuffer(encoder.encode(value))))
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function constantTimeEqual(a: string, b: string): boolean {
  const size = Math.max(a.length, b.length)
  let difference = a.length ^ b.length
  for (let i = 0; i < size; i += 1) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return difference === 0
}

/** Validates Telegram's signed Mini App launch data before trusting its user ID. */
export async function verifyTelegramInitData(
  raw: string,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  maxAgeSeconds = 24 * 3600,
): Promise<TelegramIdentity | null> {
  if (!raw || raw.length > 16_384 || !botToken) return null

  const params = new URLSearchParams(raw)
  const seen = new Set<string>()
  for (const [key] of params) {
    if (seen.has(key)) return null
    seen.add(key)
  }

  const suppliedHash = params.get('hash')
  const authDateRaw = params.get('auth_date')
  const userRaw = params.get('user')
  if (!suppliedHash || !/^[0-9a-f]{64}$/i.test(suppliedHash) || !authDateRaw || !userRaw) return null
  if (!/^\d+$/.test(authDateRaw)) return null

  const authDate = Number(authDateRaw)
  if (!Number.isSafeInteger(authDate) || authDate > nowSeconds + 60 || nowSeconds - authDate > maxAgeSeconds) {
    return null
  }

  // Bot-token HMAC signs every received field except `hash`. Telegram's newer
  // `signature` field is excluded only by the separate Ed25519 third-party flow.
  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = await hmac(encoder.encode('WebAppData'), botToken)
  const actualHash = bytesToHex(await hmac(secretKey, dataCheckString))
  if (!constantTimeEqual(suppliedHash.toLowerCase(), actualHash)) return null

  try {
    const user: unknown = JSON.parse(userRaw)
    if (!user || typeof user !== 'object') return null
    const userRecord = user as Record<string, unknown>
    if (!Number.isSafeInteger(userRecord.id) || Number(userRecord.id) <= 0) return null
    return {
      userId: String(userRecord.id),
      firstName: typeof userRecord.first_name === 'string' ? userRecord.first_name.slice(0, 80) : undefined,
    }
  } catch {
    return null
  }
}
