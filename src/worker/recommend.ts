import type { Poi, PoiCatalog, Recommendation, WalkRequest } from '../shared/types'

const OUTDOOR_CATEGORIES = new Set(['park', 'garden', 'playground', 'viewpoint', 'artwork', 'monument', 'memorial'])
const INDOOR_CATEGORIES = new Set(['museum', 'gallery', 'cafe'])

const CATEGORY_LABELS: Record<string, string> = {
  museum: 'музей',
  gallery: 'галерея',
  theatre: 'театр',
  park: 'парк',
  garden: 'сад',
  playground: 'детская площадка',
  theme_park: 'парк развлечений',
  cafe: 'кафе',
  viewpoint: 'смотровая точка',
  artwork: 'арт-объект',
  monument: 'монумент',
  memorial: 'мемориал',
  attraction: 'достопримечательность',
  arts_centre: 'центр искусств',
  place_of_worship: 'культовое сооружение',
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  museum: ['музей', 'музе', 'museum', 'мұражай'],
  gallery: ['галере', 'искусств', 'gallery', 'өнер'],
  theatre: ['театр', 'спектакл', 'theatre', 'театр'],
  park: ['парк', 'сквер', 'природ', 'дерев', 'park', 'саябақ'],
  garden: ['сад', 'цвет', 'garden', 'бақ'],
  playground: ['дет', 'площадк', 'игр', 'playground', 'балалар'],
  theme_park: ['аттракцион', 'развлечен', 'theme park', 'балалар'],
  cafe: ['кафе', 'кофе', 'перекус', 'cafe', 'coffee', 'дәмхана'],
  viewpoint: ['вид', 'панорам', 'смотров', 'viewpoint', 'көрініс'],
  artwork: ['арт', 'скульптур', 'искусств', 'art', 'өнер'],
  monument: ['памятник', 'монумент', 'истори', 'monument', 'ескерткіш'],
  memorial: ['памятник', 'мемориал', 'истори', 'memorial', 'ескерткіш'],
  attraction: ['достопримеч', 'интересн', 'красив', 'attraction', 'көрікті'],
  arts_centre: ['искусств', 'арт', 'өнер', 'arts centre'],
  place_of_worship: ['мечеть', 'храм', 'церков', 'собор', 'mosque', 'church'],
}

export interface Candidate {
  poi: Poi
  walkMinutes: number
  visitMinutes: number
  score: number
}

export interface Ranking {
  candidates: Candidate[]
  origin: { lat: number; lon: number }
  originLabel: string
}

export type ReasonCode = 'nearby' | 'theme' | 'short_visit' | 'family'
export type ActionCode = 'open_route' | 'check_hours'

export interface Selection {
  id: string
  reason: ReasonCode
  action: ActionCode
  idea?: string
}

// A model suggestion is an optional activity, never a sourced fact about the POI.
// Keep only short Russian imperative suggestions without verifiable facility claims.
function safeGeneratedIdea(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const idea = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (idea.length < 12 || idea.length > 140) return undefined
  if (!/^[\p{Script=Cyrillic}\s,.!…—–-]+$/u.test(idea)) return undefined
  if (!/^(?:Прогуляйтесь|Осмотрите|Сделайте|Посмотрите|Выберите|Запланируйте|Пройдитесь|Остановитесь|Попробуйте|Сравните)(?:\s|$)/iu.test(idea)) return undefined
  if (/(?:открыт|работа|билет|цен[аы]|бесплат|скид|выстав|событ|афиш|очеред|безопас|доступ|коляск|розет|тишин|тих\p{L}*|уют|панорам|живопис|террас|интерактив|экспонат|внутр|вход|фасад|детск|реб[её]н|wi.?fi|час\p{L}*|сегодня|сейчас)/iu.test(idea)) return undefined
  if ((idea.match(/[.!?]/g) ?? []).length > 2) return undefined
  return idea
}

function rad(degrees: number): number {
  return degrees * Math.PI / 180
}

