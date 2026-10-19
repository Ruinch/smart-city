import catalogJson from '../../data/pois.json'
import tripsJson from '../../data/astana-trips.json'
import type { CityCatalog, MapPlace, PoiCatalog, RecommendRequest, RecommendResponse, TripCatalog, WalkRequest } from '../shared/types'
import { chooseWithAI } from './ai'
import { constantTimeEqual, verifyTelegramInitData } from './auth'
import { distanceMeters, pickDiverse, rankCandidates, toRecommendation, type Candidate } from './recommend'
import { rankTrips, toTripRecommendation } from './trips'

const catalog = catalogJson as unknown as PoiCatalog
const tripCatalog = tripsJson as unknown as TripCatalog
const city: CityCatalog = {
  id: 'astana', name: 'Астана', center: catalog.zone.center,
  radiusMeters: catalog.zone.radiusMeters, pois: catalog.pois,
}
const MAX_BODY_BYTES = 16_384

interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> }
  RECOMMEND_RATE?: { limit(input: { key: string }): Promise<{ success: boolean }> }
  OPENAI_API_KEY?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_WEBHOOK_SECRET?: string
  MINI_APP_URL?: string
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'Ожидается JSON.')
  }
  const contentLength = Number(request.headers.get('content-length'))
  if (contentLength > MAX_BODY_BYTES) throw new HttpError(413, 'Запрос слишком большой.')
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, 'Пустой запрос.')

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel()
      throw new HttpError(413, 'Запрос слишком большой.')
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new HttpError(400, 'Некорректный JSON.')
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function validateRecommendBody(value: unknown): RecommendRequest {
  const body = record(value)
  const rawRequest = record(body?.request)
  if (!body || typeof body.initData !== 'string' || !rawRequest) {
    throw new HttpError(400, 'Не хватает данных для подбора.')
  }

  if (rawRequest.cityId !== undefined && rawRequest.cityId !== 'astana') {
    throw new HttpError(400, 'Сейчас доступна только Астана.')
  }
  const scope = rawRequest.scope === undefined ? 'city' : rawRequest.scope
  if (scope !== 'city' && scope !== 'day_trip') throw new HttpError(400, 'Некорректный формат поездки.')
  const transport = rawRequest.transport === undefined ? (scope === 'day_trip' ? 'car' : 'walk') : rawRequest.transport
  if (transport !== 'walk' && transport !== 'car' && transport !== 'transit') {
    throw new HttpError(400, 'Некорректный способ передвижения.')
  }

  const minutes = rawRequest.minutes
  if (!Number.isSafeInteger(minutes) || (minutes as number) < 15 || (minutes as number) > 1440) {
    throw new HttpError(400, 'Выберите время от 15 минут до 24 часов.')
  }
  if (!Array.isArray(rawRequest.intents) || rawRequest.intents.length > 3
    || rawRequest.intents.some((intent) => typeof intent !== 'string' || !['outdoors', 'indoors', 'child'].includes(intent))
    || new Set(rawRequest.intents).size !== rawRequest.intents.length
    || (rawRequest.intents.includes('outdoors') && rawRequest.intents.includes('indoors'))) {
    throw new HttpError(400, 'Некорректная тема прогулки.')
  }
  if (typeof rawRequest.text !== 'string' || rawRequest.text.length > 500) {
    throw new HttpError(400, 'Описание прогулки должно быть короче 500 символов.')
  }
  const budgetKzt = rawRequest.budgetKzt
  if (budgetKzt !== undefined && (!Number.isSafeInteger(budgetKzt) || (budgetKzt as number) < 0 || (budgetKzt as number) > 10_000_000)) {
    throw new HttpError(400, 'Укажите бюджет от 0 до 10 000 000 ₸.')
  }

  const latitude = rawRequest.latitude
  const longitude = rawRequest.longitude
  const hasLatitude = latitude !== undefined
  const hasLongitude = longitude !== undefined
  if (hasLatitude !== hasLongitude) throw new HttpError(400, 'Передайте обе координаты.')
  if (hasLatitude && (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    throw new HttpError(400, 'Некорректные координаты.')
  }

  const landmarkId = rawRequest.landmarkId
  if (landmarkId !== undefined && (typeof landmarkId !== 'string'
    || (landmarkId !== city.id && landmarkId !== catalog.zone.id
      && !catalog.pois.some((poi) => poi.id === landmarkId)))) {
    throw new HttpError(400, 'Неизвестная стартовая точка.')
  }

  const walkRequest: WalkRequest = {
    cityId: 'astana',
    scope,
    transport,
    minutes: minutes as number,
    intents: rawRequest.intents,
    text: rawRequest.text.trim(),
  }
  if (budgetKzt !== undefined) walkRequest.budgetKzt = budgetKzt as number
  if (hasLatitude) {
    walkRequest.latitude = latitude as number
    walkRequest.longitude = longitude as number
  }
  if (typeof landmarkId === 'string') walkRequest.landmarkId = landmarkId
  return { initData: body.initData, request: walkRequest }
}

function noPlacesResponse(request: WalkRequest, city: CityCatalog): RecommendResponse {
  const trip = request.scope === 'day_trip'
  return {
    summary: trip
      ? `Из ${city.name} пока нет загородных вариантов с проверенными данными, подходящих выбранным условиям.`
      : `В пилотном каталоге центра Астаны пока нет точек, подходящих для выбранного времени и условий.`,
    recommendations: [],
    note: appendUnverifiedPreferenceNote(trip
      ? 'Попробуйте увеличить время или выбрать автомобиль. Цены и время дороги показываются только при наличии источника.'
      : 'Попробуйте увеличить время, изменить тему или выбрать другой старт.', request.text),
  }
}

function outsideZoneResponse(text: string, scope: WalkRequest['scope']): RecommendResponse {
  return {
    summary: scope === 'day_trip'
      ? 'Старт поездки находится слишком далеко от центра Астаны для подбора из этого города.'
      : `Пока я подбираю прогулки только в пилотной зоне «${catalog.zone.name}». Ваш старт находится за её пределами.`,
    recommendations: [],
    note: appendUnverifiedPreferenceNote(scope === 'day_trip'
      ? 'Выберите старт в центре Астаны или отключите геолокацию.'
      : 'Выберите старт у Бәйтерека, чтобы посмотреть варианты в каталоге.', text),
  }
}

export function requestsVerifiedOpenNow(text: string): boolean {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('ru')
  return /(?:открыт\p{L}*|работа\p{L}*)\s+(?:ли\s+)?(?:прямо\s+)?сейчас/u.test(normalized)
    || /сейчас\s+(?:открыт\p{L}*|работа\p{L}*)/u.test(normalized)
    || /open\s+now|currently\s+open|қазір\s+ашық/u.test(normalized)
}

function unverifiedPreferenceNote(text: string): string {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('ru')
  const mentioned: string[] = []
  if (/тих\p{L}*|тишин\p{L}*|quiet/u.test(normalized)) mentioned.push('тишина')
  if (/розетк\p{L}*|зарядк\p{L}*|socket|outlet/u.test(normalized)) mentioned.push('розетки')
  if (/коляск\p{L}*|wheelchair|безбарьер\p{L}*/u.test(normalized)) mentioned.push('доступность для коляски')
  return mentioned.length > 0
    ? `В каталоге не проверены: ${mentioned.join(', ')}. Подбор учитывает расположение, категорию и время.`
    : ''
}

function appendUnverifiedPreferenceNote(base: string, text: string): string {
  return [base, unverifiedPreferenceNote(text)].filter(Boolean).join(' ')
}

function orderedCandidates(candidates: Candidate[], aiSelections: Awaited<ReturnType<typeof chooseWithAI>>): Array<{ candidate: Candidate; selection?: typeof aiSelections[number] }> {
  const byId = new Map(candidates.map((candidate) => [candidate.poi.id, candidate]))
  const selected: Array<{ candidate: Candidate; selection?: typeof aiSelections[number] }> = []
  const seen = new Set<string>()
  for (const choice of aiSelections) {
    const candidate = byId.get(choice.id)
    if (!candidate || seen.has(choice.id)) continue
    seen.add(choice.id)
    selected.push({ candidate, selection: choice })
    if (selected.length === 3) return selected
  }
  for (const candidate of pickDiverse(candidates, 12)) {
    if (seen.has(candidate.poi.id)) continue
    seen.add(candidate.poi.id)
    selected.push({ candidate })
    if (selected.length === 3) break
  }
  return selected
}

async function recommend(request: Request, env: Env): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'Сервис временно не настроен.' }, 503)
  const body = validateRecommendBody(await readJson(request))
  const identity = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN)
  if (!identity) return json({ error: 'Откройте приложение через Telegram заново.' }, 401)

  if (env.RECOMMEND_RATE) {
    const limit = await env.RECOMMEND_RATE.limit({ key: identity.userId })
    if (!limit.success) return json({ error: 'Слишком много запросов. Попробуйте через минуту.' }, 429)
  }

  if (body.request.latitude !== undefined && body.request.longitude !== undefined
    && distanceMeters({ lat: body.request.latitude, lon: body.request.longitude }, city.center)
      > (body.request.scope === 'day_trip' ? 30_000 : city.radiusMeters)) {
    return json(outsideZoneResponse(body.request.text, body.request.scope))
  }

  if (requestsVerifiedOpenNow(body.request.text)) {
    return json({
      summary: 'Я не могу подтвердить, какие места открыты прямо сейчас: в каталоге нет проверенных актуальных часов работы.',
      recommendations: [],
      note: appendUnverifiedPreferenceNote('Измените запрос или проверьте часы у конкретного места перед визитом.', body.request.text),
    } satisfies RecommendResponse)
  }

  if (body.request.scope === 'day_trip') {
    const candidates = rankTrips(tripCatalog.trips, city, body.request)
    if (candidates.length === 0) return json(noPlacesResponse(body.request, city))
    const recommendations = candidates.slice(0, 3).map((candidate) => toTripRecommendation(candidate, city, body.request))
    return json({
      summary: `Из ${city.name}: ${recommendations.length} ${recommendations.length === 1 ? 'идея' : 'идеи'} для поездки за город. Проверьте дорогу, стоимость и условия перед выездом.`,
      recommendations,
      note: appendUnverifiedPreferenceNote('Поездки показаны как отдельные варианты, а не единый маршрут. Если цена или время дороги не указаны, соответствие вашему бюджету или времени не подтверждено.'
        + (body.request.intents.includes('child') ? ' Условия поездки с детьми не проверены.' : ''), body.request.text),
    } satisfies RecommendResponse)
  }

  const cityRequest = body.request.landmarkId === 'astana'
    ? { ...body.request, landmarkId: catalog.zone.id }
    : body.request
  const ranking = rankCandidates(catalog, cityRequest)
  if (ranking.candidates.length === 0) return json(noPlacesResponse(body.request, city))

  const aiSelections = env.OPENAI_API_KEY && body.request.transport === 'walk'
    ? await chooseWithAI(env.OPENAI_API_KEY, body.request, ranking.candidates)
    : []
  const choices = orderedCandidates(ranking.candidates, aiSelections)
  const recommendations = choices.map(({ candidate, selection }) =>
    toRecommendation(candidate, ranking.origin, cityRequest, selection),
  )
  const result: RecommendResponse = {
    summary: `Вот ${recommendations.length} ${recommendations.length === 1 ? 'вариант' : 'варианта'} для прогулки в центре Астаны от ${ranking.originLabel}. Каждый вариант рассчитан отдельно.`,
    recommendations,
    note: appendUnverifiedPreferenceNote(
      body.request.transport === 'walk'
        ? 'Время пешком приблизительное; обратный путь не учтён. Цены, доступность и часы работы не проверены. Данные о точках — OpenStreetMap.'
        : 'Время дороги на выбранном транспорте и цены не проверены; время посещения — ориентир. Данные о точках — OpenStreetMap.',
      body.request.text,
    ),
  }
  return json(result)
}

function safeMiniAppUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

async function telegramWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.TELEGRAM_WEBHOOK_SECRET) return json({ error: 'Webhook не настроен.' }, 503)
  const supplied = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? ''
  if (!constantTimeEqual(supplied, env.TELEGRAM_WEBHOOK_SECRET)) return json({ error: 'Доступ запрещён.' }, 401)

  const update = record(await readJson(request))
  const message = record(update?.message)
  const chat = record(message?.chat)
  if (typeof message?.text !== 'string' || !/^\/start(?:\s|$)/.test(message.text)
    || chat?.type !== 'private' || !Number.isSafeInteger(chat?.id)) {
    return json({ ok: true })
  }

  const appUrl = safeMiniAppUrl(env.MINI_APP_URL)
  const greeting = 'Привет! Помогу выбрать прогулку в центре Астаны или поездку из Астаны за город. Укажите время, бюджет и способ передвижения — покажу варианты на карте с источниками.'
  return json({
    method: 'sendMessage',
    chat_id: chat.id,
    text: greeting,
    ...(appUrl ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть прогулку', web_app: { url: appUrl } }]] } } : {}),
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname
    try {
      if (pathname === '/api/health') {
        if (request.method !== 'GET') return json({ error: 'Метод не поддерживается.' }, 405)
        return json({ status: 'ok', cities: 1, catalogSize: catalog.pois.length + tripCatalog.trips.length })
      }
      if (pathname === '/api/catalog') {
        if (request.method !== 'GET') return json({ error: 'Метод не поддерживается.' }, 405)
        const places: MapPlace[] = catalog.pois.map((poi) => ({
          id: poi.id, name: poi.name, category: poi.category, cityId: 'astana', kind: 'place' as const,
          lat: poi.lat, lon: poi.lon, sourceUrl: `https://www.openstreetmap.org/${poi.osmType}/${poi.osmId}`,
        }))
        places.push(...tripCatalog.trips.map((trip) => ({
          id: trip.id, name: trip.name, category: trip.category, cityId: trip.cityId, kind: 'trip' as const,
          lat: trip.lat, lon: trip.lon, sourceUrl: `https://www.openstreetmap.org/${trip.osmType}/${trip.osmId}`,
        })))
        return json({
          cities: [{ id: 'astana', name: 'Астана', center: catalog.zone.center, radiusMeters: catalog.zone.radiusMeters, poiCount: catalog.pois.length }],
          places,
          source: catalog.source,
        })
      }
      if (pathname === '/api/recommend') {
        if (request.method !== 'POST') return json({ error: 'Метод не поддерживается.' }, 405)
        return await recommend(request, env)
      }
      if (pathname === '/telegram/webhook') {
        if (request.method !== 'POST') return json({ error: 'Метод не поддерживается.' }, 405)
        return await telegramWebhook(request, env)
      }
      if (pathname.startsWith('/api/') || pathname.startsWith('/telegram/')) {
        return json({ error: 'Не найдено.' }, 404)
      }
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not Found', { status: 404 })
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status)
      return json({ error: 'Временная ошибка сервиса.' }, 503)
    }
  },
}
