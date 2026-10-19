import type { Intent, RecommendRequest, RecommendResponse, Recommendation, WalkRequest } from '../shared/types'
import { mountRecommendationsMap } from './map'
import './style.css'

interface TelegramLocation { latitude: number; longitude: number }
interface TelegramLocationManager {
  isLocationAvailable: boolean
  init(callback: () => void): void
  getLocation(callback: (location: TelegramLocation | null) => void): void
}
interface TelegramWebApp {
  initData: string
  colorScheme?: 'light' | 'dark'
  LocationManager?: TelegramLocationManager
  ready(): void
  expand(): void
  isVersionAtLeast?(version: string): boolean
  openLink?(url: string): void
  onEvent?(event: string, callback: () => void): void
}
declare global {
  interface Window { Telegram?: { WebApp: TelegramWebApp } }
}

interface City {
  id: string
  name: string
  region?: string
  center: { lat: number; lon: number }
  radiusMeters: number
  poiCount: number
}
interface MapPlace {
  id: string
  name: string
  category: string
  cityId: string
  lat: number
  lon: number
  sourceUrl: string
  kind: 'place' | 'trip'
}
interface PublicCatalog {
  cities: City[]
  places: MapPlace[]
  source?: { attribution?: string; licenseUrl?: string }
}

type Scope = 'city' | 'day_trip'
type Transport = 'walk' | 'transit' | 'car'
type MapMode = 'all' | 'results'
type MapMarker = Pick<MapPlace, 'id' | 'name' | 'lat' | 'lon' | 'kind' | 'category' | 'sourceUrl'>

const telegram = window.Telegram?.WebApp
const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing application root')

const categoryLabels: Record<string, string> = {
  cafe: 'Кафе', playground: 'Детская площадка', theme_park: 'Парк развлечений',
  museum: 'Музей', gallery: 'Галерея', theatre: 'Театр', park: 'Парк',
  garden: 'Сад', viewpoint: 'Смотровая площадка', artwork: 'Искусство',
  monument: 'Памятник', memorial: 'Мемориал', attraction: 'Достопримечательность',
  arts_centre: 'Центр искусств', place_of_worship: 'Культовое место',
  nature_reserve: 'Природный парк', canyon: 'Каньон', lake: 'Озеро',
}