export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const earthRadiusMeters = 6_371_000
  const deltaLat = rad(b.lat - a.lat)
  const deltaLon = rad(b.lon - a.lon)
  const latitudeA = rad(a.lat)
  const latitudeB = rad(b.lat)
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLon / 2) ** 2
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(haversine)))
}

function categoryMatchesText(poi: Poi, text: string): boolean {
  if (!text) return false
  const lower = text.normalize('NFKC').toLocaleLowerCase('ru')
  const keywords = CATEGORY_KEYWORDS[poi.category] ?? []
  if (keywords.some((keyword) => lower.includes(keyword))) return true
  const names = [poi.name, poi.names?.ru, poi.names?.kk, poi.names?.en].filter(Boolean) as string[]
  return names.some((name) => lower.includes(name.toLocaleLowerCase('ru')))
}

function isOutdoor(poi: Poi): boolean {
  const indoorTag = poi.tags.indoor?.trim().toLowerCase()
  if (indoorTag && indoorTag !== 'no') return false
  if (poi.tags.museum === 'open_air' || indoorTag === 'no' || poi.tags.outdoor === 'yes') return true
  if (poi.tags.outdoor === 'no') return false
  if (poi.category === 'playground' || poi.category === 'theme_park') return false
  return OUTDOOR_CATEGORIES.has(poi.category) || poi.tags.outdoor === 'yes'
}

function isIndoor(poi: Poi): boolean {
  const indoorTag = poi.tags.indoor?.trim().toLowerCase()
  if (indoorTag && indoorTag !== 'no') return true
  if (indoorTag === 'no' || poi.tags.outdoor === 'yes' || poi.tags.museum === 'open_air') return false
  return INDOOR_CATEGORIES.has(poi.category)
}

function chooseOrigin(catalog: PoiCatalog, request: WalkRequest): { origin: Ranking['origin']; label: string } {
  if (request.latitude !== undefined && request.longitude !== undefined) {
    return { origin: { lat: request.latitude, lon: request.longitude }, label: 'вашего местоположения' }
  }
  if (request.landmarkId === catalog.zone.id) {
    return { origin: catalog.zone.center, label: `центра района «${catalog.zone.name}»` }
  }
  if (request.landmarkId) {
    const landmark = catalog.pois.find((poi) => poi.id === request.landmarkId)
    if (landmark) return { origin: { lat: landmark.lat, lon: landmark.lon }, label: landmark.name }
  }
  return { origin: catalog.zone.center, label: `центра района «${catalog.zone.name}»` }
}

export function rankCandidates(catalog: PoiCatalog, request: WalkRequest): Ranking {
  const { origin, label } = chooseOrigin(catalog, request)
  const transport = request.transport ?? 'walk'
  const wantsOutdoor = request.intents.includes('outdoors')
  const wantsIndoor = request.intents.includes('indoors')
  const wantsFamily = request.intents.includes('child')

  const candidates: Candidate[] = []
  for (const poi of catalog.pois) {
    if (request.landmarkId === poi.id) continue
    if (request.landmarkId === catalog.zone.id && distanceMeters(origin, poi) < 40) continue
    if (wantsOutdoor && !wantsIndoor && !isOutdoor(poi)) continue
    if (wantsIndoor && !wantsOutdoor && !isIndoor(poi)) continue
    // A zero budget rules out explicitly paid entry. Missing fee data does not
    // mean free entry and remains marked as an unknown cost in the response.
    if (request.budgetKzt === 0 && poi.tags.fee?.trim().toLowerCase() === 'yes') continue

    // No street routing API is called here. The 1.3 factor is only a walking estimate.
    const walkMinutes = Math.ceil(distanceMeters(origin, poi) * 1.3 / 75)
    const visitMinutes = Number.isFinite(poi.visitMinutes) && poi.visitMinutes > 0 ? poi.visitMinutes : 20
    // Road and transit travel times are unknown for city POIs. For those modes we
    // only check the visit allowance and label the total time as unverified.
    if ((transport === 'walk' ? walkMinutes + visitMinutes : visitMinutes) > request.minutes) continue

    const themeMatch = categoryMatchesText(poi, request.text)
    const familyHeuristic = wantsFamily
      ? poi.category === 'playground' ? 20
        : poi.category === 'theme_park' ? 16
          : poi.category === 'park' ? 8
            : poi.category === 'garden' ? 6 : 0
      : 0
    const score = (themeMatch ? 25 : 0)
      + familyHeuristic
      - walkMinutes * (transport === 'walk' ? 1.7 : 0.65)
      - visitMinutes * 0.05
    candidates.push({ poi, walkMinutes, visitMinutes, score })
  }

  candidates.sort((a, b) => b.score - a.score || a.walkMinutes - b.walkMinutes || a.poi.id.localeCompare(b.poi.id))
  return { candidates, origin, originLabel: label }
}

