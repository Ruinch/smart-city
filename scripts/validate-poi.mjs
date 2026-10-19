import { readFile } from 'node:fs/promises'

const path = new URL('../data/pois.json', import.meta.url)
const catalog = JSON.parse(await readFile(path, 'utf8'))
const tripPath = new URL('../data/astana-trips.json', import.meta.url)
const tripCatalog = JSON.parse(await readFile(tripPath, 'utf8'))

function check(condition, message) {
  if (!condition) throw new Error(message)
}

check(catalog.schemaVersion === 1, 'Unsupported catalog schema')
check(catalog.zone?.id && catalog.zone?.name, 'Missing pilot zone')
check(Number.isFinite(catalog.zone?.center?.lat) && Number.isFinite(catalog.zone?.center?.lon), 'Invalid zone center')
check(catalog.source?.provider === 'OpenStreetMap', 'Missing OSM source')
check(Number.isFinite(Date.parse(catalog.source?.importedAt)), 'Invalid import timestamp')
check(Array.isArray(catalog.pois) && catalog.pois.length >= 15, 'Need at least 15 POIs for the pilot')

const ids = new Set()
const categories = new Map()
for (const poi of catalog.pois) {
  check(typeof poi.id === 'string' && /^osm:(node|way|relation):\d+$/.test(poi.id), `Invalid ID: ${poi.id}`)
  check(!ids.has(poi.id), `Duplicate ID: ${poi.id}`)
  ids.add(poi.id)
  check(typeof poi.name === 'string' && poi.name.trim().length > 1, `Missing name: ${poi.id}`)
  check(typeof poi.description === 'string' && poi.description.trim().length >= 15 && poi.description.length <= 240,
    `Missing or overlong description: ${poi.id}`)
  check(['osm_tags', 'category_template'].includes(poi.descriptionSource),
    `Missing description provenance: ${poi.id}`)
  check(Number.isFinite(poi.lat) && poi.lat >= -90 && poi.lat <= 90, `Invalid latitude: ${poi.id}`)
  check(Number.isFinite(poi.lon) && poi.lon >= -180 && poi.lon <= 180, `Invalid longitude: ${poi.id}`)
  check(Number.isInteger(poi.visitMinutes) && poi.visitMinutes >= 5 && poi.visitMinutes <= 180, `Invalid visit time: ${poi.id}`)
  check(poi.sourceUrl === `https://www.openstreetmap.org/${poi.osmType}/${poi.osmId}`, `Invalid source URL: ${poi.id}`)
  check(poi.tags && typeof poi.tags === 'object' && !Array.isArray(poi.tags), `Missing tags: ${poi.id}`)
  categories.set(poi.category, (categories.get(poi.category) || 0) + 1)
}

const shortPark = catalog.pois.find((poi) => poi.id === 'osm:way:230358854')
check(shortPark?.category === 'park' && shortPark?.tags?.leisure === 'park' && shortPark?.visitMinutes === 20,
  'The short park stop for the 30-minute outdoor scenario is missing or changed')
const toRadians = (degrees) => degrees * Math.PI / 180
const deltaLat = toRadians(shortPark.lat - catalog.zone.center.lat)
const deltaLon = toRadians(shortPark.lon - catalog.zone.center.lon)
const haversine = Math.sin(deltaLat / 2) ** 2
  + Math.cos(toRadians(catalog.zone.center.lat)) * Math.cos(toRadians(shortPark.lat)) * Math.sin(deltaLon / 2) ** 2
const meters = 6_371_000 * 2 * Math.asin(Math.sqrt(haversine))
check(Math.ceil(meters * 1.3 / 75) + shortPark.visitMinutes <= 30,
  'The short park stop no longer fits the approximate 30-minute outbound plan')

process.stdout.write(`Validated ${catalog.pois.length} POIs in ${catalog.zone.name}\n`)
process.stdout.write(`${[...categories].map(([name, count]) => `${name}: ${count}`).join(', ')}\n`)

check(tripCatalog.schemaVersion === 1, 'Unsupported trip catalog schema')
check(tripCatalog.source?.provider === 'OpenStreetMap', 'Trip catalog needs OSM attribution')
check(tripCatalog.source?.attribution?.includes('OpenStreetMap'), 'Trip catalog attribution is missing')
check(tripCatalog.source?.licenseUrl === 'https://www.openstreetmap.org/copyright', 'Trip catalog license is missing')
check(Number.isFinite(Date.parse(tripCatalog.source?.importedAt)), 'Invalid trip import timestamp')
check(Array.isArray(tripCatalog.trips) && tripCatalog.trips.length >= 2, 'Need at least two Astana trips')

