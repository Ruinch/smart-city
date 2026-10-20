import snapshotJson from '../../data/astana-dynamic-fallback.json'
import tripsJson from '../../data/astana-trips.json'
import exclusionsJson from '../../data/astana-place-exclusions.json'
import overtureJson from '../../data/astana-overture-verified.json'
import type { CityCatalog, Language, Poi, PoiCatalog, RecommendRequest, RecommendResponse, TripCatalog, WalkRequest } from '../shared/types'
import { constantTimeEqual, verifyTelegramInitData } from './auth'
import { distanceMeters } from './recommend'
import { rankTrips, toTripRecommendation } from './trips'
import { ASTANA_CENTER, ASTANA_RADIUS_METERS, discoverPlaces,
  insideAstana, matchesVenueName, needsLiveRefresh, quotedVenueName, rankDynamicPlaces,
  resolveNamedArea, searchIntentWithAI, selectStopsWithAI,
  type DynamicPlace, type SearchCategory } from './dynamic'
import { attachEvidence, searchVenueEvidence } from './web-evidence'
import { buildRouteVariants } from './route-variants'
import { attachPriceEvidence, researchVenuePrices, type PriceEvidence } from './price-research'
import { attachVenueDetails, collectVenueDetails } from './venue-details'
import { countPeople, countPlaces, languageOf, pick, placeName } from './i18n'
import { insideTripPlanningArea } from '../shared/astana'
import { directionMetrics } from './direction'
import { onCityHeading } from './direction'
import { importVerifiedOverture, sameVenue } from './overture'
import { search2GisVenues } from './two-gis'

const snapshot = snapshotJson as unknown as PoiCatalog & { landmarks: Poi[] }
const snapshotPlaces: DynamicPlace[] = snapshot.pois.map((poi) => ({ ...poi, provider: 'OpenStreetMap' }))
const snapshotLandmarks: DynamicPlace[] = snapshot.landmarks.map((poi) => ({ ...poi, provider: 'OpenStreetMap' }))
const tripCatalog = tripsJson as unknown as TripCatalog
const excludedCategories = new Set(exclusionsJson.exclusions.map((item) => `${item.id}|${item.category}`))
const usablePlace = (place: DynamicPlace): boolean => !excludedCategories.has(`${place.id}|${place.category}`)
export function scarceSearchCategories(categories: SearchCategory[], nearby: DynamicPlace[]): SearchCategory[] {
  const counts = new Map<string, number>()
  for (const place of nearby) counts.set(place.category, (counts.get(place.category) ?? 0) + 1)
  return categories.filter((category, index) => (counts.get(category) ?? 0) < (index === 0 ? 5 : 2))
}
const city: CityCatalog = {
  id: 'astana', name: 'Астана', center: ASTANA_CENTER,
  radiusMeters: ASTANA_RADIUS_METERS, pois: [],
}
const MAX_BODY_BYTES = 16_384

interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> }
  RECOMMEND_RATE?: { limit(input: { key: string }): Promise<{ success: boolean }> }
  OPENAI_API_KEY?: string
  TWO_GIS_API_KEY?: string
  TWO_GIS_ENABLED?: string
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

function headerLanguage(request: Request): Language {
  const preferred = request.headers.get('Accept-Language')?.split(',')[0]?.trim().toLowerCase() ?? ''
  return preferred.startsWith('kk') ? 'kk' : preferred.startsWith('en') ? 'en' : 'ru'
}

