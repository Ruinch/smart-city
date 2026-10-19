import type { Recommendation, WalkRequest } from '../shared/types'
import { mountRecommendationsMap, type MapCoordinate, type RecommendationsMapController } from './map'
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

type Scope = 'city' | 'day_trip'
type Transport = 'walk' | 'transit' | 'car'
interface RoutePlan {
  title: string
  summary: string
  stops: Recommendation[]
  routeUrl?: string
  origin?: MapCoordinate
  geometry?: MapCoordinate[]
  totalMinutesApprox?: number
  distanceKmApprox?: number
}
interface RouteResponse {
  summary: string
  routes?: RoutePlan[]
  note?: string
}

const ASTANA_CENTER: MapCoordinate = { lat: 51.1283, lon: 71.4305 }
const telegram = window.Telegram?.WebApp
const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing application root')

const categoryLabels: Record<string, string> = {
  cafe: 'Кафе', nightclub: 'Клуб', bar: 'Бар', music_venue: 'Концертная площадка',
  events_venue: 'Площадка для мероприятий', restaurant: 'Ресторан',
  library: 'Библиотека', bookshop: 'Книжный магазин', cinema: 'Кинотеатр',
  museum: 'Музей', gallery: 'Галерея', theatre: 'Театр', park: 'Парк',
  garden: 'Сад', viewpoint: 'Смотровая площадка', artwork: 'Искусство',
  monument: 'Памятник', memorial: 'Мемориал', attraction: 'Достопримечательность',
  arts_centre: 'Центр искусств', playground: 'Детская площадка',
  nature_reserve: 'Природный парк', lake: 'Озеро', place_of_worship: 'Культовое место',
}

app.innerHTML = `
  <a class="skip-link" href="#content">К содержимому</a>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand" aria-label="Рядом — маршруты из Астаны">
        <span class="brand-mark" aria-hidden="true"><span></span></span>
        <span class="brand-name">рядом<span class="brand-period">.</span></span>
      </div>
      <span class="topbar-country">Астана</span>
    </header>

    <main id="content">
      <div class="page-intro">
        <h1>Что хочется сегодня?</h1>
        <p>Расскажите своими словами. Соберём маршрут по Астане или поездку из города с учётом времени и компании.</p>
      </div>

      <form id="planner" class="planner" novalidate>
        <div class="planner-lead">
          <label for="prompt">Ваш план</label>
          <p id="promptHint">Настроение, места и детали, которые важны именно вам.</p>
        </div>
        <textarea id="prompt" name="prompt" rows="3" maxlength="300" aria-describedby="promptHint promptError" placeholder="Например: хочу тихое кафе с кофе, где можно почитать книгу"></textarea>
        <p id="promptError" class="field-error" role="alert" hidden></p>
        <div class="example-row" role="group" aria-label="Примеры запросов">
          <span>Можно начать так:</span>
          <button type="button" data-example="Хочу в клуб: музыка, танцы и движная ночь">Клуб и танцы</button>
          <button type="button" data-example="Тихое кафе, где можно попить кофе и почитать книгу">Кофе и книга</button>
          <button type="button" data-example="Прогулка с друзьями по интересным местам Астаны">С друзьями</button>
        </div>

        <div class="form-divider"></div>
        <div class="scope-row">
          <div class="field-label">Где искать</div>
          <div class="scope-switch" role="group" aria-label="Где искать маршрут">
            <button type="button" class="scope-button is-selected" data-scope="city" aria-pressed="true">В Астане</button>
            <button type="button" class="scope-button" data-scope="day_trip" aria-pressed="false">Поездка из города</button>
          </div>
        </div>

        <div class="settings-grid">
          <fieldset class="field-group">
            <legend>Сколько времени есть</legend>
            <div id="durationChoices" class="choice-row" aria-label="Время вместе с дорогой"></div>
          </fieldset>
          <fieldset class="field-group">
            <legend>Как доберётесь</legend>
            <div id="transportChoices" class="choice-row" aria-label="Способ передвижения"></div>
          </fieldset>
          <div class="field-group budget-group">
            <label for="budget">Бюджет на человека, ₸</label>
            <input id="budget" name="budget" type="number" min="0" max="10000000" step="500" inputmode="numeric" placeholder="Без ограничения" aria-describedby="budgetHint" />
            <p id="budgetHint" class="field-hint">Цены многих мест неизвестны. 0 ₸ уберёт кафе, клубы и магазины, но бесплатность оставшихся мест не проверена.</p>
          </div>
          <div class="field-group group-size-group">
            <label for="groupSize">Сколько вас будет</label>
            <input id="groupSize" name="groupSize" type="number" min="1" max="12" step="1" inputmode="numeric" value="1" aria-describedby="groupSizeHint groupSizeError" />
            <p id="groupSizeHint" class="field-hint">От 1 до 12 человек.</p>
            <p id="groupSizeError" class="field-error" role="alert" hidden></p>
          </div>
        </div>

        <p id="transportHint" class="form-note">Время дороги ориентировочное. Перед выходом проверьте маршрут и часы работы.</p>
        <div id="locationRow" class="location-row" hidden>
          <button id="deviceButton" type="button" class="text-button">Взять мою геопозицию</button>
          <p id="locationStatus" class="field-hint" role="status">Без геопозиции начнём от центра Астаны.</p>
        </div>
        <div class="submit-dock">
          <button id="submitButton" class="submit-button" type="submit">
            <span class="submit-label">Составить маршрут</span>
            <span class="submit-arrow" aria-hidden="true">→</span>
          </button>
        </div>
      </form>

      <section id="results" class="results" aria-live="polite" aria-label="Готовый маршрут" hidden></section>
    </main>

    <footer class="footer">
      <span>Карта: © участники OpenStreetMap</span>
      <span class="footer-links">
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Лицензия OSM</a>
        <a href="/privacy.html">О данных</a>
      </span>
    </footer>
  </div>
`

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`Missing element: ${selector}`)
  return element as T
}