app.innerHTML = `
  <a class="skip-link" href="#content">К содержимому</a>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand" aria-label="Рядом — места в Астане и поездки из неё">
        <span class="brand-mark" aria-hidden="true"><span></span></span>
        <span class="brand-name">рядом<span class="brand-period">.</span></span>
      </div>
      <span class="topbar-country">Астана</span>
    </header>

    <main id="content">
      <div class="page-intro">
        <h1>Куда выбраться?</h1>
        <p>Прогулки по Астане и поездки из неё. Посмотрите места на карте и подберите план под своё время и бюджет.</p>
      </div>

      <div class="workspace">
        <section class="explore" aria-labelledby="explore-title">
          <div class="city-context">
            <span>Отправление</span>
            <strong>Астана</strong>
          </div>
          <div class="scope-switch" role="group" aria-label="Тип прогулки">
            <button type="button" class="scope-button is-selected" data-scope="city" aria-pressed="true">В городе</button>
            <button type="button" class="scope-button" data-scope="day_trip" aria-pressed="false">За городом</button>
          </div>
          <p id="scopeHint" class="scope-hint">Сейчас в каталоге места в центре, рядом с Бәйтереком.</p>

          <div class="map-heading">
            <div>
              <h2 id="explore-title">Места на карте</h2>
              <p id="mapCaption">Загружаем места Астаны…</p>
            </div>
            <span id="mapCount" class="map-count" aria-live="polite"></span>
          </div>
          <div id="map" class="map-canvas" role="region" aria-label="Интерактивная карта мест"></div>
          <div id="mapModeRow" class="map-mode-row" role="group" aria-label="Что показать на карте" hidden>
            <button type="button" data-mapmode="all" aria-pressed="false">Все места</button>
            <button type="button" data-mapmode="results" aria-pressed="true">В подборе</button>
          </div>
          <div id="mapPreview" class="map-preview" role="status" hidden></div>
          <p class="map-disclosure">Карта загружается с OpenStreetMap. При просмотре карты сервис получает технические данные соединения. При открытии маршрута координаты передаются Google Maps.</p>
          <div id="catalogError" class="catalog-error" role="alert" hidden>
            <span>Не удалось загрузить места.</span>
            <button id="catalogRetry" type="button">Попробовать снова</button>
          </div>
        </section>

        <form id="planner" class="planner" novalidate>
          <div class="planner-heading">
            <h2>Подобрать варианты</h2>
            <p>Для прогулки учитываем примерное время пешком и на месте.</p>
          </div>

          <fieldset class="field-group">
            <legend>Сколько времени есть?</legend>
            <div id="durationChoices" class="choice-row" aria-label="Время вместе с дорогой"></div>
          </fieldset>

          <fieldset class="field-group">
            <legend>Как доберётесь?</legend>
            <div id="transportChoices" class="choice-row" aria-label="Способ передвижения"></div>
            <p id="transportHint" class="field-hint">Время в пути приблизительное. Маршрут откроется во внешней карте.</p>
          </fieldset>

          <div class="field-group budget-group">
            <label for="budget">Бюджет на человека, ₸</label>
            <input id="budget" name="budget" type="number" min="0" max="10000000" step="500" inputmode="numeric" placeholder="Без ограничения" />
            <p class="field-hint">Если цена неизвестна, отметим это в результате.</p>
          </div>

          <div class="location-row">
            <button id="deviceButton" type="button" class="text-button" disabled>Использовать мою геопозицию</button>
            <p id="locationStatus" class="field-hint" role="status">Можно продолжить без геопозиции — используем центр пилотной зоны.</p>
          </div>

          <details class="more-options">
            <summary>Пожелания к прогулке</summary>
            <fieldset class="field-group">
              <legend>Что вам подходит?</legend>
              <div class="choice-row" id="intentChoices" aria-label="Предпочтения">
                <button type="button" class="choice-button" data-intent="outdoors" aria-pressed="false">На воздухе</button>
                <button type="button" class="choice-button" data-intent="indoors" aria-pressed="false">В помещении</button>
                <button type="button" class="choice-button" data-intent="child" aria-pressed="false">С ребёнком</button>
              </div>
            </fieldset>
            <div class="field-group prompt-group">
              <label for="prompt">Что ещё важно?</label>
              <textarea id="prompt" name="prompt" rows="2" maxlength="300" placeholder="Например: спокойное место без толпы"></textarea>
            </div>
          </details>

          <div class="submit-dock">
            <button id="submitButton" class="submit-button" type="submit" disabled>
              <span class="submit-label">Подобрать варианты</span>
              <span class="submit-arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </form>
      </div>

      <section id="results" class="results" aria-label="Рекомендации" aria-live="polite" hidden></section>
    </main>

    <footer class="footer">
      <span>Данные мест: © участники OpenStreetMap</span>
      <span class="footer-links">
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Лицензия OSM</a>
        <a href="/privacy.html">О данных</a>
      </span>
    </footer>
  </div>
`

function requiredElement<T>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`Missing element: ${selector}`)
  return element as T
}

function appendNodes(parent: Element, ...children: Node[]): void {
  children.forEach((child) => parent.appendChild(child))
}

const mapCaption = requiredElement<HTMLElement>('#mapCaption')
const mapCount = requiredElement<HTMLElement>('#mapCount')
const mapModeRow = requiredElement<HTMLElement>('#mapModeRow')
const mapPreview = requiredElement<HTMLElement>('#mapPreview')
const catalogError = requiredElement<HTMLElement>('#catalogError')
const planner = requiredElement<HTMLFormElement>('#planner')
const results = requiredElement<HTMLElement>('#results')
const prompt = requiredElement<HTMLTextAreaElement>('#prompt')
const budget = requiredElement<HTMLInputElement>('#budget')
const submitButton = requiredElement<HTMLButtonElement>('#submitButton')
const submitLabel = requiredElement<HTMLElement>('.submit-label')
const locationStatus = requiredElement<HTMLElement>('#locationStatus')

