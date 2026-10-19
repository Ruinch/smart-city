import { describe, expect, it } from 'vitest'
import { verifyTelegramInitData } from './auth'

const botToken = '123456:TEST_TOKEN'
const now = 1_800_000_000

async function signInitData(fields: Record<string, string>): Promise<string> {
  const encoder = new TextEncoder()
  async function sign(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
    const keyBuffer = new ArrayBuffer(keyBytes.byteLength)
    new Uint8Array(keyBuffer).set(keyBytes)
    const key = await crypto.subtle.importKey('raw', keyBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
  }
  const checkString = Object.entries(fields).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = await sign(encoder.encode('WebAppData'), botToken)
  const hash = Array.from(await sign(secret, checkString), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return new URLSearchParams({ ...fields, hash }).toString()
}

describe('Telegram Mini App initData verification', () => {
  it('accepts a valid current Telegram user', async () => {
    const signed = await signInitData({ auth_date: String(now), user: JSON.stringify({ id: 12345, first_name: 'A' }) })
    expect(await verifyTelegramInitData(signed, botToken, now)).toEqual({ userId: '12345', firstName: 'A' })
  })

  it('includes Telegram signature in the bot-token HMAC check string', async () => {
    const fields = {
      auth_date: String(now),
      query_id: 'AAExampleQuery',
      signature: 'telegram-ed25519-signature_example',
      user: JSON.stringify({ id: 12345, first_name: 'A' }),
    }
    const signed = await signInitData(fields)
    expect(await verifyTelegramInitData(signed, botToken, now)).toEqual({ userId: '12345', firstName: 'A' })
    expect(await verifyTelegramInitData(signed.replace('signature_example', 'signature_changed'), botToken, now)).toBeNull()
  })

  it('rejects tampering and duplicate signed fields', async () => {
    const signed = await signInitData({ auth_date: String(now), user: JSON.stringify({ id: 12345 }) })
    expect(await verifyTelegramInitData(signed.replace('12345', '99999'), botToken, now)).toBeNull()
    expect(await verifyTelegramInitData(`${signed}&auth_date=${now}`, botToken, now)).toBeNull()
  })

  it('accepts an open webview beyond one hour, but rejects data older than 24 hours and future data', async () => {
    const openWebview = await signInitData({ auth_date: String(now - 3601), user: JSON.stringify({ id: 12345 }) })
    expect(await verifyTelegramInitData(openWebview, botToken, now)).toEqual({ userId: '12345', firstName: undefined })
    const signed = await signInitData({ auth_date: String(now - 86_401), user: JSON.stringify({ id: 12345 }) })
    expect(await verifyTelegramInitData(signed, botToken, now)).toBeNull()
    const future = await signInitData({ auth_date: String(now + 61), user: JSON.stringify({ id: 12345 }) })
    expect(await verifyTelegramInitData(future, botToken, now)).toBeNull()
  })
})