function appendNodes(parent: Element, ...children: Node[]): void {
  children.forEach((child) => parent.appendChild(child))
}

const planner = requiredElement<HTMLFormElement>('#planner')
const prompt = requiredElement<HTMLTextAreaElement>('#prompt')
const promptError = requiredElement<HTMLElement>('#promptError')
const budget = requiredElement<HTMLInputElement>('#budget')
const groupSize = requiredElement<HTMLInputElement>('#groupSize')
const groupSizeError = requiredElement<HTMLElement>('#groupSizeError')
const submitButton = requiredElement<HTMLButtonElement>('#submitButton')
const submitLabel = requiredElement<HTMLElement>('.submit-label')
const results = requiredElement<HTMLElement>('#results')
const locationStatus = requiredElement<HTMLElement>('#locationStatus')

const state: {
  scope: Scope
  transport: Transport
  minutes: number
  coordinates: TelegramLocation | null
  isLoading: boolean
  stops: Recommendation[]
} = {
  scope: 'city',
  transport: 'walk',
  minutes: 120,
  coordinates: null,
  isLoading: false,
  stops: [],
}

let requestVersion = 0
let activeRecommendation: AbortController | null = null
let mapController: RecommendationsMapController | null = null

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

function stopCount(count: number): string {
  const form = new Intl.PluralRules('ru-RU').select(count)
  return `${count} ${form === 'one' ? 'остановка' : form === 'few' ? 'остановки' : 'остановок'}`
}

function travelModeLabel(mode: string | undefined): string {
  return mode === 'car' ? 'на машине' : mode === 'transit' ? 'на транспорте' : 'пешком'
}

function origin(): MapCoordinate {
  return state.coordinates
    ? { lat: state.coordinates.latitude, lon: state.coordinates.longitude }
    : ASTANA_CENTER
}

function scrollToResults(): void {
  results.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
  })
}

function clearResults(): void {
  requestVersion += 1
  activeRecommendation?.abort()
  activeRecommendation = null
  mapController?.destroy()
  mapController = null
  state.stops = []
  if (state.isLoading) setLoading(false)
  results.hidden = true
  results.replaceChildren()
}

function renderDurationChoices(): void {
  const options = state.scope === 'city' ? [60, 120, 240, 360] : [480, 720, 1440]
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
      clearResults()
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
      clearResults()
    })
    row.appendChild(button)
  }
  updateTransportHint()
}