const state: {
  catalog: PublicCatalog | null
  cityId: string
  scope: Scope
  transport: Transport
  minutes: number
  budgetKzt?: number
  coordinates: TelegramLocation | null
  intents: Set<Intent>
  isLoading: boolean
  results: Recommendation[]
  mapMode: MapMode
} = {
  catalog: null,
  cityId: 'astana',
  scope: 'city',
  transport: 'walk',
  minutes: 120,
  coordinates: null,
  intents: new Set(),
  isLoading: false,
  results: [],
  mapMode: 'all',
}

let requestVersion = 0
let activeRecommendation: AbortController | null = null

function setTheme(): void {
  document.documentElement.dataset.theme = telegram?.colorScheme === 'dark' ? 'dark' : 'light'
}
setTheme()
telegram?.onEvent?.('themeChanged', setTheme)
telegram?.ready()
telegram?.expand()

function safeUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch { return null }
}

function createLink(label: string, value: string | undefined, className: string): HTMLAnchorElement | null {
  const url = safeUrl(value)
  if (!url) return null
  const link = document.createElement('a')
  link.href = url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.className = className
  link.textContent = label
  if (telegram?.initData && telegram.openLink) {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      telegram.openLink?.(url)
    })
  }
  return link
}

function formatMinutes(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} ч`
  return `${minutes} мин`
}

function formatKzt(amount: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(amount)} ₸`
}

function formatPlaceCount(count: number): string {
  const form = new Intl.PluralRules('ru-RU').select(count)
  return `${count} ${form === 'one' ? 'место' : form === 'few' ? 'места' : 'мест'}`
}

function city(): City | undefined {
  return state.catalog?.cities.find((item) => item.id === state.cityId)
}

function cityMapPlaces(): MapPlace[] {
  return state.catalog?.places.filter((item) => item.cityId === state.cityId
    && item.kind === (state.scope === 'city' ? 'place' : 'trip')) ?? []
}

const mapController = mountRecommendationsMap(requiredElement<HTMLElement>('#map'), {
  markers: [],
  center: { lat: 51.1283, lon: 71.4305 },
  onSelect: (id) => showMapPreview(id),
})

function activeMarkers(): MapMarker[] {
  if (state.mapMode === 'results' && state.results.length) {
    return state.results.filter((item): item is Recommendation & { lat: number; lon: number } =>
      typeof item.lat === 'number' && Number.isFinite(item.lat)
      && typeof item.lon === 'number' && Number.isFinite(item.lon))
      .map((item) => ({ id: item.id, name: item.name, lat: item.lat, lon: item.lon,
        kind: item.kind ?? 'place', category: item.category, sourceUrl: item.sourceUrl }))
  }
  return cityMapPlaces()
}

function renderMap(): void {
  const markers = activeMarkers()
  const selectedCity = city()
  mapController.update(markers, selectedCity?.center)
  mapCaption.textContent = state.scope === 'city'
    ? 'Центр Астаны · район Бәйтерека'
    : 'Поездки из Астаны'
  mapCount.textContent = markers.length ? formatPlaceCount(markers.length) : 'Пока нет мест'
  mapModeRow.hidden = !state.results.length
  mapModeRow.querySelectorAll<HTMLButtonElement>('[data-mapmode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mapmode === state.mapMode))
  })
  mapPreview.hidden = true
}

function showMapPreview(id: string): void {
  const item = activeMarkers().find((marker) => marker.id === id)
  if (!item) return
  mapPreview.replaceChildren()
  const text = document.createElement('div')
  const label = document.createElement('span')
  label.className = 'preview-label'
  label.textContent = item.kind === 'trip' ? 'Поездка за город' : categoryLabels[item.category ?? ''] || 'Место'
  const name = document.createElement('strong')
  name.textContent = item.name
  appendNodes(text, label, name)
  mapPreview.appendChild(text)
  const links = document.createElement('div')
  links.className = 'preview-links'
  const origin = state.coordinates
    ? { lat: state.coordinates.latitude, lon: state.coordinates.longitude }
    : city()?.center
  if (origin) {
    const route = new URL('https://www.google.com/maps/dir/')
    route.searchParams.set('api', '1')
    route.searchParams.set('origin', `${origin.lat},${origin.lon}`)
    route.searchParams.set('destination', `${item.lat},${item.lon}`)
    route.searchParams.set('travelmode', state.transport === 'car' ? 'driving' : state.transport === 'transit' ? 'transit' : 'walking')
    const routeLink = createLink('Маршрут ↗', route.toString(), 'preview-source')
    if (routeLink) links.appendChild(routeLink)
  }
  const source = createLink('Источник ↗', item.sourceUrl, 'preview-source')
  if (source) links.appendChild(source)
  mapPreview.appendChild(links)
  mapPreview.hidden = false
  results.querySelectorAll<HTMLElement>('.place-card').forEach((card) => {
    card.classList.toggle('is-map-selected', card.dataset.id === id)
  })
}

