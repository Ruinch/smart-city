#!/usr/bin/env node

// Import a small, reviewable OpenStreetMap pilot catalog for Astana.
// Usage: node scripts/collect-poi.mjs [--audit] [--endpoint URL]
//        node scripts/collect-poi.mjs --input data/raw/overpass-bayterek.json
// Requires Node.js 18+; no packages or credentials are needed.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ZONE = {
  id: 'bayterek',
  name: 'Бәйтерек и центр Астаны',
  center: { lat: 51.1283, lon: 71.4305 },
  radiusMeters: 2500,
}

const CATEGORY = {
  'tourism:museum': ['museum', 60],
  'tourism:gallery': ['gallery', 45],
  'tourism:attraction': ['attraction', 30],
  'tourism:viewpoint': ['viewpoint', 20],
  'tourism:artwork': ['artwork', 15],
  'tourism:theme_park': ['theme_park', 75],
  'tourism:zoo': ['zoo', 75],
  'historic:monument': ['monument', 20],
  'historic:memorial': ['memorial', 15],
  'leisure:park': ['park', 40],
  'leisure:garden': ['garden', 30],
  'leisure:playground': ['playground', 25],
  'leisure:water_park': ['water_park', 90],
  'amenity:theatre': ['theatre', 20],
  'amenity:arts_centre': ['arts_centre', 25],
  'amenity:place_of_worship': ['place_of_worship', 25],
  'amenity:cafe': ['cafe', 35],
}

const CATEGORY_CAP = {
  cafe: 4,
  playground: 3,
  monument: 2,
  park: 5,
  museum: 2,
  gallery: 2,
  attraction: 4,
  theatre: 2,
  garden: 2,
  theme_park: 2,
  place_of_worship: 1,
  arts_centre: 1,
  artwork: 1,
  memorial: 1,
  viewpoint: 1,
  zoo: 1,
  water_park: 1,
}

// Descriptions are intentionally modest: these labels come from OSM categories,
// while optional details come only from explicit OSM tags. They are not venue copy.
const DESCRIPTION_CATEGORY = {
  museum: 'Музей',
  gallery: 'Галерея',
  theatre: 'Театр',
  park: 'Парк',
  garden: 'Сад',
  playground: 'Детская площадка',
  theme_park: 'Парк развлечений',
  cafe: 'Кафе',
  viewpoint: 'Смотровая точка',
  artwork: 'Объект искусства',
  monument: 'Монумент',
  memorial: 'Мемориал',
  attraction: 'Достопримечательность',
  arts_centre: 'Центр искусств',
  place_of_worship: 'Культовое сооружение',
  zoo: 'Зоопарк',
  water_park: 'Аквапарк',
}

const CATEGORY_PRIORITY = Object.keys(CATEGORY_CAP)

// OSM's generic tourism=attraction includes individual rides and small statues.
// Keep two recognizable destinations for the pilot; access details remain unverified.
const PILOT_ATTRACTIONS = new Map([
  ['osm:way:240921034', 60], // Ailand: allow for a large complex
  ['osm:way:1449322339', 45], // Динопарк: allow for more than a photo stop
])

// A nearby OSM leisure=park way gives the 30-minute outdoor scenario a real
// walk stop. Its generic name and access details remain unverified.
const PILOT_SHORT_PARKS = new Map([
  ['osm:way:230358854', 20], // Сквер, about 485 m in a straight line from Бәйтерек
])

const OUTPUT = resolve('data/pois.json')
const RAW_OUTPUT = resolve('data/raw/overpass-bayterek.json')
const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter'