export function pickDiverse(candidates: Candidate[], count = 3): Candidate[] {
  const remaining = [...candidates]
  const selected: Candidate[] = []
  const categories = new Set<string>()
  while (selected.length < count && remaining.length > 0) {
    remaining.sort((a, b) =>
      (b.score - (categories.has(b.poi.category) ? 7 : 0))
      - (a.score - (categories.has(a.poi.category) ? 7 : 0))
      || a.poi.id.localeCompare(b.poi.id),
    )
    const next = remaining.shift()!
    selected.push(next)
    categories.add(next.poi.category)
  }
  return selected
}

export function validateSelections(raw: unknown, candidates: Candidate[]): Selection[] {
  if (!Array.isArray(raw)) return []
  const allowed = new Set(candidates.map((candidate) => candidate.poi.id))
  const seen = new Set<string>()
  const selected: Selection[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    if (typeof value.id !== 'string' || !allowed.has(value.id) || seen.has(value.id)) continue
    if (!['nearby', 'theme', 'short_visit', 'family'].includes(String(value.reason))) continue
    if (!['open_route', 'check_hours'].includes(String(value.action))) continue
    const idea = safeGeneratedIdea(value.idea)
    seen.add(value.id)
    selected.push({
      id: value.id,
      reason: value.reason as ReasonCode,
      action: value.action as ActionCode,
      ...(idea ? { idea } : {}),
    })
    if (selected.length === 3) break
  }
  return selected
}

export function routeUrl(origin: Ranking['origin'], poi: Pick<Poi, 'lat' | 'lon'>, transport: WalkRequest['transport'] = 'walk'): string {
  const url = new URL('https://www.google.com/maps/dir/')
  url.searchParams.set('api', '1')
  url.searchParams.set('origin', `${origin.lat},${origin.lon}`)
  url.searchParams.set('destination', `${poi.lat},${poi.lon}`)
  url.searchParams.set('travelmode', transport === 'car' ? 'driving' : transport === 'transit' ? 'transit' : 'walking')
  return url.toString()
}

function safeOsmSource(poi: Poi): string {
  return `https://www.openstreetmap.org/${poi.osmType}/${poi.osmId}`
}

function hoursStatus(poi: Poi): string {
  const rawHours = poi.tags.opening_hours?.trim()
  return rawHours && rawHours.length <= 100
    ? `По OSM: ${rawHours} (не проверено)`
    : 'Доступность и часы работы не проверены'
}

