import { describe, expect, it } from 'vitest'
import catalog from '../../data/pois.json'
import worker from './index'

const now = Math.floor(Date.now() / 1000)
const token = '123456:TEST_TOKEN'

async function validInitData(): Promise<string> {
  const encoder = new TextEncoder()
  const user = JSON.stringify({ id: 24680, first_name: 'Test' })
  const signedFields = { auth_date: String(now), user }
  const sign = async (key: Uint8Array, value: string) => {
    const buffer = new ArrayBuffer(key.byteLength)
    new Uint8Array(buffer).set(key)
    const imported = await crypto.subtle.importKey('raw', buffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(value)))
  }
  const secret = await sign(encoder.encode('WebAppData'), token)
  const checkString = `auth_date=${now}\nuser=${user}`
  const digest = await sign(secret, checkString)
  const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return new URLSearchParams({ ...signedFields, hash }).toString()
}

describe('Worker API integration', () => {
  it('accepts the preset zone ID and returns sourced recommendations', async () => {
    const response = await worker.fetch(new Request('https://example.test/api/recommend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        initData: await validInitData(),
        request: { landmarkId: catalog.zone.id, minutes: 30, intents: [], text: '' },
      }),
    }), { TELEGRAM_BOT_TOKEN: token })
    const body = await response.json() as { recommendations: Array<{ sourceUrl: string; routeUrl: string }> }
    expect(response.status).toBe(200)
    expect(body.recommendations.length).toBeGreaterThan(0)
    expect(body.recommendations.length).toBeLessThanOrEqual(3)
    expect(body.recommendations[0].sourceUrl).toMatch(/^https:\/\/www\.openstreetmap\.org\//)
    expect(body.recommendations[0].routeUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//)
  })

  it('rejects missing or invalid Telegram launch data', async () => {
    const send = (initData: string) => worker.fetch(new Request('https://example.test/api/recommend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        initData,
        request: { landmarkId: catalog.zone.id, minutes: 30, intents: [], text: '' },
      }),
    }), { TELEGRAM_BOT_TOKEN: token })
    expect((await send('')).status).toBe(401)
    const invalid = new URLSearchParams({
      auth_date: String(now),
      user: JSON.stringify({ id: 24680 }),
      hash: '0'.repeat(64),
    }).toString()
    expect((await send(invalid)).status).toBe(401)
  })

  it('does not present OSM hours as verified open-now matches', async () => {
    const response = await worker.fetch(new Request('https://example.test/api/recommend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        initData: await validInitData(),
        request: { landmarkId: catalog.zone.id, minutes: 120, intents: [], text: 'Открыто ли сейчас?' },
      }),
    }), { TELEGRAM_BOT_TOKEN: token })
    const body = await response.json() as { summary: string; recommendations: unknown[] }
    expect(response.status).toBe(200)
    expect(body.recommendations).toEqual([])
    expect(body.summary).toContain('не могу подтвердить')
  })

  it('explains when GPS starts outside the pilot zone', async () => {
    const response = await worker.fetch(new Request('https://example.test/api/recommend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        initData: await validInitData(),
        request: { latitude: 50, longitude: 70, minutes: 120, intents: [], text: '' },
      }),
    }), { TELEGRAM_BOT_TOKEN: token })
    const body = await response.json() as { summary: string; recommendations: unknown[] }
    expect(response.status).toBe(200)
    expect(body.recommendations).toEqual([])
    expect(body.summary).toContain('пилотной зоне')
  })

  it('discloses unsupported free-text preferences', async () => {
    const response = await worker.fetch(new Request('https://example.test/api/recommend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        initData: await validInitData(),
        request: { landmarkId: catalog.zone.id, minutes: 30, intents: [], text: 'Тихое кафе с розеткой и входом для коляски' },
      }),
    }), { TELEGRAM_BOT_TOKEN: token })
    const body = await response.json() as { note: string }
    expect(response.status).toBe(200)
    expect(body.note).toContain('тишина, розетки, доступность для коляски')
  })

  it('rejects unsigned webhook calls and serves a /start launch button only with the secret', async () => {
    const update = { message: { text: '/start', chat: { id: 123, type: 'private' } } }
    const request = () => new Request('https://example.test/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(update),
    })
    const env = { TELEGRAM_WEBHOOK_SECRET: 'secret', MINI_APP_URL: 'https://example.test/app' }
    expect((await worker.fetch(request(), env)).status).toBe(401)

    const signedRequest = request()
    signedRequest.headers.set('X-Telegram-Bot-Api-Secret-Token', 'secret')
    const response = await worker.fetch(signedRequest, env)
    const body = await response.json() as { method: string; reply_markup: { inline_keyboard: Array<Array<{ web_app: { url: string } }>> } }
    expect(response.status).toBe(200)
    expect(body.method).toBe('sendMessage')
    expect(body.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://example.test/app')
  })
})