function options(argv) {
  const result = { audit: false, endpoint: DEFAULT_ENDPOINT, input: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--audit') result.audit = true
    else if (arg === '--endpoint') result.endpoint = argv[++index]
    else if (arg === '--input') result.input = argv[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!result.endpoint || !/^https:\/\//.test(result.endpoint)) {
    throw new Error('The Overpass endpoint must be an HTTPS URL.')
  }
  return result
}

async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

function query() {
  const { lat, lon } = ZONE.center
  const around = `(around:${ZONE.radiusMeters},${lat},${lon})`
  return `[out:json][timeout:60];
(
  nwr["tourism"~"^(museum|gallery|attraction|viewpoint|artwork|theme_park|zoo)$"]${around};
  nwr["historic"~"^(monument|memorial)$"]${around};
  nwr["leisure"~"^(park|garden|playground|water_park)$"]${around};
  nwr["amenity"~"^(theatre|arts_centre|place_of_worship|cafe)$"]${around};
);
out center;`
}

function coordinates(element) {
  const point = element.type === 'node' ? element : element.center
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null
  return { lat: point.lat, lon: point.lon }
}

function category(tags) {
  for (const [tag, found] of Object.entries(CATEGORY)) {
    const [key, value] = tag.split(':')
    if (tags[key] === value) return found
  }
  return null
}

function distanceMeters(first, second) {
  const radians = Math.PI / 180
  const north = (second.lat - first.lat) * radians
  const east = (second.lon - first.lon) * radians
  const a = Math.sin(north / 2) ** 2 +
    Math.cos(first.lat * radians) * Math.cos(second.lat * radians) * Math.sin(east / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function normalizedName(value) {
  return value.trim().toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]+/gu, ' ')
}

function sourceQuality(poi) {
  const tags = poi.tags
  return (
    Number(Boolean(tags.website || tags['contact:website'])) * 2 +
    Number(Boolean(tags.wikidata || tags.wikipedia)) * 2 +
    Number(Boolean(tags.opening_hours)) +
    Number(Boolean(tags['name:kk'])) +
    Number(Boolean(tags['name:ru'])) +
    Number(poi.osmType === 'node')
  )
}

function descriptionFromTags(tags, kind, point) {
  let label = DESCRIPTION_CATEGORY[kind] ?? 'Точка интереса'
  if (kind === 'park' && tags.name === 'Сквер') label = 'Сквер'
  let hasSpecificTag = false
  if (kind === 'museum' && tags.museum === 'open_air') {
    label = 'Музей под открытым небом'
    hasSpecificTag = true
  } else if (kind === 'place_of_worship' && tags.building === 'mosque') {
    label = 'Мечеть'
    hasSpecificTag = true
  } else if (kind === 'artwork' && tags.artwork_type === 'statue') {
    label = 'Статуя'
    hasSpecificTag = true
  } else if (kind === 'playground' && tags.amenity === 'childcare') {
    label = 'Объект с тегами детской площадки и ухода за детьми'
    hasSpecificTag = true
  } else if (kind === 'cafe' && tags.cuisine === 'coffee_shop') {
    label = 'Кофейня'
    hasSpecificTag = true
  }

  const street = typeof tags['addr:street'] === 'string'
    ? tags['addr:street'].replace(/[<>\r\n]/g, ' ').trim().slice(0, 80) : ''
  const house = typeof tags['addr:housenumber'] === 'string'
    ? tags['addr:housenumber'].replace(/[<>\r\n]/g, ' ').trim().slice(0, 20) : ''
  const address = street ? ` Адрес по OSM: ${street}${house ? `, ${house}` : ''}.` : ''
  const indoor = tags.indoor && tags.indoor !== 'no'
    ? ' В OSM указан тег размещения в помещении.' : ''
  const straightLineMeters = distanceMeters(point, ZONE.center)
  const distance = straightLineMeters < 25 ? ''
    : ` Примерно в ${Math.max(100, Math.round(straightLineMeters / 100) * 100)} м по прямой от Бәйтерека (по координатам OSM).`
  return {
    description: `${label} в пилотной зоне вокруг Бәйтерека.${distance}${indoor}${address}`,
    descriptionSource: hasSpecificTag || indoor || address ? 'osm_tags' : 'category_template',
  }
}

function normalize(element) {
  const tags = element.tags
  if (!tags || typeof tags !== 'object') return null
  const name = tags.name?.trim()
  if (!name || /^(yes|no)$/i.test(name)) return null
  if (['private', 'no'].includes(tags.access)) return null
  if (tags.disused === 'yes' || tags.abandoned === 'yes' || tags.construction === 'yes') return null
  // Small prayer rooms are not public sightseeing destinations in this catalog.
  if (tags.amenity === 'place_of_worship' && ![
    'mosque', 'church', 'cathedral', 'temple', 'synagogue',
  ].includes(tags.building)) return null
  const point = coordinates(element)
  if (!point || distanceMeters(point, ZONE.center) > ZONE.radiusMeters) return null
  const mapped = category(tags)
  if (!mapped) return null
  const [kind, categoryVisitMinutes] = mapped
  const id = `osm:${element.type}:${element.id}`
  if (kind === 'attraction' && !PILOT_ATTRACTIONS.has(id)) return null
  const visitMinutes = PILOT_ATTRACTIONS.get(id) ?? PILOT_SHORT_PARKS.get(id) ?? categoryVisitMinutes
  const names = Object.fromEntries(
    ['ru', 'kk', 'en']
      .filter((language) => typeof tags[`name:${language}`] === 'string' && tags[`name:${language}`].trim())
      .map((language) => [language, tags[`name:${language}`].trim()]),
  )
  return {
    id,
    name,
    ...(Object.keys(names).length ? { names } : {}),
    category: kind,
    ...descriptionFromTags(tags, kind, point),
    lat: point.lat,
    lon: point.lon,
    visitMinutes,
    sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    osmType: element.type,
    osmId: element.id,
    tags,
  }
}

function select(elements) {
  const candidates = elements.map(normalize).filter(Boolean)
  candidates.sort((a, b) => {
    const quality = sourceQuality(b) - sourceQuality(a)
    if (quality) return quality
    const distance = distanceMeters(a, ZONE.center) - distanceMeters(b, ZONE.center)
    if (distance) return distance
    return a.id.localeCompare(b.id)
  })

  const deduped = []
  for (const poi of candidates) {
    const duplicate = deduped.some((existing) =>
      normalizedName(existing.name) === normalizedName(poi.name) &&
      distanceMeters(existing, poi) < 120,
    )
    if (!duplicate) deduped.push(poi)
  }

  const selected = []
  for (const kind of CATEGORY_PRIORITY) {
    const choices = deduped.filter((poi) => poi.category === kind)
    if (kind === 'park') {
      const shortParks = choices.filter((poi) => PILOT_SHORT_PARKS.has(poi.id))
      const otherParks = choices.filter((poi) => !PILOT_SHORT_PARKS.has(poi.id))
      selected.push(...[...shortParks, ...otherParks].slice(0, CATEGORY_CAP[kind]))
    } else {
      selected.push(...choices.slice(0, CATEGORY_CAP[kind]))
    }
  }
  const curated = selected.slice(0, 30)
  curated.sort((a, b) => {
    const distance = distanceMeters(a, ZONE.center) - distanceMeters(b, ZONE.center)
    return distance || a.id.localeCompare(b.id)
  })
  return { candidates, deduped, selected: curated }
}

async function main() {
  const { audit, endpoint, input } = options(process.argv.slice(2))
  let payload
  if (input) {
    payload = JSON.parse(await readFile(resolve(input), 'utf8'))
  } else {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'User-Agent': 'SmartCityHackathonPOIImporter/0.1 (+https://github.com/Ruinch/smart-city)',
      },
      body: new URLSearchParams({ data: query() }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300).replace(/\s+/g, ' ')
      throw new Error(`Overpass returned HTTP ${response.status}. ${detail}`)
    }
    payload = await response.json()
  }
  if (!Array.isArray(payload.elements)) throw new Error('Overpass returned no elements array.')
  const { candidates, deduped, selected } = select(payload.elements)
  const categories = Object.fromEntries(
    [...new Set(deduped.map((poi) => poi.category))]
      .sort()
      .map((kind) => [kind, deduped.filter((poi) => poi.category === kind).length]),
  )
  console.log(JSON.stringify({
    zone: ZONE.id,
    osmBaseTimestamp: payload.osm3s?.timestamp_osm_base,
    fetched: payload.elements.length,
    candidates: candidates.length,
    deduped: deduped.length,
    selected: selected.length,
    categories,
    names: selected.map((poi) => `${poi.name} (${poi.category})`),
    ...(audit ? {
      attractionCandidates: deduped
        .filter((poi) => ['attraction', 'theme_park', 'playground'].includes(poi.category))
        .map((poi) => ({
          id: poi.id,
          name: poi.name,
          category: poi.category,
          type: poi.osmType,
          tags: Object.fromEntries(
            ['attraction', 'leisure', 'tourism', 'website', 'wikipedia', 'wikidata', 'opening_hours']
              .filter((key) => poi.tags[key])
              .map((key) => [key, poi.tags[key]]),
          ),
        })),
    } : {}),
  }, null, 2))
  if (audit) return
  if (selected.length < 15) {
    throw new Error('Fewer than 15 named POIs passed validation; refusing to overwrite data/pois.json.')
  }
  const shortPark = selected.find((poi) => PILOT_SHORT_PARKS.has(poi.id))
  if (!shortPark || Math.ceil(distanceMeters(shortPark, ZONE.center) * 1.3 / 75) + shortPark.visitMinutes > 30) {
    throw new Error('The short park stop is missing or no longer fits the 30-minute pilot; refusing to overwrite data/pois.json.')
  }
  const catalog = {
    schemaVersion: 1,
    zone: ZONE,
    source: {
      provider: 'OpenStreetMap',
      importedAt: new Date().toISOString(),
      ...(payload.osm3s?.timestamp_osm_base ? { osmBaseTimestamp: payload.osm3s.timestamp_osm_base } : {}),
      attribution: '© OpenStreetMap contributors',
      licenseUrl: 'https://www.openstreetmap.org/copyright',
    },
    pois: selected,
  }
  if (!input) await saveJson(RAW_OUTPUT, payload)
  await saveJson(OUTPUT, catalog)
  console.log(`Saved ${selected.length} POIs to ${OUTPUT}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