function updateTransportHint(): void {
  requiredElement<HTMLElement>('#transportHint').textContent = state.scope === 'day_trip'
    ? 'Для поездок из Астаны пока доступна машина. Время дороги, расходы и часы работы проверьте перед выездом.'
    : state.transport === 'walk'
      ? 'Время пешком ориентировочное. Часы работы и условия места проверьте перед выходом.'
      : 'Время на выбранном транспорте может быть неизвестно. Проверьте дорогу во внешней карте.'
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
  renderDurationChoices()
  renderTransportChoices()
  clearResults()
}

document.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach((button) => {
  button.addEventListener('click', () => setScope(button.dataset.scope as Scope))
})
document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((button) => {
  button.addEventListener('click', () => {
    prompt.value = button.dataset.example ?? ''
    promptError.hidden = true
    prompt.focus()
    clearResults()
  })
})
prompt.addEventListener('input', () => {
  promptError.hidden = true
  clearResults()
})
budget.addEventListener('input', () => {
  budget.setCustomValidity('')
  clearResults()
})
groupSize.addEventListener('input', () => {
  groupSizeError.hidden = true
  clearResults()
})

function distanceMeters(a: MapCoordinate, b: MapCoordinate): number {
  const rad = Math.PI / 180
  const latDelta = (b.lat - a.lat) * rad
  const lonDelta = (b.lon - a.lon) * rad
  const h = Math.sin(latDelta / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(lonDelta / 2) ** 2
  return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

function requestDeviceLocation(): void {
  const manager = telegram?.LocationManager
  if (!telegram?.isVersionAtLeast?.('8.0') || !manager) return
  const button = requiredElement<HTMLButtonElement>('#deviceButton')
  button.disabled = true
  locationStatus.textContent = 'Запрашиваем геопозицию…'
  manager.init(() => {
    if (!manager.isLocationAvailable) {
      button.disabled = false
      locationStatus.textContent = 'Геопозиция недоступна. Начнём от центра Астаны.'
      return
    }
    manager.getLocation((location) => {
      button.disabled = false
      if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
        locationStatus.textContent = 'Доступ к геопозиции не получен. Начнём от центра Астаны.'
        return
      }
      const point = { lat: location.latitude, lon: location.longitude }
      if (distanceMeters(point, ASTANA_CENTER) > 40_000) {
        state.coordinates = null
        locationStatus.textContent = 'Вы далеко от Астаны. Начнём маршрут от центра города.'
        return
      }
      state.coordinates = location
      locationStatus.textContent = 'Начнём маршрут от вашей геопозиции.'
      clearResults()
    })
  })
}
requiredElement<HTMLButtonElement>('#deviceButton').addEventListener('click', requestDeviceLocation)
if (telegram?.isVersionAtLeast?.('8.0') && telegram.LocationManager) {
  requiredElement<HTMLElement>('#locationRow').hidden = false
}

function validateForm(): { text: string; group: number; budgetKzt?: number } | null {
  budget.setCustomValidity('')
  const text = prompt.value.trim()
  if (text.length < 3) {
    promptError.textContent = 'Опишите, какой маршрут вам нужен, хотя бы в нескольких словах.'
    promptError.hidden = false
    prompt.focus()
    return null
  }
  const group = Number(groupSize.value)
  if (!Number.isInteger(group) || group < 1 || group > 12) {
    groupSizeError.textContent = 'Укажите число от 1 до 12.'
    groupSizeError.hidden = false
    groupSize.focus()
    return null
  }
  if (budget.value.trim() === '') return { text, group }
  const amount = Number(budget.value)
  if (!Number.isInteger(amount) || amount < 0 || amount > 10_000_000) {
    budget.setCustomValidity('Укажите сумму от 0 до 10 000 000 ₸ или оставьте поле пустым.')
    budget.reportValidity()
    budget.focus()
    return null
  }
  budget.setCustomValidity('')
  return { text, group, budgetKzt: amount }
}

function makeRequest(validated: { text: string; group: number; budgetKzt?: number }): { initData: string; request: WalkRequest & { groupSize: number } } {
  const request: WalkRequest & { groupSize: number } = {
    cityId: 'astana',
    scope: state.scope,
    transport: state.transport,
    minutes: state.minutes,
    intents: [],
    text: validated.text,
    groupSize: validated.group,
  }
  if (validated.budgetKzt !== undefined) request.budgetKzt = validated.budgetKzt
  if (state.coordinates) {
    request.latitude = state.coordinates.latitude
    request.longitude = state.coordinates.longitude
  }
  return { initData: telegram?.initData ?? '', request }
}

function setLoading(value: boolean): void {
  state.isLoading = value
  submitButton.disabled = value
  planner.setAttribute('aria-busy', String(value))
  submitLabel.textContent = value ? 'Ищем маршрут…' : 'Составить маршрут'
}

function showLoading(): void {
  results.hidden = false
  results.innerHTML = '<div class="results-heading"><h2>Ищем подходящие места</h2><p>Проверяем реальные места и собираем маршрут. Это может занять до минуты.</p></div><div class="loading-row" aria-hidden="true"><span></span><span></span><span></span></div>'
  scrollToResults()
}

function showError(message: string): void {
  mapController?.destroy()
  mapController = null
  results.hidden = false
  results.replaceChildren()
  const panel = document.createElement('div')
  panel.className = 'message-state error-state'
  panel.setAttribute('role', 'alert')
  const heading = document.createElement('h2')
  heading.textContent = 'Маршрут пока не готов'
  const detail = document.createElement('p')
  detail.textContent = message
  appendNodes(panel, heading, detail)
  results.appendChild(panel)
  scrollToResults()
}

function addFact(parent: HTMLElement, text: string): void {
  const fact = document.createElement('span')
  fact.textContent = text
  parent.appendChild(fact)
}

function showMapPreview(item: Recommendation): void {
  const preview = requiredElement<HTMLElement>('#mapPreview')
  preview.replaceChildren()
  const meta = document.createElement('span')
  meta.className = 'preview-label'
  meta.textContent = categoryLabels[item.category] || (item.kind === 'trip' ? 'Поездка' : 'Остановка')
  const name = document.createElement('strong')
  name.textContent = item.name
  const text = document.createElement('div')
  appendNodes(text, meta, name)
  preview.appendChild(text)
  const source = createLink('Источник ↗', item.sourceUrl, 'preview-source')
  if (source) preview.appendChild(source)
  preview.hidden = false
  results.querySelectorAll<HTMLElement>('.place-card').forEach((card) => {
    card.classList.toggle('is-map-selected', card.dataset.id === item.id)
  })
}

function createStopCard(item: Recommendation, index: number): HTMLElement {
  const card = document.createElement('article')
  card.className = 'place-card'
  card.dataset.id = item.id
  const top = document.createElement('div')
  top.className = 'place-top'
  const number = document.createElement('span')
  number.className = 'stop-number'
  number.textContent = String(index + 1)
  const category = document.createElement('span')
  category.className = 'place-category'
  category.textContent = categoryLabels[item.category] || (item.kind === 'trip' ? 'Поездка' : 'Место')
  const mapButton = document.createElement('button')
  mapButton.type = 'button'
  mapButton.className = 'place-map-button'
  mapButton.textContent = 'На карте ↗'
  mapButton.addEventListener('click', () => {
    mapController?.select(item.id)
    showMapPreview(item)
    requiredElement<HTMLElement>('#map').scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    })
  })
  appendNodes(top, number, category, mapButton)
  const name = document.createElement('h3')
  name.textContent = item.name
  const why = document.createElement('p')
  why.className = 'place-why'
  why.textContent = item.why
  const facts = document.createElement('div')
  facts.className = 'place-facts'
  if (typeof item.travelMinutesApprox === 'number') addFact(facts, `≈ ${formatMinutes(item.travelMinutesApprox)} ${travelModeLabel(item.travelMode)}`)
  else if (typeof item.walkMinutes === 'number') addFact(facts, `≈ ${formatMinutes(item.walkMinutes)} пешком`)
  else addFact(facts, 'Время дороги неизвестно')
  if (typeof item.visitMinutes === 'number') addFact(facts, `≈ ${formatMinutes(item.visitMinutes)} на месте`)
  if (item.estimatedCostKzt) {
    addFact(facts, `Расходы ≈ ${formatKzt(item.estimatedCostKzt.min)}–${formatKzt(item.estimatedCostKzt.max)}`)
  } else addFact(facts, 'Стоимость неизвестна')
  if (item.hoursStatus) addFact(facts, item.hoursStatus)
  const action = document.createElement('div')
  action.className = 'place-action'
  const actionLabel = document.createElement('span')
  actionLabel.textContent = 'Что здесь сделать'
  const actionText = document.createElement('p')
  actionText.textContent = item.action
  appendNodes(action, actionLabel, actionText)
  if (item.actionSource === 'ai') {
    const caveat = document.createElement('small')
    caveat.textContent = 'Идея создана ИИ; детали места проверьте перед выходом.'
    action.appendChild(caveat)
  }
  const evidence = (item as Recommendation & { evidence?: Array<{ claim: string; sourceUrl: string }> }).evidence
  const evidenceBlock = document.createElement('div')
  evidenceBlock.className = 'place-evidence'
  if (Array.isArray(evidence)) {
    for (const entry of evidence.slice(0, 4)) {
      if (!entry || typeof entry.claim !== 'string' || typeof entry.sourceUrl !== 'string') continue
      const link = createLink(entry.claim, entry.sourceUrl, 'evidence-link')
      if (link) evidenceBlock.appendChild(link)
    }
  }
  if (evidenceBlock.childElementCount) {
    const evidenceLabel = document.createElement('span')
    evidenceLabel.className = 'evidence-label'
    evidenceLabel.textContent = 'Подробности в источниках'
    evidenceBlock.insertBefore(evidenceLabel, evidenceBlock.firstChild)
  }
  const links = document.createElement('div')
  links.className = 'place-links'
  for (const [label, value, className] of [
    ['Маршрут до места ↗', item.routeUrl, 'map-link'],
    ['Источник места ↗', item.sourceUrl, 'source-link'],
    ['Источник времени ↗', item.travelSourceUrl, 'source-link'],
    ['Источник стоимости ↗', item.costSourceUrl, 'source-link'],
  ] as const) {
    const link = createLink(label, value, className)
    if (link) links.appendChild(link)
  }
  appendNodes(card, top, name, why, facts, action)
  if (evidenceBlock.childElementCount) card.appendChild(evidenceBlock)
  card.appendChild(links)
  return card
}

