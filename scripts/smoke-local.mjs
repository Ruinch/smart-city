import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const contents = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8')
const vars = Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
  const value = line.trim()
  const equals = value.indexOf('=')
  if (!value || value.startsWith('#') || equals < 1) return []
  const key = value.slice(0, equals).trim()
  let secret = value.slice(equals + 1).trim()
  if ((secret.startsWith('"') && secret.endsWith('"')) || (secret.startsWith("'") && secret.endsWith("'"))) {
    secret = secret.slice(1, -1)
  }
  return [[key, secret]]
}))

if (!vars.TELEGRAM_BOT_TOKEN || !vars.OPENAI_API_KEY) {
  throw new Error('Add Telegram and OpenAI secrets to .dev.vars first')
}

const timestamp = String(Math.floor(Date.now() / 1000))
const user = JSON.stringify({ id: 999000001, first_name: 'Local Smoke' })
// Recent Telegram launches also include `signature` in the bot-token HMAC payload.
const signature = 'synthetic_telegram_signature'
const check = ['auth_date=' + timestamp, 'signature=' + signature, 'user=' + user].join('\n')
const secret = createHmac('sha256', 'WebAppData').update(vars.TELEGRAM_BOT_TOKEN).digest()
const hash = createHmac('sha256', secret).update(check).digest('hex')
const initData = new URLSearchParams({ auth_date: timestamp, signature, user, hash }).toString()
const endpoint = process.argv[2] || 'http://127.0.0.1:8787'

const scenarios = [
  { label: 'nightlife', request: { scope: 'city', transport: 'walk', minutes: 180,
    text: 'Хочу в клуб: музыка, танцы и движная ночь', groupSize: 2 } },
  { label: 'coffee-reading', request: { scope: 'city', transport: 'walk', minutes: 180,
    text: 'Тихое кафе с кофе, где можно почитать книгу', groupSize: 3 } },
  { label: 'named-restaurant', request: { scope: 'city', transport: 'walk', minutes: 180,
    text: 'Хочу поужинать в Qazaq Gourmet, интересуют казахская кухня и средний чек',
    latitude: 51.1083, longitude: 71.4304, groupSize: 2 } },
  { label: 'day-trip', request: { scope: 'day_trip', transport: 'car', minutes: 1440,
    text: 'Что интересного посмотреть за городом', groupSize: 4 } },
]

const selected = process.argv[3]
const chosen = selected ? scenarios.filter((scenario) => scenario.label === selected) : scenarios
if (!chosen.length) throw new Error(`Unknown smoke scenario: ${selected}`)

for (const scenario of chosen) {
  const response = await fetch(new URL('/api/recommend', endpoint), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData, request: { cityId: 'astana', intents: [], ...scenario.request } }),
  })
  const payload = await response.json()
  const routes = Array.isArray(payload.routes) ? payload.routes : []
  const stops = routes[0]?.stops ?? []
  const status = response.status + ' ' + scenario.label
  const names = stops.map((stop) => stop.name + ' [' + stop.category + ']').join(' → ')
  const sourcedPrices = routes.flatMap((route) => route.stops).filter((stop) => stop.priceEvidence).length
  const sourcedDetails = routes.flatMap((route) => route.stops)
    .reduce((count, stop) => count + (stop.evidence?.length ?? 0), 0)
  process.stdout.write(status + ': ' + (names || payload.summary || payload.error || 'empty')
    + ` (${routes.length} вариантов, ${sourcedPrices} цен и ${sourcedDetails} деталей с источником)` + '\n')
  if (!response.ok || routes.length === 0 || stops.length === 0) process.exitCode = 1
}
