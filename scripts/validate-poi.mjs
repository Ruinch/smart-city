import { readFile } from 'node:fs/promises'

const path = new URL('../data/pois.json', import.meta.url)
const catalog = JSON.parse(await readFile(path, 'utf8'))

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
