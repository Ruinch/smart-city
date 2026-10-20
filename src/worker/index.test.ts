import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import snapshot from '../../data/astana-dynamic-fallback.json'
import worker, { scarceSearchCategories } from './index'
import { ASTANA_CENTER, assembleRoute, buildOverpassQuery, needsLiveRefresh, parseOverpassPlaces, quotedVenueName,
  type DynamicPlace } from './dynamic'
import type { RecommendResponse, WalkRequest } from '../shared/types'
import { onCityHeading } from './direction'

const now = Math.floor(Date.now() / 1000)
const token = '123456:TEST_TOKEN'

async function validInitData(): Promise<string> {
  const encoder = new TextEncoder()
  const user = JSON.stringify({ id: 24680, first_name: 'Test' })
  const signedFields = { auth_date: String(now), signature: 'telegram-ed25519-signature_example', user }
  const sign = async (key: Uint8Array, value: string) => {
    const buffer = new ArrayBuffer(key.byteLength)
    new Uint8Array(buffer).set(key)
    const imported = await crypto.subtle.importKey('raw', buffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(value)))
  }
  const secret = await sign(encoder.encode('WebAppData'), token)
  const checkString = `auth_date=${now}\nsignature=${signedFields.signature}\nuser=${user}`
  const digest = await sign(secret, checkString)
  const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return new URLSearchParams({ ...signedFields, hash }).toString()
}

function requestBody(request: Partial<WalkRequest> = {}, initData?: string) {
  return new Request('https://example.test/api/recommend', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      initData,
      request: { cityId: 'astana', scope: 'city', transport: 'walk', minutes: 120,
        intents: [], text: '', ...request },
    }),
  })
}

async function recommend(request: Partial<WalkRequest> = {}): Promise<{ response: Response; body: RecommendResponse }> {
  // Route integration tests use the saved OSM snapshot; live Overpass behavior has its own test.
  const liveFetch = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [] }),
    { status: 200, headers: { 'content-type': 'application/json' } })))
  try {
    const response = await worker.fetch(requestBody(request, await validInitData()), { TELEGRAM_BOT_TOKEN: token })
    return { response, body: await response.json() as RecommendResponse }
  } finally {
    vi.stubGlobal('fetch', liveFetch)
  }
}