function explanation(candidate: Candidate, request: WalkRequest, reason: ReasonCode, origin: Ranking['origin']): string {
  const label = CATEGORY_LABELS[candidate.poi.category] ?? 'точка интереса'
  if (request.transport && request.transport !== 'walk') {
    const mode = request.transport === 'car' ? 'на автомобиле' : 'на общественном транспорте'
    return `Это ${label} примерно в ${(distanceMeters(origin, candidate.poi) / 1000).toFixed(1)} км по прямой от старта; время дороги ${mode} не проверено.`
  }
  const walk = candidate.walkMinutes === 0 ? 'рядом со стартом' : `примерно в ${candidate.walkMinutes} мин пешком от старта`
  if (reason === 'theme' && categoryMatchesText(candidate.poi, request.text)) {
    return `Это ${label} по теме вашего запроса, ${walk}.`
  }
  if (reason === 'short_visit' || candidate.visitMinutes <= 20) {
    return `На посещение этой точки (${label}) заложено ${candidate.visitMinutes} мин; она ${walk}.`
  }
  if (reason === 'family' && request.intents.includes('child')) {
    return `Вы выбрали прогулку с ребёнком; это ${label} ${walk}. Удобства для детей не проверены.`
  }
  return `Это ${label} ${walk}; по оценке он укладывается в ${request.minutes} мин.`
}

function actionText(poi: Poi, code: ActionCode): string {
  switch (poi.category) {
    case 'park':
    case 'garden':
      return 'Проверьте доступность входа и прогуляйтесь по территории.'
    case 'monument':
    case 'memorial':
    case 'artwork':
      return isIndoor(poi)
        ? 'Уточните возможность входа и осмотрите объект, если он доступен.'
        : 'Осмотрите объект снаружи; доступность подхода проверьте на месте.'
    case 'cafe':
      return 'Перед короткой остановкой проверьте меню, часы работы и наличие мест.'
    case 'museum':
    case 'gallery':
      return 'Уточните возможность входа и часы; если доступно, осмотрите экспозицию.'
    case 'theatre':
      return 'Посмотрите здание снаружи; афишу и возможность входа проверьте отдельно.'
    case 'place_of_worship':
      return 'Осмотрите здание снаружи; правила посещения уточните отдельно.'
    case 'playground':
      return 'Уточните доступность площадки и условия посещения перед выходом.'
    case 'theme_park':
      return 'Уточните условия входа, часы и ограничения перед выходом.'
    case 'viewpoint':
      return 'Подойдите к смотровой точке; доступность площадки уточните перед визитом.'
    case 'arts_centre':
      return 'Уточните программу и возможность входа; если доступно, загляните внутрь.'
    default:
      return code === 'check_hours'
        ? 'Уточните часы и возможность посещения перед выходом.'
        : 'Подойдите к точке и проверьте доступность на месте.'
  }
}

export function toRecommendation(
  candidate: Candidate,
  origin: Ranking['origin'],
  request: WalkRequest,
  selection?: Selection,
): Recommendation {
  const reason = selection?.reason ?? (categoryMatchesText(candidate.poi, request.text) ? 'theme' : 'nearby')
  const action = selection?.action ?? (isIndoor(candidate.poi) ? 'check_hours' : 'open_route')
  const transport = request.transport ?? 'walk'
  return {
    id: candidate.poi.id,
    name: candidate.poi.name,
    category: candidate.poi.category,
    kind: 'place',
    cityId: request.cityId ?? 'astana',
    lat: candidate.poi.lat,
    lon: candidate.poi.lon,
    travelMode: transport,
    travelMinutesApprox: transport === 'walk' ? candidate.walkMinutes : undefined,
    distanceKmApprox: Math.round(distanceMeters(origin, candidate.poi) / 100) / 10,
    budgetStatus: 'unknown',
    timeStatus: transport === 'walk' ? 'within' : 'unknown',
    why: explanation(candidate, request, reason, origin),
    action: selection?.idea ?? actionText(candidate.poi, action),
    actionSource: selection?.idea ? 'ai' : 'template',
    walkMinutes: transport === 'walk' ? candidate.walkMinutes : undefined,
    visitMinutes: candidate.visitMinutes,
    hoursStatus: hoursStatus(candidate.poi),
    sourceUrl: safeOsmSource(candidate.poi),
    routeUrl: routeUrl(origin, candidate.poi, transport),
    approximate: true,
  }
}