function resetResults(): void {
  requestVersion += 1
  activeRecommendation?.abort()
  activeRecommendation = null
  if (state.isLoading) setLoading(false)
  state.results = []
  state.mapMode = 'all'
  results.hidden = true
  results.replaceChildren()
  submitLabel.textContent = 'Подобрать варианты'
  renderMap()
}

function renderDurationChoices(): void {
  const options = state.scope === 'city' ? [60, 120, 240] : [480, 720, 1440]
  const row = requiredElement<HTMLElement>('#durationChoices')
  row.replaceChildren()
  for (const minutes of options) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'choice-button'
    button.textContent = minutes === 1440 ? 'Весь день' : formatMinutes(minutes)
    button.dataset.minutes = String(minutes)
    const selected = state.minutes === minutes
    button.classList.toggle('is-selected', selected)
    button.setAttribute('aria-pressed', String(selected))
    button.addEventListener('click', () => {
      state.minutes = minutes
      row.querySelectorAll<HTMLButtonElement>('button').forEach((candidate) => {
        const active = candidate === button
        candidate.classList.toggle('is-selected', active)
        candidate.setAttribute('aria-pressed', String(active))
      })
      resetResults()
    })
    row.appendChild(button)
  }
}

function renderTransportChoices(): void {
  const options: Array<[Transport, string]> = state.scope === 'city'
    ? [['walk', 'Пешком'], ['transit', 'Транспорт'], ['car', 'На машине']]
    : [['car', 'На машине']]
  const row = requiredElement<HTMLElement>('#transportChoices')
  row.replaceChildren()
  for (const [transport, label] of options) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'choice-button'
    button.textContent = label
    button.dataset.transport = transport
    const selected = state.transport === transport
    button.classList.toggle('is-selected', selected)
    button.setAttribute('aria-pressed', String(selected))
    button.addEventListener('click', () => {
      state.transport = transport
      row.querySelectorAll<HTMLButtonElement>('button').forEach((candidate) => {
        const active = candidate === button
        candidate.classList.toggle('is-selected', active)
        candidate.setAttribute('aria-pressed', String(active))
      })
      updateTransportHint()
      resetResults()
    })
    row.appendChild(button)
  }
  updateTransportHint()
}

function updateTransportHint(): void {
  requiredElement<HTMLElement>('#transportHint').textContent = state.scope === 'day_trip'
    ? 'Пока доступны поездки на машине. Время дороги туда и обратно неизвестно — проверьте маршрут перед выездом.'
    : state.transport === 'walk'
      ? 'Время пешком приблизительное; обратный путь не рассчитан.'
      : 'Время дороги на выбранном транспорте пока неизвестно; проверьте внешний маршрут.'
}

function setScope(scope: Scope): void {
  state.scope = scope
  state.minutes = scope === 'city' ? 120 : 720
  state.transport = scope === 'city' ? 'walk' : 'car'
  document.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach((button) => {
    const selected = button.dataset.scope === scope
    button.classList.toggle('is-selected', selected)
    button.setAttribute('aria-pressed', String(selected))
  })
  requiredElement<HTMLElement>('.location-row').hidden = scope === 'day_trip'
  requiredElement<HTMLElement>('.planner-heading p').textContent = scope === 'day_trip'
    ? 'Для поездки заложите запас времени и проверьте дорогу перед выездом.'
    : 'Для прогулки учитываем примерное время пешком и на месте.'
  requiredElement<HTMLElement>('#scopeHint').textContent = scope === 'day_trip'
    ? 'Идеи для поездки из Астаны на полдня или целый день.'
    : 'Сейчас в каталоге места в центре, рядом с Бәйтереком.'
  renderDurationChoices()
  renderTransportChoices()
  resetResults()
}