describe('Worker API integration', () => {
  it('accepts signed Telegram launch data and builds an ordered route from sourced Astana places', async () => {
    const { response, body } = await recommend({ text: 'Хочу кофе и почитать книгу', groupSize: 3, minutes: 180 })
    expect(response.status).toBe(200)
    expect(body.routes!.length).toBeGreaterThan(1)
    expect(body.routes!.length).toBeLessThanOrEqual(3)
    const route = body.routes![0]
    expect(route.stops.length).toBeGreaterThan(0)
    expect(route.stops.length).toBeLessThanOrEqual(3)
    expect(body.recommendations).toEqual(route.stops)
    expect(new Set(body.routes!.map((variant) => variant.stops[0].id)).size).toBe(body.routes!.length)
    expect(route.stops.map((stop) => stop.stopOrder)).toEqual(route.stops.map((_, index) => index + 1))
    expect(route.stops.every((stop) => stop.cityId === 'astana' && stop.kind === 'place')).toBe(true)
    expect(route.stops.every((stop) => stop.sourceProvider === 'OpenStreetMap'
      && /^https:\/\/www\.openstreetmap\.org\//.test(stop.sourceUrl))).toBe(true)
    expect(route.routeUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//)
    expect(body.note).toContain(snapshot.source.osmBaseTimestamp.slice(0, 10))
    expect(body.note).toContain('места')
  })

  it('returns route explanations in the selected language, regardless of prompt language', async () => {
    const kazakh = await recommend({ language: 'kk', text: 'Хочу кофе и почитать книгу', minutes: 180 })
    expect(kazakh.response.status).toBe(200)
    expect(kazakh.body.summary).toContain('сұрауыңызға сай')
    expect(kazakh.body.routes?.[0]?.summary).toContain('Астанада')
    expect(kazakh.body.routes?.[0]?.stops[0].why).toContain('сұрауыңызға сай')
    expect(kazakh.body.routes?.[0]?.stops[0].action).toMatch(/нақтылаңыз|тексеріңіз/)
    expect(kazakh.body.note).toContain('Іздеу негізі')

    const english = await recommend({ language: 'en', text: 'Хочу кофе и почитать книгу', minutes: 180 })
    expect(english.response.status).toBe(200)
    expect(english.body.summary).toContain('matched your request')
    expect(english.body.routes?.[0]?.summary).toContain('in Astana')
    expect(english.body.routes?.[0]?.stops[0].why).toContain('matches your request')
    expect(english.body.routes?.[0]?.stops[0].action).toMatch(/Check/)
    expect(english.body.note).toContain('Search is based on OpenStreetMap')
  })

  it('localizes empty results, day trips and auth errors', async () => {
    const empty = await recommend({ language: 'en', latitude: 50, longitude: 70 })
    expect(empty.body.summary).toContain('outside Astana')
    const trip = await recommend({ language: 'kk', scope: 'day_trip', transport: 'car', minutes: 1440 })
    expect(trip.response.status).toBe(200)
    expect(trip.body.summary).toContain('Астанадан қала сыртына')
    expect(trip.body.routes?.[0]?.stops[0].why).toContain('тексерілмеген')
    const invalid = await worker.fetch(requestBody({ language: 'en' }, ''), { TELEGRAM_BOT_TOKEN: token })
    expect((await invalid.json() as { error: string }).error).toContain('Reopen the app')
  })

  it('rejects unsigned or invalid Telegram launch data', async () => {
    expect((await worker.fetch(requestBody({}, ''), { TELEGRAM_BOT_TOKEN: token })).status).toBe(401)
    const invalid = new URLSearchParams({
      auth_date: String(now), user: JSON.stringify({ id: 24680 }), hash: '0'.repeat(64),
    }).toString()
    expect((await worker.fetch(requestBody({}, invalid), { TELEGRAM_BOT_TOKEN: token })).status).toBe(401)
  })

  it('keeps the initial catalog empty while reporting the sourced snapshot in health', async () => {
    const catalogResponse = await worker.fetch(new Request('https://example.test/api/catalog'), {})
    const catalog = await catalogResponse.json() as {
      cities: Array<{ id: string; name: string; poiCount: number }>
      places: unknown[]
      source: { provider: string; licenseUrl: string }
    }
    expect(catalogResponse.status).toBe(200)
    expect(catalog.cities).toMatchObject([{ id: 'astana', name: 'Астана', poiCount: 0 }])
    expect(catalog.places).toEqual([])
    expect(catalog.source.provider).toBe('OpenStreetMap')
    expect(catalog.source.licenseUrl).toBe('https://www.openstreetmap.org/copyright')

    const healthResponse = await worker.fetch(new Request('https://example.test/api/health'), {})
    const health = await healthResponse.json() as {
      snapshotSize: number; snapshotDate: string; overtureSize: number; overtureRelease: string;
      twoGisEnabled: boolean
    }
    expect(healthResponse.status).toBe(200)
    expect(health.snapshotSize).toBe(snapshot.pois.length)
    expect(health.snapshotSize).toBeGreaterThan(200)
    expect(health.snapshotDate).toBe(snapshot.source.osmBaseTimestamp)
    expect(health.overtureSize).toBeGreaterThan(0)
    expect(health.overtureRelease).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
    expect(health.twoGisEnabled).toBe(false)
  })

  it('uses a named Astana landmark as the route origin', async () => {
    const { response, body } = await recommend({ text: 'Кофе у Mega Silk Way', minutes: 120 })
    expect(response.status).toBe(200)
    expect(body.routes!.length).toBeGreaterThan(0)
    expect(body.routes![0].origin?.name).toMatch(/mega silk way|мега силк/i)
    expect(body.routes![0].origin?.lat).toBeGreaterThan(51)
    expect(body.routes![0].origin?.lon).toBeGreaterThan(71)
    expect(body.routes![0].routeUrl).toContain('origin=')
  })

  it('can include a tagged nightclub for an explicit club request', async () => {
    const { response, body } = await recommend({ text: 'Хочу в ночной клуб, драйв и танцы', minutes: 180 })
    expect(response.status).toBe(200)
    expect(body.routes?.[0]?.stops.some((stop) => stop.category === 'nightclub')).toBe(true)
    expect(body.routes![0].summary).toContain('атмосфера и программа')
  })

  it('refreshes recent and quoted venue requests through the bounded live path', () => {
    expect(needsLiveRefresh('Что нового открылось сегодня?')).toBe(true)
    expect(needsLiveRefresh('Покажи «точное название места»')).toBe(true)
    expect(needsLiveRefresh('Кофе и книга')).toBe(false)
  })

  it('refreshes sparse niche categories even when they are fifth or sixth in the request', () => {
    const scarce = scarceSearchCategories(
      ['cafe', 'library', 'park', 'museum', 'nightclub', 'escape_game'], [])
    expect(scarce).toContain('nightclub')
    expect(scarce).toContain('escape_game')
  })

  it('refreshes sparse accessibility data and labels only tagged city stops', async () => {
    const originalFetch = globalThis.fetch
    const overpassFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', overpassFetch)
    try {
      const response = await worker.fetch(requestBody({ text: 'Кофе и книга', minutes: 240,
        accessibility: 'osm_wheelchair_yes' }, await validInitData()), { TELEGRAM_BOT_TOKEN: token })
      const body = await response.json() as RecommendResponse
      expect(response.status).toBe(200)
      expect(body.routes?.length).toBeGreaterThan(0)
      expect(body.routes!.flatMap((route) => route.stops).every((stop) => stop.wheelchairTag === 'yes')).toBe(true)
      expect(body.note).toContain('wheelchair=yes')
      expect(body.note).toContain('бордюры')
      expect(overpassFetch).toHaveBeenCalled()
      const query = new URLSearchParams(overpassFetch.mock.calls[0][1].body).get('data') ?? ''
      expect(query).toContain('["wheelchair"="yes"]')
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('returns an honest empty result when strict venue tags are missing', async () => {
    const { response, body } = await recommend({ text: 'Памятники и история города', minutes: 240,
      accessibility: 'osm_wheelchair_yes' })
    expect(response.status).toBe(200)
    expect(body.routes).toEqual([])
    expect(body.summary).toContain('wheelchair=yes')
    expect(body.note).toContain('Отсутствие отметки не означает недоступность')

    const trip = await recommend({ language: 'en', scope: 'day_trip', transport: 'car',
      minutes: 1440, accessibility: 'osm_wheelchair_yes' })
    expect(trip.response.status).toBe(200)
    expect(trip.body.routes).toEqual([])
    expect(trip.body.summary).toContain('do not yet have OSM wheelchair access data')

    const questTrip = await recommend({ language: 'en', scope: 'day_trip', transport: 'car',
      minutes: 1440, microQuest: true })
    expect(questTrip.response.status).toBe(200)
    expect(questTrip.body.note).toContain('mini quest is available only for city routes')
    const gentleTrip = await recommend({ language: 'en', scope: 'day_trip', transport: 'car',
      minutes: 1440, gentlePace: true })
    expect(gentleTrip.response.status).toBe(200)
    expect(gentleTrip.body.note).toContain('Gentle pace applies only to city routes')
  })

  it('validates short hops and keeps each estimated walking leg at ten minutes or less', async () => {
    const bad = await worker.fetch(requestBody({ shortLegs: true, transport: 'car' },
      await validInitData()), { TELEGRAM_BOT_TOKEN: token })
    expect(bad.status).toBe(400)
    const badTrip = await worker.fetch(requestBody({ shortLegs: true, scope: 'day_trip', transport: 'car' },
      await validInitData()), { TELEGRAM_BOT_TOKEN: token })
    expect(badTrip.status).toBe(400)
    const badAccess = await worker.fetch(requestBody({ accessibility: 'guaranteed' as unknown as WalkRequest['accessibility'] },
      await validInitData()), { TELEGRAM_BOT_TOKEN: token })
    expect(badAccess.status).toBe(400)
    const invalidType = await worker.fetch(requestBody({ microQuest: 'yes' as unknown as boolean },
      await validInitData()), { TELEGRAM_BOT_TOKEN: token })
    expect(invalidType.status).toBe(400)
    const invalidPace = await worker.fetch(requestBody({ gentlePace: 'yes' as unknown as boolean },
      await validInitData()), { TELEGRAM_BOT_TOKEN: token })
    expect(invalidPace.status).toBe(400)
    const { response, body } = await recommend({ text: 'Прогулка по Астане', shortLegs: true,
      microQuest: true, minutes: 180 })
    expect(response.status).toBe(200)
    expect(body.routes?.length).toBeGreaterThan(0)
    expect(body.note).toContain('не более чем в 10 минут')
    for (const route of body.routes ?? []) {
      let previous = route.origin!
      for (const stop of route.stops) {
        const latRadians = previous.lat * Math.PI / 180
        const north = (stop.lat! - previous.lat) * 111_195
        const east = (stop.lon! - previous.lon) * 111_195 * Math.cos(latRadians)
        expect(Math.ceil(Math.hypot(north, east) * 1.3 / 75)).toBeLessThanOrEqual(10)
        previous = { lat: stop.lat!, lon: stop.lon! }
      }
    }
  })

  it('limits a gentle city route to two stops with a localized time and amenities caveat', async () => {
    const { response, body } = await recommend({ language: 'en', text: 'Walk around interesting places',
      minutes: 240, gentlePace: true, microQuest: true })
    expect(response.status).toBe(200)
    expect(body.routes?.length).toBeGreaterThan(0)
    expect(body.routes!.every((route) => route.stops.length <= 2 &&
      (route.totalMinutesApprox ?? 0) <= 240)).toBe(true)
    expect(body.note).toContain('at most two stops')
    expect(body.note).toContain('Seating and other amenities have not been checked')
  })

  it('looks up a quoted name across OSM categories while rejecting unsafe query text', () => {
    const name = quotedVenueName('Хочу в «Fusion»')
    expect(name).toBe('Fusion')
    expect(quotedVenueName('«Cafe"];out body»')).toBeUndefined()
    expect(buildOverpassQuery(ASTANA_CENTER, ['cafe'], name)).toContain('["name"~"^Fusion$",i]')
    const raw = { elements: [{ type: 'node', id: 456, lat: 51.1424341, lon: 71.4666706,
      tags: { name: 'Fusion', amenity: 'nightclub' } }] }
    expect(parseOverpassPlaces(raw, ['cafe'])).toEqual([])
    expect(parseOverpassPlaces(raw, ['cafe'], name)[0]).toMatchObject({ category: 'nightclub', name: 'Fusion' })
  })

  it('starts a coffee and reading route at a cafe even if another stop is proposed first', () => {
    const makePlace = (id: string, category: string): DynamicPlace => ({
      id, name: id, category, lat: 51.13, lon: 71.43, visitMinutes: 30,
      sourceUrl: 'https://www.openstreetmap.org/node/1', tags: {}, provider: 'OpenStreetMap',
    })
    const route = assembleRoute({ cityId: 'astana', scope: 'city', transport: 'walk',
      minutes: 120, intents: [], text: 'Кофе и книга' },
    { theme: 'reading', categories: ['cafe', 'library'] },
    [makePlace('library', 'library'), makePlace('cafe', 'cafe'), makePlace('cafe2', 'cafe')],
    ASTANA_CENTER)
    expect(route?.stops.map((stop) => stop.category)).toEqual(['cafe', 'library'])
  })

  it('does not claim unverified quietness, outlets, capacity or current hours', async () => {
    const { response, body } = await recommend({
      text: 'Тихое кафе с розеткой, чтобы читать книгу', groupSize: 5, minutes: 180,
    })
    expect(response.status).toBe(200)
    expect(body.routes?.[0]?.stops.length).toBeGreaterThan(0)
    expect(body.routes![0].summary).toContain('Проверьте перед визитом')
    expect(body.routes![0].summary).toContain('тишина')
    expect(body.routes![0].summary).toContain('розетки')
    expect(body.routes![0].summary).toContain('5 человек')
    expect(body.routes![0].stops.filter((stop) => stop.category === 'cafe')).toHaveLength(1)
    expect(body.routes![0].stops.length).toBeLessThanOrEqual(2)
    if (body.routes![0].stops.length === 2) {
      expect(body.routes![0].stops.some((stop) => ['library', 'bookshop'].includes(stop.category))).toBe(true)
    }
    expect(body.routes![0].stops.every((stop) => !/тихое|есть розетки|открыто сейчас|хватит мест/i.test(stop.why))).toBe(true)
    expect(body.routes![0].stops.every((stop) => !stop.evidence?.length)).toBe(true)
  })

  it('accepts one to twelve people and rejects malformed group size or budget', async () => {
    const invalid = async (request: Partial<WalkRequest>) => worker.fetch(
      requestBody(request, 'invalid'), { TELEGRAM_BOT_TOKEN: token })
    expect((await invalid({ groupSize: 0 })).status).toBe(400)
    expect((await invalid({ groupSize: 13 })).status).toBe(400)
    expect((await invalid({ groupSize: 1.5 })).status).toBe(400)
    expect((await invalid({ budgetKzt: -1 })).status).toBe(400)
    expect((await invalid({ cityId: 'almaty' })).status).toBe(400)
    expect((await invalid({ excludePlaceIds: ['some arbitrary value'] })).status).toBe(400)
    expect((await recommend({ groupSize: 12 })).response.status).toBe(200)
  })

  it('finds a fresh set of places after the visitor asks for more ideas', async () => {
    const options = { text: 'Кофе и книга', minutes: 180 }
    const first = await recommend(options)
    const seen = [...new Set(first.body.routes!.flatMap((route) => route.stops.map((stop) => stop.id)))]
    expect(seen.length).toBeGreaterThan(1)
    const next = await recommend({ ...options, excludePlaceIds: seen })
    expect(next.response.status).toBe(200)
    expect(next.body.routes!.length).toBeGreaterThan(0)
    expect(next.body.routes!.flatMap((route) => route.stops).every((stop) => !seen.includes(stop.id))).toBe(true)
  })

  it('does not recommend an OSM water park whose closure has a public source', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [] }),
      { headers: { 'Content-Type': 'application/json' } })))
    try {
      const { response, body } = await recommend({ text: 'Хочу в аквапарк', minutes: 240 })
      expect(response.status).toBe(200)
      expect(body.routes?.flatMap((route) => route.stops).some((stop) => stop.id === 'osm:node:10168968309')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the budget promise honest when city prices are unknown', async () => {
    const free = await recommend({ text: 'Прогулка по Астане', budgetKzt: 0, minutes: 180 })
    expect(free.response.status).toBe(200)
    expect(free.body.note).toContain('бесплатность остальных мест не подтверждена')
    expect(free.body.routes?.[0]?.stops.every((stop) =>
      !['cafe', 'restaurant', 'fast_food', 'confectionery', 'mall', 'bar', 'nightclub', 'bookshop'].includes(stop.category))).toBe(true)

    const limited = await recommend({ text: 'Кофе и книга', budgetKzt: 2000, minutes: 180 })
    expect(limited.response.status).toBe(200)
    expect(limited.body.note).toContain('маршрут не отфильтрован по указанной сумме')
  })

  it('explains when GPS starts outside Astana', async () => {
    const { response, body } = await recommend({ latitude: 50, longitude: 70 })
    expect(response.status).toBe(200)
    expect(body.recommendations).toEqual([])
    expect(body.routes).toEqual([])
    expect(body.summary).toContain('за пределами Астаны')
  })

  it('keeps short requests from presenting a day trip as a two-hour outing', async () => {
    const short = await recommend({ scope: 'day_trip', transport: 'car', minutes: 120 })
    expect(short.response.status).toBe(200)
    expect(short.body.routes).toEqual([])
    const long = await recommend({ scope: 'day_trip', transport: 'car', minutes: 1440 })
    expect(long.response.status).toBe(200)
    expect(long.body.routes!.length).toBeGreaterThan(0)
    expect(long.body.routes!.every((route) => route.stops.length === 1
      && route.stops[0].kind === 'trip' && route.stops[0].timeStatus === 'unknown')).toBe(true)
    expect(long.body.routes![0].routeUrl).toContain('travelmode=driving')
  })

  it('validates the rough destination and keeps walking stops on the selected heading', async () => {
    const targetArea = { lat: ASTANA_CENTER.lat, lon: ASTANA_CENTER.lon + .07 }
    const { response, body } = await recommend({ text: 'Хочу кофе', minutes: 240, targetArea })
    expect(response.status).toBe(200)
    expect(body.routes?.length).toBeGreaterThan(0)
    expect(body.routes?.[0].stops.every((stop) => stop.lat !== undefined && stop.lon !== undefined
      && onCityHeading(ASTANA_CENTER, targetArea, { lat: stop.lat, lon: stop.lon }, 'walk'))).toBe(true)
    expect(body.note).toContain('Ориентир использован')

    const invalidCity = await worker.fetch(requestBody({ targetArea: { lat: 53.1, lon: 70.3 } },
      await validInitData()), { TELEGRAM_BOT_TOKEN: token })
    expect(invalidCity.status).toBe(400)
    const invalidTrip = await worker.fetch(requestBody({ scope: 'day_trip', transport: 'car',
      targetArea: { lat: 58, lon: 71.4 } }, await validInitData()), { TELEGRAM_BOT_TOKEN: token })
    expect(invalidTrip.status).toBe(400)
  })

  it('rejects unsigned webhook calls and serves a /start launch button only with the secret', async () => {
    const update = { message: { text: '/start', chat: { id: 123, type: 'private' } } }
    const request = () => new Request('https://example.test/telegram/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update),
    })
    const env = { TELEGRAM_WEBHOOK_SECRET: 'secret', MINI_APP_URL: 'https://example.test/app' }
    expect((await worker.fetch(request(), env)).status).toBe(401)

    const signedRequest = request()
    signedRequest.headers.set('X-Telegram-Bot-Api-Secret-Token', 'secret')
    const response = await worker.fetch(signedRequest, env)
    const body = await response.json() as {
      method: string
      reply_markup: { inline_keyboard: Array<Array<{ web_app: { url: string } }>> }
    }
    expect(response.status).toBe(200)
    expect(body.method).toBe('sendMessage')
    expect(body.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://example.test/app')
  })

  it('uses Telegram language for the bot launch message', async () => {
    const sendStart = async (language_code: string) => {
      const request = new Request('https://example.test/telegram/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'secret' },
        body: JSON.stringify({ message: { text: '/start', chat: { id: 123, type: 'private' },
          from: { language_code } } }),
      })
      return await (await worker.fetch(request, {
        TELEGRAM_WEBHOOK_SECRET: 'secret', MINI_APP_URL: 'https://example.test/app',
      })).json() as { text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string }>> } }
    }
    expect((await sendStart('kk-KZ')).reply_markup.inline_keyboard[0][0].text).toBe('Серуенді ашу')
    expect((await sendStart('en-US')).text).toContain('available time')
  })
})