function validPoint(point: unknown): point is MapCoordinate {
  if (!point || typeof point !== 'object') return false
  const value = point as Partial<MapCoordinate>
  return typeof value.lat === 'number' && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90
    && typeof value.lon === 'number' && Number.isFinite(value.lon) && Math.abs(value.lon) <= 180
}

function showResults(response: RouteResponse, selectedRoute = 0): void {
  mapController?.destroy()
  mapController = null
  results.hidden = false
  results.replaceChildren()
  const routes = response.routes?.filter((candidate) => Array.isArray(candidate.stops) && candidate.stops.length > 0) ?? []
  const route = routes[selectedRoute] ?? routes[0]
  if (!route) {
    showError(response.summary || 'По вашему запросу пока не нашлось подтверждённых мест. Попробуйте описать интересы иначе или выделить больше времени.')
    return
  }
  state.stops = route.stops.slice(0, 3)

  const heading = document.createElement('div')
  heading.className = 'results-heading'
  const eyebrow = document.createElement('span')
  eyebrow.className = 'results-eyebrow'
  eyebrow.textContent = state.scope === 'day_trip' ? 'Поездка из Астаны' : 'Маршрут по Астане'
  const title = document.createElement('h2')
  title.textContent = route.title || 'Ваш маршрут'
  const summary = document.createElement('p')
  summary.textContent = route.summary || response.summary
  const meta = document.createElement('div')
  meta.className = 'route-meta'
  addFact(meta, stopCount(state.stops.length))
  addFact(meta, `${groupSize.value} чел.`)
  if (typeof route.totalMinutesApprox === 'number' && state.transport === 'walk') {
    addFact(meta, `≈ ${formatMinutes(route.totalMinutesApprox)} пешком и на местах`)
  }
  appendNodes(heading, eyebrow, title, summary, meta)
  const routeLink = createLink('Открыть весь маршрут ↗', route.routeUrl, 'route-link')
  if (routeLink) heading.appendChild(routeLink)
  results.appendChild(heading)

  if (state.scope === 'day_trip' && routes.length > 1) {
    const variants = document.createElement('div')
    variants.className = 'trip-variants'
    variants.setAttribute('role', 'group')
    variants.setAttribute('aria-label', 'Варианты поездки из Астаны')
    routes.slice(0, 3).forEach((candidate, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'trip-variant'
      button.classList.toggle('is-selected', candidate === route)
      button.setAttribute('aria-pressed', String(candidate === route))
      button.textContent = candidate.title
      button.addEventListener('click', () => showResults(response, index))
      variants.appendChild(button)
    })
    results.appendChild(variants)
  }

  const layout = document.createElement('div')
  layout.className = 'route-layout'
  const mapPanel = document.createElement('section')
  mapPanel.className = 'route-map-panel'
  mapPanel.setAttribute('aria-label', 'Карта маршрута')
  const mapHeading = document.createElement('div')
  mapHeading.className = 'map-heading'
  const mapTitle = document.createElement('h3')
  mapTitle.textContent = 'На карте'
  const mapCount = document.createElement('span')
  mapCount.textContent = stopCount(state.stops.length)
  appendNodes(mapHeading, mapTitle, mapCount)
  const map = document.createElement('div')
  map.id = 'map'
  map.className = 'map-canvas'
  map.setAttribute('role', 'region')
  map.setAttribute('aria-label', 'Карта остановок маршрута')
  const preview = document.createElement('div')
  preview.id = 'mapPreview'
  preview.className = 'map-preview'
  preview.setAttribute('role', 'status')
  preview.hidden = true
  const geometry = Array.isArray(route.geometry) ? route.geometry.filter(validPoint) : []
  const geometryIsRoad = geometry.length >= 2
  const mapNote = document.createElement('p')
  mapNote.className = 'map-disclosure'
  mapNote.textContent = geometryIsRoad
    ? 'Линия показывает рассчитанный путь. Перед дорогой проверьте его во внешней карте.'
    : 'Пунктир показывает порядок остановок, а не дорогу по улицам. Точный путь откройте во внешней карте.'
  const privacyNote = document.createElement('p')
  privacyNote.className = 'map-privacy-note'
  privacyNote.textContent = 'При просмотре карты загружаются данные OpenStreetMap. При открытии внешнего маршрута его точки передаются картографическому сервису.'
  appendNodes(mapPanel, mapHeading, map, preview, mapNote, privacyNote)

  const stopPanel = document.createElement('section')
  stopPanel.className = 'route-stops'
  const stopTitle = document.createElement('h3')
  stopTitle.textContent = 'Остановки по порядку'
  const list = document.createElement('div')
  list.className = 'place-list'
  state.stops.forEach((item, index) => list.appendChild(createStopCard(item, index)))
  appendNodes(stopPanel, stopTitle, list)
  appendNodes(layout, mapPanel, stopPanel)
  results.appendChild(layout)
  if (response.note) {
    const note = document.createElement('p')
    note.className = 'results-note'
    note.textContent = response.note
    results.appendChild(note)
  }

  const markers = state.stops.filter((item): item is Recommendation & MapCoordinate => validPoint(item))
    .map((item) => ({ id: item.id, name: item.name, lat: item.lat, lon: item.lon, kind: item.kind, category: item.category, sourceUrl: item.sourceUrl }))
  const routeOrigin = validPoint(route.origin) ? route.origin : origin()
  const routeLine = geometryIsRoad ? geometry : [routeOrigin, ...markers]
  mapController = mountRecommendationsMap(map, {
    markers,
    center: routeOrigin,
    routeLine,
    schematic: !geometryIsRoad,
    onSelect: (id) => {
      const item = state.stops.find((stop) => stop.id === id)
      if (item) showMapPreview(item)
    },
  })
  scrollToResults()
}

planner.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (state.isLoading) return
  const validated = validateForm()
  if (!validated) return
  if (!telegram?.initData) {
    showError('Для составления маршрута откройте приложение через бота в Telegram. Так мы сможем безопасно обработать ваш запрос.')
    return
  }
  prompt.blur()
  clearResults()
  showLoading()
  setLoading(true)
  const controller = new AbortController()
  const version = ++requestVersion
  activeRecommendation = controller
  const timeout = window.setTimeout(() => controller.abort(), 45_000)
  try {
    const response = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeRequest(validated)),
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Не удалось подтвердить запуск в Telegram. Полностью закройте окно приложения и откройте его снова через @smart_city_ryadombot.')
      if (response.status === 429) throw new Error('Слишком много запросов. Подождите немного и попробуйте снова.')
      throw new Error('Сервис временно недоступен. Попробуйте ещё раз через несколько секунд.')
    }
    const data: RouteResponse = await response.json()
    if (version !== requestVersion) return
    if (!data || typeof data.summary !== 'string' || !Array.isArray(data.routes)) {
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

renderDurationChoices()
renderTransportChoices()