document.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach((button) => {
  button.addEventListener('click', () => setScope(button.dataset.scope as Scope))
})
document.querySelectorAll<HTMLButtonElement>('[data-mapmode]').forEach((button) => {
  button.addEventListener('click', () => {
    state.mapMode = button.dataset.mapmode as MapMode
    renderMap()
  })
})
budget.addEventListener('input', () => {
  if (budget.value === '') {
    state.budgetKzt = undefined
  } else {
    const value = Number(budget.value)
    state.budgetKzt = Number.isInteger(value) && value >= 0 && value <= 10_000_000 ? value : undefined
    if (state.budgetKzt === undefined) budget.value = ''
  }
  resetResults()
})
prompt.addEventListener('input', resetResults)
document.querySelectorAll<HTMLButtonElement>('[data-intent]').forEach((button) => {
  button.addEventListener('click', () => {
    const intent = button.dataset.intent as Intent
    if (state.intents.has(intent)) state.intents.delete(intent)
    else {
      if (intent === 'outdoors') state.intents.delete('indoors')
      if (intent === 'indoors') state.intents.delete('outdoors')
      state.intents.add(intent)
    }
    document.querySelectorAll<HTMLButtonElement>('[data-intent]').forEach((candidate) => {
      const selected = state.intents.has(candidate.dataset.intent as Intent)
      candidate.classList.toggle('is-selected', selected)
      candidate.setAttribute('aria-pressed', String(selected))
    })
    resetResults()
  })
})

function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180
  const latDelta = (b.lat - a.lat) * rad
  const lonDelta = (b.lon - a.lon) * rad
  const h = Math.sin(latDelta / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(lonDelta / 2) ** 2
  return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

function requestDeviceLocation(): void {
  const manager = telegram?.LocationManager
  if (!telegram?.isVersionAtLeast?.('8.0') || !manager) {
    locationStatus.textContent = 'Геопозиция недоступна в этой версии Telegram. Используем центр пилотной зоны.'
    return
  }
  const button = requiredElement<HTMLButtonElement>('#deviceButton')
  button.disabled = true
  locationStatus.textContent = 'Запрашиваем геопозицию…'
  manager.init(() => {
    if (state.scope !== 'city') {
      button.disabled = false
      return
    }
    if (!manager.isLocationAvailable) {
      button.disabled = false
      locationStatus.textContent = 'Геопозиция недоступна. Используем центр пилотной зоны.'
      return
    }
    manager.getLocation((location) => {
      button.disabled = false
      if (state.scope !== 'city') return
      if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
        locationStatus.textContent = 'Доступ к геопозиции не получен. Можно продолжить без неё.'
        return
      }
      const point = { lat: location.latitude, lon: location.longitude }
      const matchingCity = state.catalog?.cities
        .filter((item) => distanceMeters(point, item.center) <= item.radiusMeters)
        .sort((a, b) => distanceMeters(point, a.center) - distanceMeters(point, b.center))[0]
      if (!matchingCity) {
        state.coordinates = null
        locationStatus.textContent = 'Пока нет мест из каталога рядом с этой точкой. Можно продолжить от Бәйтерека.'
        return
      }
      state.coordinates = location
      locationStatus.textContent = 'Используем вашу геопозицию в пилотной зоне Астаны.'
      resetResults()
    })
  })
}
requiredElement<HTMLButtonElement>('#deviceButton').addEventListener('click', requestDeviceLocation)