const tripIds = new Set()
for (const trip of tripCatalog.trips) {
  check(typeof trip.id === 'string' && /^osm:(node|way|relation):\d+$/.test(trip.id), `Invalid trip ID: ${trip.id}`)
  check(!tripIds.has(trip.id), `Duplicate trip ID: ${trip.id}`)
  tripIds.add(trip.id)
  check(trip.cityId === 'astana', `Trip must start from Astana: ${trip.id}`)
  check(typeof trip.name === 'string' && trip.name.trim().length > 2, `Missing trip name: ${trip.id}`)
  check(typeof trip.category === 'string' && trip.category.trim(), `Missing trip category: ${trip.id}`)
  check(typeof trip.description === 'string' && trip.description.trim().length >= 20 && trip.description.length <= 300,
    `Missing or overlong trip description: ${trip.id}`)
  check(['osm_tags', 'category_template'].includes(trip.descriptionSource), `Missing trip provenance: ${trip.id}`)
  check(Number.isFinite(trip.lat) && trip.lat >= 40 && trip.lat <= 56,
    `Trip latitude outside Kazakhstan: ${trip.id}`)
  check(Number.isFinite(trip.lon) && trip.lon >= 46 && trip.lon <= 88,
    `Trip longitude outside Kazakhstan: ${trip.id}`)
  check(Number.isInteger(trip.visitMinutes) && trip.visitMinutes >= 15 && trip.visitMinutes <= 240,
    `Invalid trip visit allowance: ${trip.id}`)
  check(trip.id === `osm:${trip.osmType}:${trip.osmId}`, `Trip ID and OSM object mismatch: ${trip.id}`)
  check(trip.sourceUrl === `https://www.openstreetmap.org/${trip.osmType}/${trip.osmId}`,
    `Invalid trip OSM source: ${trip.id}`)
  check(trip.tags && typeof trip.tags === 'object' && !Array.isArray(trip.tags),
    `Missing trip OSM tags: ${trip.id}`)
  check(['indoor', 'outdoor'].includes(trip.setting) && /^https:\/\//.test(trip.settingSourceUrl ?? ''),
    `Trip setting needs a source: ${trip.id}`)
  if (trip.category === 'museum') check(trip.tags.tourism === 'museum', `Unsourced museum category: ${trip.id}`)
  if (trip.category === 'viewpoint') check(trip.tags.tourism === 'viewpoint', `Unsourced viewpoint category: ${trip.id}`)
  check(Boolean(trip.durationClass) === Boolean(trip.durationSourceUrl),
    `Trip duration category needs a source: ${trip.id}`)
  if (trip.durationClass) {
    check(['half_day', 'full_day'].includes(trip.durationClass), `Invalid duration category: ${trip.id}`)
    check(/^https:\/\//.test(trip.durationSourceUrl), `Invalid duration source: ${trip.id}`)
  }
  check(trip.travel && typeof trip.travel === 'object' && !Array.isArray(trip.travel),
    `Missing trip travel record: ${trip.id}`)
  const hasRoadEstimate = ['roadKmApprox', 'driveMinutesApprox', 'transitMinutesApprox']
    .some((key) => trip.travel[key] !== undefined)
  if (hasRoadEstimate) {
    check(/^https:\/\//.test(trip.travel.sourceUrl ?? ''), `Unsourced road estimate: ${trip.id}`)
  }
  for (const key of ['roadKmApprox', 'driveMinutesApprox', 'transitMinutesApprox']) {
    if (trip.travel[key] !== undefined) {
      check(Number.isFinite(trip.travel[key]) && trip.travel[key] > 0,
        `Invalid ${key} for ${trip.id}`)
    }
  }
  if (trip.travel.costKzt !== undefined) {
    const cost = trip.travel.costKzt
    check(Number.isFinite(cost.min) && Number.isFinite(cost.max) && cost.min >= 0 && cost.max >= cost.min,
      `Invalid full-trip cost: ${trip.id}`)
    check(/^https:\/\//.test(cost.sourceUrl ?? '') && typeof trip.travel.notes === 'string'
      && trip.travel.notes.trim().length >= 20, `Trip cost needs source and coverage notes: ${trip.id}`)
  }
}

process.stdout.write(`Validated ${tripCatalog.trips.length} sourced Astana trips\n`)