async function readJson(request: Request): Promise<unknown> {
  const language = headerLanguage(request)
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new HttpError(415, pick(language, 'Ожидается JSON.', 'JSON күтілуде.', 'JSON is required.'))
  }
  const contentLength = Number(request.headers.get('content-length'))
  if (contentLength > MAX_BODY_BYTES) throw new HttpError(413,
    pick(language, 'Запрос слишком большой.', 'Сұрау тым үлкен.', 'Request is too large.'))
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, pick(language, 'Пустой запрос.', 'Бос сұрау.', 'Empty request.'))

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel()
      throw new HttpError(413, pick(language, 'Запрос слишком большой.', 'Сұрау тым үлкен.', 'Request is too large.'))
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
    throw new HttpError(400, pick(language, 'Некорректный JSON.', 'JSON пішімі қате.', 'Invalid JSON.'))
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function validateRecommendBody(value: unknown, fallbackLanguage: Language = 'ru'): RecommendRequest {
  const body = record(value)
  const rawRequest = record(body?.request)
  const language: Language = rawRequest?.language === 'ru' || rawRequest?.language === 'kk' || rawRequest?.language === 'en'
    ? rawRequest.language : fallbackLanguage
  if (!body || typeof body.initData !== 'string' || !rawRequest) {
    throw new HttpError(400, pick(language, 'Не хватает данных для подбора.',
      'Бағыт құрастыру үшін деректер жеткіліксіз.', 'Missing data needed to build a route.'))
  }

  if (rawRequest.language !== undefined && !['ru', 'kk', 'en'].includes(String(rawRequest.language))) {
    throw new HttpError(400, pick(language, 'Неподдерживаемый язык.',
      'Бұл тілге қолдау жоқ.', 'Unsupported language.'))
  }

  if (rawRequest.cityId !== undefined && rawRequest.cityId !== 'astana') {
    throw new HttpError(400, pick(language, 'Сейчас доступна только Астана.', 'Қазір тек Астана қолжетімді.', 'Only Astana is currently available.'))
  }
  const scope = rawRequest.scope === undefined ? 'city' : rawRequest.scope
  if (scope !== 'city' && scope !== 'day_trip') throw new HttpError(400,
    pick(language, 'Некорректный формат поездки.', 'Сапар түрі қате көрсетілген.', 'Invalid trip type.'))
  const transport = rawRequest.transport === undefined ? (scope === 'day_trip' ? 'car' : 'walk') : rawRequest.transport
  if (transport !== 'walk' && transport !== 'car' && transport !== 'transit') {
    throw new HttpError(400, pick(language, 'Некорректный способ передвижения.', 'Қозғалыс тәсілі қате көрсетілген.', 'Invalid travel mode.'))
  }

  const minutes = rawRequest.minutes
  if (!Number.isSafeInteger(minutes) || (minutes as number) < 15 || (minutes as number) > 1440) {
    throw new HttpError(400, pick(language, 'Выберите время от 15 минут до 24 часов.',
      '15 минуттан 24 сағатқа дейінгі уақытты таңдаңыз.', 'Choose a duration from 15 minutes to 24 hours.'))
  }
  if (!Array.isArray(rawRequest.intents) || rawRequest.intents.length > 3
    || rawRequest.intents.some((intent) => typeof intent !== 'string' || !['outdoors', 'indoors', 'child'].includes(intent))
    || new Set(rawRequest.intents).size !== rawRequest.intents.length
    || (rawRequest.intents.includes('outdoors') && rawRequest.intents.includes('indoors'))) {
    throw new HttpError(400, pick(language, 'Некорректная тема прогулки.', 'Серуен тақырыбы қате көрсетілген.', 'Invalid walk theme.'))
  }
  if (rawRequest.accessibility !== undefined && rawRequest.accessibility !== 'osm_wheelchair_yes') {
    throw new HttpError(400, pick(language, 'Некорректный фильтр доступности.',
      'Қолжетімділік сүзгісі қате.', 'Invalid accessibility filter.'))
  }
  if (rawRequest.shortLegs !== undefined && typeof rawRequest.shortLegs !== 'boolean') {
    throw new HttpError(400, pick(language, 'Некорректный фильтр коротких переходов.',
      'Қысқа аралықтар сүзгісі қате.', 'Invalid short-hops filter.'))
  }
  if (rawRequest.shortLegs === true && (scope !== 'city' || transport !== 'walk')) {
    throw new HttpError(400, pick(language, 'Короткие переходы доступны только для пеших прогулок по Астане.',
      'Қысқа аралықтар тек Астанадағы жаяу серуенге қолжетімді.',
      'Short hops are available only for walking routes in Astana.'))
  }
  if (rawRequest.gentlePace !== undefined && typeof rawRequest.gentlePace !== 'boolean') {
    throw new HttpError(400, pick(language, 'Некорректный режим неспешной прогулки.',
      'Асықпай серуендеу режимі қате.', 'Invalid gentle pace mode.'))
  }
  if (rawRequest.microQuest !== undefined && typeof rawRequest.microQuest !== 'boolean') {
    throw new HttpError(400, pick(language, 'Некорректный сценарий прогулки.',
      'Серуен сценарийі қате.', 'Invalid walk scenario.'))
  }
  if (typeof rawRequest.text !== 'string' || rawRequest.text.length > 500) {
    throw new HttpError(400, pick(language, 'Описание прогулки должно быть короче 500 символов.',
      'Серуен сипаттамасы 500 таңбадан қысқа болуы тиіс.', 'Keep the walk description under 500 characters.'))
  }
  const budgetKzt = rawRequest.budgetKzt
  if (budgetKzt !== undefined && (!Number.isSafeInteger(budgetKzt) || (budgetKzt as number) < 0 || (budgetKzt as number) > 10_000_000)) {
    throw new HttpError(400, pick(language, 'Укажите бюджет от 0 до 10 000 000 ₸.',
      'Бюджетті 0 мен 10 000 000 ₸ аралығында көрсетіңіз.', 'Enter a budget from 0 to 10,000,000 ₸.'))
  }
  const groupSize = rawRequest.groupSize
  if (groupSize !== undefined && (!Number.isSafeInteger(groupSize) || (groupSize as number) < 1 || (groupSize as number) > 12)) {
    throw new HttpError(400, pick(language, 'Укажите от 1 до 12 человек.',
      '1-ден 12 адамға дейін көрсетіңіз.', 'Enter a group size from 1 to 12 people.'))
  }
  const excludePlaceIds = rawRequest.excludePlaceIds
  if (excludePlaceIds !== undefined && (!Array.isArray(excludePlaceIds) || excludePlaceIds.length > 36
    || excludePlaceIds.some((id) => typeof id !== 'string'
      || !/^(?:osm:(?:node|way|relation):[1-9]\d{0,12}|overture:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|2gis:[1-9]\d{0,20})$/.test(id))
    || new Set(excludePlaceIds).size !== excludePlaceIds.length)) {
    throw new HttpError(400, pick(language, 'Некорректный список уже показанных мест.',
      'Бұрын көрсетілген орындар тізімі қате.', 'Invalid list of previously shown places.'))
  }

  const latitude = rawRequest.latitude
  const longitude = rawRequest.longitude
  const hasLatitude = latitude !== undefined
  const hasLongitude = longitude !== undefined
  if (hasLatitude !== hasLongitude) throw new HttpError(400,
    pick(language, 'Передайте обе координаты.', 'Екі координатаны да көрсетіңіз.', 'Provide both coordinates.'))
  if (hasLatitude && (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    throw new HttpError(400, pick(language, 'Некорректные координаты.', 'Координаталар қате.', 'Invalid coordinates.'))
  }

  const targetArea = rawRequest.targetArea === undefined ? undefined : record(rawRequest.targetArea)
  if (rawRequest.targetArea !== undefined && (!targetArea
    || typeof targetArea.lat !== 'number' || !Number.isFinite(targetArea.lat)
    || typeof targetArea.lon !== 'number' || !Number.isFinite(targetArea.lon)
    || targetArea.lat < -90 || targetArea.lat > 90 || targetArea.lon < -180 || targetArea.lon > 180)) {
    throw new HttpError(400, pick(language, 'Некорректный ориентир маршрута.',
      'Бағыт бағдары қате көрсетілген.', 'Invalid route heading.'))
  }
  if (targetArea && !(scope === 'city' ? insideAstana(targetArea as { lat: number; lon: number })
    : insideTripPlanningArea(targetArea as { lat: number; lon: number }))) {
    throw new HttpError(400, pick(language,
      scope === 'city' ? 'Выберите ориентир в пределах Астаны.' : 'Выберите ориентир не дальше 350 км от Астаны.',
      scope === 'city' ? 'Бағдарды Астана ішінде таңдаңыз.' : 'Бағдарды Астанадан 350 км-ден жақын таңдаңыз.',
      scope === 'city' ? 'Choose a heading within Astana.' : 'Choose a heading within 350 km of Astana.'))
  }

  const landmarkId = rawRequest.landmarkId
  if (landmarkId !== undefined && (typeof landmarkId !== 'string'
    || (landmarkId !== city.id && !snapshotLandmarks.some((poi) => poi.id === landmarkId)))) {
    throw new HttpError(400, pick(language, 'Неизвестная стартовая точка.', 'Белгісіз бастапқы нүкте.', 'Unknown starting point.'))
  }

  const walkRequest: WalkRequest = {
    cityId: 'astana',
    language,
    scope,
    transport,
    minutes: minutes as number,
    intents: rawRequest.intents,
    text: rawRequest.text.trim(),
  }
  if (rawRequest.accessibility === 'osm_wheelchair_yes') walkRequest.accessibility = 'osm_wheelchair_yes'
  if (rawRequest.shortLegs === true) walkRequest.shortLegs = true
  if (rawRequest.gentlePace === true) walkRequest.gentlePace = true
  if (rawRequest.microQuest === true) walkRequest.microQuest = true
  if (budgetKzt !== undefined) walkRequest.budgetKzt = budgetKzt as number
  if (groupSize !== undefined) walkRequest.groupSize = groupSize as number
  if (Array.isArray(excludePlaceIds) && excludePlaceIds.length) walkRequest.excludePlaceIds = excludePlaceIds as string[]
  if (hasLatitude) {
    walkRequest.latitude = latitude as number
    walkRequest.longitude = longitude as number
  }
  if (targetArea) walkRequest.targetArea = { lat: targetArea.lat as number, lon: targetArea.lon as number }
  if (typeof landmarkId === 'string') walkRequest.landmarkId = landmarkId
  return { initData: body.initData, request: walkRequest }
}

function noPlacesResponse(request: WalkRequest, city: CityCatalog): RecommendResponse {
  const trip = request.scope === 'day_trip'
  const language = languageOf(request)
  if (request.accessibility === 'osm_wheelchair_yes') return {
    summary: trip
      ? pick(language, 'Для загородных поездок пока нет данных OSM о доступности мест для коляски.',
        'Қала сыртындағы сапар орындарының арбаға қолжетімділігі туралы OSM деректері әзірге жоқ.',
        'The out-of-city trips do not yet have OSM wheelchair access data.')
      : pick(language, 'По этому запросу пока не нашлось мест с отметкой wheelchair=yes в OSM.',
        'Бұл сұрауға OSM-де wheelchair=yes белгісі бар орындар әзірге табылмады.',
        'No places tagged wheelchair=yes in OSM matched this request yet.'),
    recommendations: [], routes: [],
    note: pick(language,
      'Отсутствие отметки не означает недоступность места. Попробуйте другую тему или старт; доступность тротуаров, бордюров и транспорта не проверена.',
      'Белгінің болмауы орын қолжетімсіз дегенді білдірмейді. Басқа тақырыпты не бастау нүктесін таңдаңыз; тротуар, жиек және көлік қолжетімділігі тексерілмеген.',
      'A missing tag does not mean a place is inaccessible. Try another theme or start; sidewalks, kerbs and transport access have not been checked.'),
  }
  return {
    summary: request.targetArea
      ? trip
        ? pick(language, 'В выбранном направлении пока нет подходящей поездки с проверенными данными.',
          'Таңдалған бағытта дерегі тексерілген қолайлы сапар табылмады.',
          'No sourced trip matched the selected heading.')
        : pick(language, 'В выбранном направлении не нашлось подходящих мест для этого времени и запроса.',
          'Таңдалған бағытта осы уақыт пен сұрауға сай орын табылмады.',
          'No suitable places matched this heading, time and request.')
      : trip
      ? pick(language, `Из ${city.name} пока нет загородных вариантов с проверенными данными, подходящих выбранным условиям.`,
        'Таңдалған шарттарға сай дерегі тексерілген қала сыртындағы нұсқалар табылмады.',
        'No sourced trips from Astana matched your selected conditions.')
      : pick(language, 'По вашему запросу не нашлось подходящих мест в доступных каталогах Астаны для выбранного времени.',
        'Сұрауыңыз бен таңдаған уақытыңызға сай Астана каталогтарынан орын табылмады.',
        'No places in the available Astana catalogs matched your request and available time.'),
    recommendations: [],
    routes: [],
    note: appendUnverifiedPreferenceNote(request.targetArea
      ? pick(language, 'Попробуйте сдвинуть ориентир, увеличить время или убрать направление. Ориентир задаёт примерную сторону движения, не точный адрес прибытия.',
        'Бағдарды жылжытып, уақытты ұлғайтып немесе бағыт таңдауын алып көріңіз. Ол нақты жету мекенжайы емес.',
        'Move the heading, allow more time or clear it. It indicates a rough direction, not an exact arrival address.')
      : trip
      ? pick(language, 'Попробуйте увеличить время или выбрать автомобиль. Цены и время дороги показываются только при наличии источника.',
        'Уақытты көбейтіп немесе көлікпен жүруді таңдап көріңіз. Бағалар мен жол уақыты тек дереккөзі болса көрсетіледі.',
        'Try allowing more time or choosing a car. Prices and travel times appear only when a source is available.')
      : pick(language, `Попробуйте увеличить время, изменить пожелание или выбрать другой старт. Каталоги мест могут быть неполными. ${cityBudgetNote(request.budgetKzt, 0, language)}`,
        `Уақытты көбейтіп, тілегіңізді өзгертіп немесе басқа бастапқы нүктені таңдаңыз. Орындар каталогтары толық болмауы мүмкін. ${cityBudgetNote(request.budgetKzt, 0, language)}`,
        `Try allowing more time, changing your request or choosing another start. Place catalogs may be incomplete. ${cityBudgetNote(request.budgetKzt, 0, language)}`),
      request.text, language),
  }
}

function cityBudgetNote(budgetKzt: number | undefined, researchedPrices = 0, language: Language = 'ru'): string {
  if (budgetKzt === undefined) return ''
  return budgetKzt === 0
    ? pick(language, 'При нулевом бюджете исключены коммерческие категории, но бесплатность остальных мест не подтверждена.',
      'Бюджет 0 ₸ болса, коммерциялық санаттар алынып тасталады, бірақ қалған орындардың тегін екені расталмаған.',
      'With a zero budget, commercial categories are excluded, but other places have not been confirmed as free.')
    : researchedPrices > 0
      ? pick(language, 'Подтверждённые цены билетов и средние чеки учтены при порядке вариантов; неизвестные расходы и полная стоимость маршрута не позволяют гарантировать соответствие бюджету.',
        'Расталған билет бағалары мен орташа чектер нұсқаларды реттеуге қолданылды; белгісіз шығындар болғандықтан толық бағыттың бюджетке сай келетініне кепілдік жоқ.',
        'Sourced ticket prices and average bills affect route order; unknown expenses mean the full outing cannot be guaranteed to fit your budget.')
      : pick(language, 'Цены городских мест не проверены, поэтому маршрут не отфильтрован по указанной сумме.',
        'Қаладағы орындардың бағалары тексерілмеген, сондықтан бағыт көрсетілген сома бойынша сүзілмеді.',
        'City venue prices were not verified, so the route was not filtered by your budget.')
}

function outsideZoneResponse(text: string, scope: WalkRequest['scope'], language: Language): RecommendResponse {
  return {
    summary: scope === 'day_trip'
      ? pick(language, 'Старт поездки находится за пределами Астаны. Выберите точку в городе.',
        'Сапардың бастапқы нүктесі Астанадан тыс жерде. Қала ішіндегі нүктені таңдаңыз.',
        'Your trip starts outside Astana. Choose a point in the city.')
      : pick(language, 'Старт находится за пределами Астаны. Выберите точку в городе.',
        'Бастапқы нүкте Астанадан тыс жерде. Қала ішіндегі нүктені таңдаңыз.',
        'Your starting point is outside Astana. Choose a point in the city.'),
    recommendations: [],
    routes: [],
    note: appendUnverifiedPreferenceNote(pick(language,
      'Укажите точку старта в Астане на карте или сбросьте выбор до центра города.',
      'Бастау нүктесін Астана картасынан таңдаңыз немесе қала орталығына қайтарыңыз.',
      'Choose a starting point in Astana on the map or reset to the city center.'), text, language),
  }
}

export function requestsVerifiedOpenNow(text: string): boolean {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('ru')
  return /(?:открыт\p{L}*|работа\p{L}*)\s+(?:ли\s+)?(?:прямо\s+)?сейчас/u.test(normalized)
    || /сейчас\s+(?:открыт\p{L}*|работа\p{L}*)/u.test(normalized)
    || /open\s+now|currently\s+open|қазір\s+ашық/u.test(normalized)
}

function unverifiedPreferenceNote(text: string, language: Language): string {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('ru')
  const mentioned: string[] = []
  if (/тих\p{L}*|тишин\p{L}*|quiet|тыныш/u.test(normalized)) mentioned.push(pick(language, 'тишина', 'тыныштық', 'quiet atmosphere'))
  if (/розетк\p{L}*|зарядк\p{L}*|socket|outlet/u.test(normalized)) mentioned.push(pick(language, 'розетки', 'розеткалар', 'power outlets'))
  if (/коляск\p{L}*|wheelchair|безбарьер\p{L}*|арба/u.test(normalized)) mentioned.push(pick(language,
    'доступность для коляски', 'арбаға қолжетімділік', 'wheelchair access'))
  return mentioned.length > 0
    ? pick(language, `В каталоге не проверены: ${mentioned.join(', ')}. Подбор учитывает расположение, категорию и время.`,
      `Каталогта тексерілмеген: ${mentioned.join(', ')}. Таңдау орынға, санатқа және уақытқа негізделген.`,
      `The catalog does not verify: ${mentioned.join(', ')}. Suggestions consider location, category and time.`)
    : ''
}

function appendUnverifiedPreferenceNote(base: string, text: string, language: Language): string {
  return [base, unverifiedPreferenceNote(text, language)].filter(Boolean).join(' ')
}

async function recommend(request: Request, env: Env): Promise<Response> {
  const body = validateRecommendBody(await readJson(request), headerLanguage(request))
  const language = languageOf(body.request)
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: pick(language, 'Сервис временно не настроен.',
    'Қызмет уақытша бапталмаған.', 'The service is temporarily unavailable.') }, 503)
  const identity = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN)
  if (!identity) return json({ error: pick(language, 'Откройте приложение через Telegram заново.',
    'Қосымшаны Telegram арқылы қайта ашыңыз.', 'Reopen the app through Telegram.') }, 401)

  if (env.RECOMMEND_RATE) {
    const limit = await env.RECOMMEND_RATE.limit({ key: identity.userId })
    if (!limit.success) return json({ error: pick(language, 'Слишком много запросов. Попробуйте через минуту.',
      'Сұраулар тым көп. Бір минуттан кейін қайталаңыз.', 'Too many requests. Try again in a minute.') }, 429)
  }

  if (body.request.latitude !== undefined && body.request.longitude !== undefined
    && !insideAstana({ lat: body.request.latitude, lon: body.request.longitude })) {
    return json(outsideZoneResponse(body.request.text, body.request.scope, language))
  }

  if (body.request.scope === 'day_trip') {
    if (body.request.accessibility === 'osm_wheelchair_yes') return json(noPlacesResponse(body.request, city))
    const candidates = rankTrips(tripCatalog.trips, city, body.request)
    if (candidates.length === 0) return json(noPlacesResponse(body.request, city))
    const recommendations = candidates.slice(0, 3).map((candidate) => toTripRecommendation(candidate, city, body.request))
    const tripOrigin = body.request.latitude !== undefined && body.request.longitude !== undefined
      ? { lat: body.request.latitude, lon: body.request.longitude } : city.center
    const routes = recommendations.map((item) => ({
      id: `route-${item.id}`, title: item.name,
      summary: pick(language, 'Отдельная поездка из Астаны. Время дороги и расходы могут быть неизвестны.',
        'Астанадан жеке сапар. Жол уақыты мен шығындар белгісіз болуы мүмкін.',
        'A separate trip from Astana. Travel time and costs may be unknown.'),
      stops: [{ ...item, stopOrder: 1 }], routeUrl: item.routeUrl, origin: tripOrigin,
    }))
    return json({
      summary: pick(language,
        `Из ${city.name}: ${recommendations.length} ${recommendations.length === 1 ? 'идея' : 'идеи'} для поездки за город. Проверьте дорогу, стоимость и условия перед выездом.`,
        `Астанадан қала сыртына ${recommendations.length} сапар нұсқасы. Жолды, бағаны және келу шарттарын алдын ала тексеріңіз.`,
        `${recommendations.length} ${recommendations.length === 1 ? 'trip idea' : 'trip ideas'} from Astana. Check travel, costs and visiting conditions before setting out.`),
      recommendations,
      routes,
      note: appendUnverifiedPreferenceNote(pick(language,
        'Поездки показаны как отдельные варианты, а не единый маршрут. Если цена или время дороги не указаны, соответствие вашему бюджету или времени не подтверждено.',
        'Сапарлар бір бағыт емес, бөлек нұсқалар ретінде берілген. Баға немесе жол уақыты көрсетілмесе, бюджет пен уақытқа сәйкестігі расталмаған.',
        'Trips are separate options, not one combined route. If price or travel time is missing, the fit with your budget or schedule is unverified.')
        + (body.request.intents.includes('child') ? ` ${pick(language,
          'Условия поездки с детьми не проверены.', 'Балалармен сапар шарттары тексерілмеген.',
          'Conditions for travelling with children have not been verified.')}` : '')
        + ((body.request.groupSize ?? 1) > 1 ? ` ${pick(language,
          `Наличие мест для ${countPeople(language, body.request.groupSize!)} не подтверждено.`,
          `${countPeople(language, body.request.groupSize!)} орын бар екені расталмаған.`,
          `Availability for ${countPeople(language, body.request.groupSize!)} has not been verified.`)}` : '')
        + (body.request.targetArea ? ` ${pick(language,
          'Выбранный ориентир использован как примерное направление; поездка может завершиться в другой точке.',
          'Таңдалған бағдар шамамен бағыт ретінде қолданылды; сапар басқа жерде аяқталуы мүмкін.',
          'The selected area guided the rough direction; the trip may end elsewhere.')}` : ''),
      body.request.text, language)
      + (body.request.microQuest ? ` ${pick(language,
        'Микро-квест доступен только для городских маршрутов; поездки показаны как отдельные варианты.',
        'Шағын квест тек қалалық бағыттарға арналған; сапарлар жеке нұсқа ретінде көрсетілді.',
        'The mini quest is available only for city routes; trips are shown as separate options.')}` : '')
      + (body.request.gentlePace ? ` ${pick(language,
        'Неспешный темп применяется только к городским маршрутам; для поездки длительность и паузы не рассчитаны.',
        'Асықпай жүру режимі тек қалалық бағыттарға қолданылады; сапардың уақыты мен үзілістері есептелмеген.',
        'Gentle pace applies only to city routes; trip duration and pauses were not calculated.')}` : ''),
    } satisfies RecommendResponse)
  }

  const intent = await searchIntentWithAI(env.OPENAI_API_KEY, body.request)
  const namedArea = body.request.latitude === undefined
    ? (body.request.landmarkId && body.request.landmarkId !== city.id
      ? snapshotLandmarks.find((place) => place.id === body.request.landmarkId) ?? null
      : resolveNamedArea(body.request.text, intent.areaHint, snapshotLandmarks))
    : null
  const origin = body.request.latitude !== undefined && body.request.longitude !== undefined
    ? { lat: body.request.latitude, lon: body.request.longitude }
    : namedArea ? { lat: namedArea.lat, lon: namedArea.lon } : city.center
  const categories = new Set<string>(intent.categories)
  const exactName = quotedVenueName(body.request.text)
  // Verify evidence age at request time. Worker module initialization can run
  // with a frozen clock, so top-level Date() would reject every new record.
  const overtureImport = importVerifiedOverture(overtureJson, snapshotPlaces, new Date())
  const catalogPlaces: DynamicPlace[] = [...snapshotPlaces, ...overtureImport.places]
  const nearbySnapshot = catalogPlaces.filter((place) => usablePlace(place) && insideAstana(place)
    && ((categories.has(place.category) && distanceMeters(origin, place) <= (body.request.targetArea ? 50_000 : 25_000))
      || (exactName && matchesVenueName(place.name, exactName))))
  const nearbyInHeading = body.request.targetArea
    ? nearbySnapshot.filter((place) => onCityHeading(origin, body.request.targetArea!, place, body.request.transport))
    : nearbySnapshot
  const wheelchairOnly = body.request.accessibility === 'osm_wheelchair_yes'
  const accessibleNearby = wheelchairOnly
    ? nearbyInHeading.filter((place) => place.tags.wheelchair === 'yes') : nearbyInHeading
  const scarceCategories = scarceSearchCategories(intent.categories, accessibleNearby)
  const [live, twoGis] = await Promise.all([
    scarceCategories.length > 0 || needsLiveRefresh(body.request.text)
      ? discoverPlaces(body.request.targetArea ?? origin,
        scarceCategories.length ? scarceCategories : intent.categories, exactName, wheelchairOnly)
      : Promise.resolve(null),
    wheelchairOnly || env.TWO_GIS_ENABLED !== 'true'
      ? Promise.resolve({ places: [], status: 'disabled' as const })
      : search2GisVenues(env.TWO_GIS_API_KEY, {
        categories: intent.categories,
        center: body.request.targetArea ?? origin,
        language,
      }),
  ])
  const merged = new Map<string, DynamicPlace>(nearbySnapshot.map((place) => [place.id, place]))
  for (const place of live ?? []) if (usablePlace(place)) merged.set(place.id, place)
  for (const place of twoGis.places) {
    if (!usablePlace(place) || [...merged.values()].some((known) => sameVenue(known, place))) continue
    merged.set(place.id, place)
  }
  const places = [...merged.values()]
  const previouslyShown = new Set(body.request.excludePlaceIds ?? [])
  const candidates = rankDynamicPlaces(places, body.request, intent, origin)
    .filter((place) => !previouslyShown.has(place.id))
  if (!candidates.length) return json(noPlacesResponse(body.request, city))
  const aiIds = await selectStopsWithAI(env.OPENAI_API_KEY, body.request, intent, candidates, origin)
  const byId = new Map(candidates.map((poi) => [poi.id, poi]))
  const aiSelected = aiIds.map((id) => byId.get(id)).filter((poi): poi is DynamicPlace => !!poi)
  if (body.request.targetArea) aiSelected.sort((left, right) =>
    (directionMetrics(origin, body.request.targetArea!, left)?.progress ?? 0)
    - (directionMetrics(origin, body.request.targetArea!, right)?.progress ?? 0))
  const selected = [...aiSelected,
    ...candidates.filter((poi) => !aiIds.includes(poi.id))]
  const routes = buildRouteVariants(body.request, intent, selected, origin,
    namedArea ? placeName(namedArea, language) : undefined)
  if (!routes.length) return json(noPlacesResponse(body.request, city))
  const selectedPlaces = [...new Set(routes.flatMap((candidate) => candidate.stops.map((stop) => stop.id)))]
    .map((id) => byId.get(id)).filter((poi): poi is DynamicPlace => !!poi)
  const sourceProviders = new Set(selectedPlaces.map((place) => place.provider))
  const [findings, researchedPrices, venueDetails] = await Promise.all([
    searchVenueEvidence(env.OPENAI_API_KEY, body.request, selectedPlaces, env.RECOMMEND_RATE),
    researchVenuePrices(env.OPENAI_API_KEY, body.request, selectedPlaces, env.RECOMMEND_RATE),
    collectVenueDetails(selectedPlaces, language).catch(() => ({ details: [], prices: [] })),
  ])
  const pricePriority = (unit: PriceEvidence['unit']): number =>
    unit === 'entry' ? 3 : unit === 'average_bill' ? 2 : 1
  const pricesByPlace = new Map(researchedPrices.map((price) => [price.id, price]))
  for (const price of venueDetails.prices) {
    const previous = pricesByPlace.get(price.id)
    if (!previous || pricePriority(price.unit) > pricePriority(previous.unit)
      || (price.unit === previous.unit && price.sourceKind === 'official_site')) {
      pricesByPlace.set(price.id, price)
    }
  }
  const prices = [...pricesByPlace.values()]
  const allStops = routes.flatMap((candidate) => candidate.stops)
  attachEvidence(allStops, findings, language)
  attachVenueDetails(allStops, venueDetails.details, body.request.text)
  attachPriceEvidence(routes, prices, body.request.budgetKzt)
  const route = routes[0]
  const result: RecommendResponse = {
    summary: pick(language,
      `${route.title}: ${countPlaces(language, route.stops.length)} по вашему запросу${namedArea ? `, от ${placeName(namedArea, language)}` : ''}.`,
      `${route.title}: сұрауыңызға сай ${countPlaces(language, route.stops.length)}${namedArea ? `, бастапқы нүкте — ${placeName(namedArea, language)}` : ''}.`,
      `${route.title}: ${countPlaces(language, route.stops.length)} matched your request${namedArea ? `, starting near ${placeName(namedArea, language)}` : ''}.`),
    recommendations: route.stops,
    routes,
    note: pick(language,
      `Основа поиска — выгрузка OpenStreetMap от ${(snapshot.source.osmBaseTimestamp ?? snapshot.source.importedAt).slice(0, 10)}.${live?.length ? ' Дополнено живым поиском Overpass.' : ''}`,
      `Іздеу негізі — ${(snapshot.source.osmBaseTimestamp ?? snapshot.source.importedAt).slice(0, 10)} күнгі OpenStreetMap деректері.${live?.length ? ' Overpass арқылы жаңа деректер қосылды.' : ''}`,
      `Search is based on OpenStreetMap data from ${(snapshot.source.osmBaseTimestamp ?? snapshot.source.importedAt).slice(0, 10)}.${live?.length ? ' Supplemented by a live Overpass search.' : ''}`)
      + (sourceProviders.has('Overture Maps') ? ` ${pick(language,
        'В маршруте есть места Overture Maps с отдельно сверенными адресами и точками; работу заведений и часы проверьте перед визитом.',
        'Бағытта мекенжайы мен орны бөлек салыстырылған Overture Maps орындары бар; мекеменің жұмысын және уақытын барар алдында тексеріңіз.',
        'The route includes Overture Maps places with separately checked addresses and locations; confirm that each venue still operates and check its hours.')}` : '')
      + (sourceProviders.has('2GIS') ? ` ${pick(language,
        'В маршруте есть заведения из живого поиска 2ГИС; актуальность и свободные места уточните перед визитом.',
        'Бағытта 2ГИС-тің ағымдағы іздеуінен орындар бар; өзектілігі мен бос орындарды барар алдында нақтылаңыз.',
        'The route includes venues from a live 2GIS search; check current details and availability before visiting.')}` : '')
      + ` ${body.request.transport === 'walk'
        ? pick(language,
          'Время пешком приблизительное, расстояние между точками — по прямой; обратный путь не учтён.',
          'Жаяу жүру уақыты шамамен есептелген; нүктелер арасы түзу сызықпен өлшенген, кері жол есепке алынбаған.',
          'Walking time is approximate; distances between stops are straight-line estimates and the return trip is excluded.')
        : pick(language, 'Время дороги не проверено. Расстояние — по прямой.',
          'Жол уақыты тексерілмеген. Қашықтық түзу сызықпен есептелген.',
          'Travel time has not been verified. Distances are straight-line estimates.')}`
      + ` ${prices.length ? pick(language,
        'Отдельные опубликованные цены показаны с источниками; остальные расходы неизвестны.',
        'Кейбір жарияланған бағалар дереккөздерімен көрсетілген; қалған шығындар белгісіз.',
        'Some published prices are shown with sources; other expenses are unknown.')
        : pick(language, 'Цены не подтверждены.', 'Бағалар расталмаған.', 'Prices have not been verified.')}`
      + ` ${pick(language, 'Свободные места и актуальные часы работы проверьте перед визитом.',
        'Барар алдында бос орындар мен өзекті жұмыс уақытын тексеріңіз.',
        'Check availability and current opening hours before visiting.')}`
      + (body.request.budgetKzt === undefined ? '' : ` ${cityBudgetNote(body.request.budgetKzt, prices.length, language)}`)
      + (body.request.targetArea ? ` ${pick(language,
        'Ориентир использован для направления остановок; маршрут может не закончиться точно в этой точке.',
        'Бағдар аялдамалар бағытын таңдауға қолданылды; бағыт дәл сол нүктеде аяқталмауы мүмкін.',
        'The selected area guided the stop order; the route may not end at that exact point.')}` : '')
      + (wheelchairOnly ? ` ${pick(language,
        'У всех остановок есть отметка wheelchair=yes в OSM. Это сведения сообщества, не проверка на месте: тротуары, бордюры, вход и туалеты на всём пути не подтверждены.',
        'Барлық аялдамада OSM-де wheelchair=yes белгісі бар. Бұл — қауымдастық дерегі, жерде тексерілмеген: бүкіл жолдағы тротуар, жиек, кіреберіс және дәретхана расталмаған.',
        'Every stop has an OSM wheelchair=yes tag. This is community data, not an on-site check: sidewalks, kerbs, entrances and toilets along the route are unverified.')}` : '')
      + (body.request.shortLegs ? ` ${pick(language,
        'Каждый пеший переход оценён не более чем в 10 минут; реальная дорога и барьеры могут увеличить время.',
        'Әр жаяу аралық 10 минуттан аспайды деп шамаланды; нақты жол мен кедергілер уақытты ұзарта алады.',
        'Each walking leg is estimated at no more than 10 minutes; the real path and barriers may take longer.')}` : '')
      + (body.request.gentlePace ? ` ${pick(language,
        'Неспешный темп: не более двух остановок, время на них увеличено, когда позволяет лимит. Места для отдыха и другие удобства не проверены.',
        'Асықпай жүру: ең көбі екі аялдама, уақыт шегі мүмкіндік берсе, оларға көбірек уақыт бөлінді. Демалатын орындар мен басқа қолайлылықтар тексерілмеген.',
        'Gentle pace: at most two stops, with longer visits where your time allows. Seating and other amenities have not been checked.')}` : ''),
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
  const headerLocale = headerLanguage(request)
  if (!env.TELEGRAM_WEBHOOK_SECRET) return json({ error: pick(headerLocale,
    'Webhook не настроен.', 'Webhook бапталмаған.', 'Webhook is not configured.') }, 503)
  const supplied = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? ''
  if (!constantTimeEqual(supplied, env.TELEGRAM_WEBHOOK_SECRET)) return json({ error: pick(headerLocale,
    'Доступ запрещён.', 'Қол жеткізуге тыйым салынған.', 'Access denied.') }, 401)

  const update = record(await readJson(request))
  const message = record(update?.message)
  const chat = record(message?.chat)
  if (typeof message?.text !== 'string' || !/^\/start(?:\s|$)/.test(message.text)
    || chat?.type !== 'private' || !Number.isSafeInteger(chat?.id)) {
    return json({ ok: true })
  }

  const sender = record(message?.from)
  const telegramLanguage = typeof sender?.language_code === 'string' ? sender.language_code.toLowerCase() : ''
  const language: Language = telegramLanguage.startsWith('kk') ? 'kk'
    : telegramLanguage.startsWith('en') ? 'en' : 'ru'
  const appUrl = safeMiniAppUrl(env.MINI_APP_URL)
  const greeting = pick(language,
    'Привет! Опишите, куда хочется пойти в Астане: ночной клуб, кофе с книгой, музей или прогулка. Укажите время и размер компании — соберу маршрут из мест на карте. Бюджет можно добавить, но цены заведений не всегда известны.',
    'Сәлем! Астанада қайда барғыңыз келетінін жазыңыз: түнгі клуб, кітап оқитын кафе, мұражай немесе серуен. Уақыт пен адам санын көрсетіңіз — картадағы нақты орындардан бағыт құрастырамын. Бюджетті де қосуға болады, бірақ орындардың бағасы әрдайым белгілі бола бермейді.',
    'Hi! Tell me what you would like to do in Astana: a nightclub, coffee with a book, a museum or a walk. Add your available time and group size, and I will build a route with places on the map. You can set a budget, though venue prices are not always known.')
  return json({
    method: 'sendMessage',
    chat_id: chat.id,
    text: greeting,
    ...(appUrl ? { reply_markup: { inline_keyboard: [[{ text: pick(language,
      'Открыть прогулку', 'Серуенді ашу', 'Open the walk'), web_app: { url: appUrl } }]] } } : {}),
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname
    const language = headerLanguage(request)
    try {
      if (pathname === '/api/health') {
        if (request.method !== 'GET') return json({ error: pick(language,
          'Метод не поддерживается.', 'Бұл әдіске қолдау жоқ.', 'Method not allowed.') }, 405)
        const overtureImport = importVerifiedOverture(overtureJson, snapshotPlaces, new Date())
        return json({ status: 'ok', cities: 1, discovery: 'osm-overture-and-live-search',
          snapshotSize: snapshot.pois.length, snapshotDate: snapshot.source.osmBaseTimestamp ?? snapshot.source.importedAt,
          overtureSize: overtureImport.places.length, overtureRejected: overtureImport.rejected,
          overtureRelease: overtureJson.source.release,
          twoGisEnabled: env.TWO_GIS_ENABLED === 'true' && !!env.TWO_GIS_API_KEY })
      }
      if (pathname === '/api/catalog') {
        if (request.method !== 'GET') return json({ error: pick(language,
          'Метод не поддерживается.', 'Бұл әдіске қолдау жоқ.', 'Method not allowed.') }, 405)
        return json({
          cities: [{ id: 'astana', name: language === 'en' ? 'Astana' : 'Астана',
            center: city.center, radiusMeters: city.radiusMeters, poiCount: 0 }],
          places: [],
          source: snapshot.source,
        })
      }
      if (pathname === '/api/recommend') {
        if (request.method !== 'POST') return json({ error: pick(language,
          'Метод не поддерживается.', 'Бұл әдіске қолдау жоқ.', 'Method not allowed.') }, 405)
        return await recommend(request, env)
      }
      if (pathname === '/telegram/webhook') {
        if (request.method !== 'POST') return json({ error: pick(language,
          'Метод не поддерживается.', 'Бұл әдіске қолдау жоқ.', 'Method not allowed.') }, 405)
        return await telegramWebhook(request, env)
      }
      if (pathname.startsWith('/api/') || pathname.startsWith('/telegram/')) {
        return json({ error: pick(language, 'Не найдено.', 'Табылмады.', 'Not found.') }, 404)
      }
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not Found', { status: 404 })
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status)
      return json({ error: pick(language, 'Временная ошибка сервиса.',
        'Қызметте уақытша қате шықты.', 'Temporary service error.') }, 503)
    }
  },
}