async function loadCatalog(): Promise<void> {
  catalogError.hidden = true
  try {
    const response = await fetch('/api/catalog', { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error('Catalog unavailable')
    const data: PublicCatalog = await response.json()
    if (!Array.isArray(data.cities) || !Array.isArray(data.places)
      || !data.cities.some((item) => item.id === 'astana')) {
      throw new Error('Catalog incomplete')
    }
    state.catalog = data
    submitButton.disabled = false
    requiredElement<HTMLButtonElement>('#deviceButton').disabled = false
    renderMap()
  } catch {
    catalogError.hidden = false
    mapCaption.textContent = 'Карта временно недоступна.'
    mapCount.textContent = ''
  }
}
requiredElement<HTMLButtonElement>('#catalogRetry').addEventListener('click', loadCatalog)

function makeRequest(): RecommendRequest {
  const request: WalkRequest = {
    cityId: state.cityId,
    scope: state.scope,
    transport: state.transport,
    minutes: state.minutes,
    intents: [...state.intents],
    text: prompt.value.trim(),
  }
  if (state.budgetKzt !== undefined) request.budgetKzt = state.budgetKzt
  if (state.coordinates) {
    request.latitude = state.coordinates.latitude
    request.longitude = state.coordinates.longitude
  }
  return { initData: telegram?.initData ?? '', request }
}

function setLoading(value: boolean): void {
  state.isLoading = value
  submitButton.disabled = value || !state.catalog
  planner.setAttribute('aria-busy', String(value))
  submitLabel.textContent = value ? 'Подбираем…' : 'Подобрать варианты'
}

function scrollToResults(): void {
  results.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
  })
}

function showLoading(): void {
  results.hidden = false
  results.innerHTML = '<div class="results-heading"><h2>Подбираем варианты</h2><p>Сверяем места с вашими условиями.</p></div><div class="loading-row" aria-hidden="true"><span></span><span></span><span></span></div>'
  scrollToResults()
}

function showError(message: string): void {
  results.hidden = false
  results.replaceChildren()
  const panel = document.createElement('div')
  panel.className = 'message-state error-state'
  panel.setAttribute('role', 'alert')
  const heading = document.createElement('h2')
  heading.textContent = 'Пока не получилось подобрать'
  const detail = document.createElement('p')
  detail.textContent = message
  appendNodes(panel, heading, detail)
  results.appendChild(panel)
  scrollToResults()
}

function createCard(item: Recommendation): HTMLElement {
  const card = document.createElement('article')
  card.className = 'place-card'
  card.dataset.id = item.id
  const top = document.createElement('div')
  top.className = 'place-top'
  const category = document.createElement('span')
  category.className = 'place-category'
  category.textContent = item.kind === 'trip' ? 'Поездка за город' : categoryLabels[item.category] || 'Место'
  const mapButton = document.createElement('button')
  mapButton.type = 'button'
  mapButton.className = 'place-map-button'
  mapButton.textContent = 'На карте ↗'
  mapButton.addEventListener('click', () => {
    state.mapMode = 'results'
    renderMap()
    mapController.select(item.id)
    showMapPreview(item.id)
    requiredElement<HTMLElement>('#map').scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    })
  })
  appendNodes(top, category, mapButton)
  const name = document.createElement('h3')
  name.textContent = item.name
  const why = document.createElement('p')
  why.className = 'place-why'
  why.textContent = item.why
  const facts = document.createElement('div')
  facts.className = 'place-facts'
  const addFact = (text: string) => {
    const fact = document.createElement('span')
    fact.textContent = text
    facts.appendChild(fact)
  }
  if (typeof item.travelMinutesApprox === 'number') {
    const mode = item.travelMode === 'walk' ? 'пешком' : item.travelMode === 'car' ? 'на машине' : 'на транспорте'
    addFact(`≈ ${formatMinutes(item.travelMinutesApprox)} ${mode}${item.kind === 'trip' ? ' в одну сторону' : ''}`)
  } else if (typeof item.walkMinutes === 'number') addFact(`≈ ${formatMinutes(item.walkMinutes)} пешком`)
  else addFact('Время дороги не подтверждено')
  if (item.kind === 'trip' && typeof item.distanceKmApprox === 'number') {
    addFact(`≈ ${item.distanceKmApprox} км по дороге`)
  }
  if (typeof item.visitMinutes === 'number') addFact(`≈ ${formatMinutes(item.visitMinutes)} на месте`)
  if (item.estimatedCostKzt) addFact(`Расходы ≈ ${formatKzt(item.estimatedCostKzt.min)}–${formatKzt(item.estimatedCostKzt.max)}`)
  else addFact('Стоимость не подтверждена')
  if (item.hoursStatus) addFact(item.hoursStatus)

  const action = document.createElement('div')
  action.className = 'place-action'
  const actionLabel = document.createElement('span')
  actionLabel.textContent = 'Что можно сделать'
  const actionText = document.createElement('p')
  actionText.textContent = item.action
  appendNodes(action, actionLabel, actionText)
  if (item.actionSource === 'ai') {
    const caveat = document.createElement('small')
    caveat.textContent = 'Идея сгенерирована; детали места проверьте перед поездкой.'
    action.appendChild(caveat)
  }
  const links = document.createElement('div')
  links.className = 'place-links'
  const routeLink = createLink('Открыть маршрут ↗', item.routeUrl, 'map-link')
  const sourceLink = createLink('Источник места ↗', item.sourceUrl, 'source-link')
  const durationSourceLink = createLink('Источник формата поездки ↗', item.durationSourceUrl, 'source-link')
  const travelSourceLink = createLink(
    typeof item.travelMinutesApprox === 'number' ? 'Источник времени ↗' : 'Источник расстояния ↗',
    item.travelSourceUrl,
    'source-link',
  )
  const costSourceLink = createLink('Источник стоимости ↗', item.costSourceUrl, 'source-link')
  if (routeLink) links.appendChild(routeLink)
  if (sourceLink) links.appendChild(sourceLink)
  if (durationSourceLink) links.appendChild(durationSourceLink)
  if (travelSourceLink) links.appendChild(travelSourceLink)
  if (costSourceLink) links.appendChild(costSourceLink)
  appendNodes(card, top, name, why, facts, action, links)
  return card
}

function showResults(response: RecommendResponse): void {
  results.hidden = false
  results.replaceChildren()
  state.results = response.recommendations.slice(0, 3)
  const heading = document.createElement('div')
  heading.className = 'results-heading'
  const title = document.createElement('h2')
  title.textContent = state.results.length ? 'Подходящие места' : 'Пока нет подходящих мест'
  const summary = document.createElement('p')
  summary.textContent = response.summary
  appendNodes(heading, title, summary)
  results.appendChild(heading)
  if (state.results.length) {
    const list = document.createElement('div')
    list.className = 'place-list'
    state.results.forEach((item) => list.appendChild(createCard(item)))
    results.appendChild(list)
    const mapPrivacy = document.createElement('p')
    mapPrivacy.className = 'map-privacy-note'
    mapPrivacy.textContent = 'При открытии внешнего маршрута выбранная точка отправления и место назначения передаются картографическому сервису.'
    results.appendChild(mapPrivacy)
    state.mapMode = 'results'
  } else {
    const empty = document.createElement('p')
    empty.className = 'empty-state'
    empty.textContent = 'Попробуйте выбрать больше времени, другой бюджет или способ добраться.'
    results.appendChild(empty)
    state.mapMode = 'all'
  }
  if (response.note) {
    const note = document.createElement('p')
    note.className = 'results-note'
    note.textContent = response.note
    results.appendChild(note)
  }
  renderMap()
  scrollToResults()
}

planner.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (state.isLoading || !state.catalog) return
  if (!telegram?.initData) {
    showError('Для подбора откройте приложение через кнопку в Telegram. Карту мест можно посмотреть и здесь.')
    return
  }
  prompt.blur()
  showLoading()
  setLoading(true)
  const controller = new AbortController()
  const version = ++requestVersion
  activeRecommendation = controller
  const timeout = window.setTimeout(() => controller.abort(), 25_000)
  try {
    const response = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeRequest()),
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Сессия Telegram устарела. Откройте приложение заново.')
      if (response.status === 429) throw new Error('Слишком много запросов. Подождите минуту и попробуйте снова.')
      throw new Error('Сервис временно недоступен. Попробуйте ещё раз через несколько секунд.')
    }
    const data: RecommendResponse = await response.json()
    if (version !== requestVersion) return
    if (!data || typeof data.summary !== 'string' || !Array.isArray(data.recommendations)) {
      throw new Error('Ответ сервера неполный. Попробуйте ещё раз.')
    }
    showResults(data)
  } catch (error) {
    if (version !== requestVersion) return
    showError(error instanceof DOMException && error.name === 'AbortError'
      ? 'Поиск занял слишком много времени. Проверьте соединение и попробуйте ещё раз.'
      : error instanceof Error ? error.message : 'Произошла ошибка. Попробуйте ещё раз.')
  } finally {
    window.clearTimeout(timeout)
    if (version === requestVersion) {
      activeRecommendation = null
      setLoading(false)
    }
  }
})

setScope('city')
void loadCatalog()
