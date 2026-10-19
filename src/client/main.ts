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
  biergarten: 'Пивной сад', community_centre: 'Общественный центр',
  food_court: 'Фудкорт', ice_cream: 'Мороженое', planetarium: 'Планетарий',
  coffee: 'Магазин кофе', gift: 'Магазин подарков', art: 'Арт-магазин',
  fast_food: 'Быстрый перекус', confectionery: 'Кондитерская', mall: 'Торговый центр',
  zoo: 'Зоопарк', bowling_alley: 'Боулинг', escape_game: 'Квест',
  fitness_centre: 'Фитнес-центр', marina: 'Пристань', sports_centre: 'Спортивный центр',
  stadium: 'Стадион', water_park: 'Аквапарк', archaeological_site: 'Археологический памятник',
}

app.innerHTML = `
  <a class="skip-link" href="#content">К содержимому</a>
  <div class="app-shell" data-sheet="peek">
    <main id="content" class="map-stage" aria-label="Карта Астаны и маршрута">
      <div id="map" class="map-canvas" role="region" aria-label="Карта Астаны"></div>
      <header class="map-topbar topbar">
        <div class="brand" aria-label="Рядом — маршруты из Астаны">
          <span class="brand-mark" aria-hidden="true"><span></span></span>
          <span class="brand-name">рядом<span class="brand-period">.</span></span>
        </div>
        <span class="topbar-country">Астана</span>
      </header>
      <div class="map-actions" aria-label="Управление картой">
        <button id="recenterButton" class="map-action" type="button" aria-label="Показать начало маршрута" title="Показать начало маршрута"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg></button>
        <button id="fitButton" class="map-action" type="button" aria-label="Показать весь маршрут" title="Показать весь маршрут" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5m0 6v5h-5M4 15v5h5"/></svg></button>
      </div>
      <footer class="map-credits">
        <span>© участники OpenStreetMap</span>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Лицензия</a>
        <a href="/privacy.html">О данных</a>
      </footer>
    </main>

    <section id="routeSheet" class="route-sheet" aria-label="Планировщик маршрута">
      <button id="sheetHandle" class="sheet-handle" type="button" aria-label="Развернуть панель" aria-expanded="false" aria-controls="sheetBody">
        <span class="sheet-grip" aria-hidden="true"></span>
      </button>
      <div id="sheetBody" class="sheet-scroll">
        <div class="sheet-heading">
          <h1>Куда хочется?</h1>
          <p>Расскажите, какой вечер или прогулку вы задумали.</p>
          <button id="returnToRouteButton" class="return-route-button" type="button" hidden>← К маршруту</button>
        </div>
        <form id="planner" class="planner" novalidate>
        <div class="planner-lead">
          <label for="prompt">Что вам интересно</label>
          <p id="promptHint" class="visually-hidden">Опишите настроение, места и детали своими словами.</p>
        </div>
        <textarea id="prompt" name="prompt" rows="2" maxlength="300" aria-describedby="promptHint promptError" placeholder="Например, тихое кафе с книгой или танцы до ночи"></textarea>
        <p id="promptError" class="field-error" role="alert" hidden></p>
        <div class="example-row" role="group" aria-label="Примеры запросов">
          <button type="button" data-example="Хочу в клуб: музыка, танцы и движная ночь">Клуб и танцы</button>
          <button type="button" data-example="Тихое кафе, где можно попить кофе и почитать книгу">Кофе и книга</button>
          <button type="button" data-example="Прогулка с друзьями по интересным местам Астаны">С друзьями</button>
        </div>
        <button id="settingsToggle" class="settings-toggle" type="button" aria-expanded="false" aria-controls="advancedSettings">
          <span id="settingsSummary">Астана · 2 ч · пешком · 1 человек</span>
          <span class="settings-chevron" aria-hidden="true">⌄</span>
        </button>
        <div id="advancedSettings" class="advanced-settings">
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
        </div>
        <div class="submit-dock">
          <button id="submitButton" class="submit-button" type="submit">
            <span class="submit-label">Составить маршрут</span>
            <span class="submit-arrow" aria-hidden="true">→</span>
          </button>
        </div>
      </form>
      <section id="results" class="results" aria-live="polite" aria-label="Готовый маршрут" hidden></section>
      </div>
    </section>
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
const shell = requiredElement<HTMLElement>('.app-shell')
const sheetHandle = requiredElement<HTMLButtonElement>('#sheetHandle')
const sheetScroll = requiredElement<HTMLElement>('#sheetBody')
const settingsToggle = requiredElement<HTMLButtonElement>('#settingsToggle')
const settingsSummary = requiredElement<HTMLElement>('#settingsSummary')
const recenterButton = requiredElement<HTMLButtonElement>('#recenterButton')
const fitButton = requiredElement<HTMLButtonElement>('#fitButton')
const returnToRouteButton = requiredElement<HTMLButtonElement>('#returnToRouteButton')

type SheetMode = 'peek' | 'expanded' | 'loading' | 'results' | 'peek-results'

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
let currentRouteOrigin: MapCoordinate | null = null
const seenPlaceIds = new Set<string>()

function setSheetMode(mode: SheetMode): void {
  shell.dataset.sheet = mode
  const expanded = mode === 'expanded' || mode === 'results'
  sheetHandle.setAttribute('aria-expanded', String(expanded))
  sheetHandle.setAttribute('aria-label', mode === 'results' ? 'Свернуть маршрут' : mode === 'peek-results' ? 'Развернуть маршрут' : expanded ? 'Свернуть панель' : 'Развернуть панель')
  sheetHandle.disabled = mode === 'loading'
  settingsToggle.setAttribute('aria-expanded', String(mode === 'expanded'))
  planner.hidden = mode === 'loading' || mode === 'results' || mode === 'peek-results'
  if (mode !== 'results' && mode !== 'loading' && mode !== 'peek-results') results.hidden = true
  returnToRouteButton.hidden = !currentRouteOrigin || (mode !== 'peek' && mode !== 'expanded')
  sheetScroll.scrollTop = 0
}

function updateSettingsSummary(): void {
  const travel = state.transport === 'car' ? 'на машине' : state.transport === 'transit' ? 'транспорт' : 'пешком'
  const count = Number(groupSize.value) || 1
  const people = count === 1 ? '1 человек' : `${count} чел.`
  const money = budget.value.trim() === '' ? '' : ` · ${formatKzt(Number(budget.value))} на чел.`
  settingsSummary.textContent = `${state.scope === 'city' ? 'Астана' : 'Из Астаны'} · ${state.minutes === 1440 ? 'весь день' : formatMinutes(state.minutes)} · ${travel} · ${people}${money}`
}

sheetHandle.addEventListener('click', () => {
  const mode = shell.dataset.sheet as SheetMode
  if (mode === 'results') {
    setSheetMode('peek-results')
  } else if (mode === 'peek-results') {
    setSheetMode('results')
  } else if (mode !== 'loading') setSheetMode(mode === 'expanded' ? 'peek' : 'expanded')
})
settingsToggle.addEventListener('click', () => setSheetMode(shell.dataset.sheet === 'expanded' ? 'peek' : 'expanded'))
returnToRouteButton.addEventListener('click', () => setSheetMode('results'))
prompt.addEventListener('focus', () => setSheetMode('expanded'))
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && shell.dataset.sheet === 'expanded') setSheetMode('peek')
})

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
  sheetScroll.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

function clearResults(): void {
  requestVersion += 1
  activeRecommendation?.abort()
  activeRecommendation = null
  mapController?.update([], origin())
  currentRouteOrigin = null
  fitButton.hidden = true
  state.stops = []
  seenPlaceIds.clear()
  if (state.isLoading) setLoading(false)
  results.hidden = true
  results.replaceChildren()
  if (shell.dataset.sheet === 'results' || shell.dataset.sheet === 'peek-results' || shell.dataset.sheet === 'loading') setSheetMode('expanded')
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
      updateSettingsSummary()
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
      updateSettingsSummary()
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
  updateSettingsSummary()
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
  updateSettingsSummary()
})
groupSize.addEventListener('input', () => {
  groupSizeError.hidden = true
  clearResults()
  updateSettingsSummary()
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

function makeRequest(validated: { text: string; group: number; budgetKzt?: number }, excludePlaceIds: string[] = []): { initData: string; request: WalkRequest & { groupSize: number } } {
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
  if (excludePlaceIds.length) request.excludePlaceIds = excludePlaceIds
  if (state.coordinates) {
    request.latitude = state.coordinates.latitude
    request.longitude = state.coordinates.longitude
  }
  return { initData: telegram?.initData ?? '', request }
}

function setLoading(value: boolean, loadingLabel = 'Ищем маршрут…'): void {
  state.isLoading = value
  submitButton.disabled = value
  planner.setAttribute('aria-busy', String(value))
  submitLabel.textContent = value ? loadingLabel : 'Составить маршрут'
}

function showLoading(): void {
  results.hidden = false
  results.innerHTML = '<div class="results-heading"><h2>Ищем подходящие места</h2><p>Проверяем реальные места и собираем маршрут. Это может занять до минуты.</p></div><div class="loading-row" aria-hidden="true"><span></span><span></span><span></span></div>'
  setSheetMode('loading')
  scrollToResults()
}

function showError(message: string): void {
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
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.className = 'edit-route-button'
  retry.textContent = 'Изменить запрос'
  retry.addEventListener('click', () => {
    setSheetMode('expanded')
    prompt.focus()
  })
  panel.appendChild(retry)
  results.appendChild(panel)
  setSheetMode('results')
  scrollToResults()
}

function addFact(parent: HTMLElement, text: string): void {
  const fact = document.createElement('span')
  fact.textContent = text
  parent.appendChild(fact)
}

function formatPriceDate(value: string): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
}

function createPriceBlock(item: Recommendation): HTMLElement | null {
  const evidence = item.priceEvidence
  if (!evidence || !safeUrl(evidence.sourceUrl) || !Number.isFinite(evidence.minKzt) || evidence.minKzt < 0) return null
  const checkedAt = formatPriceDate(evidence.checkedAt)
  if (!checkedAt) return null
  if (evidence.qualifier === 'range' && (!Number.isFinite(evidence.maxKzt) || (evidence.maxKzt ?? 0) < evidence.minKzt)) return null

  const unit = evidence.unit === 'entry' ? 'Вход' : evidence.unit === 'average_bill' ? 'Средний чек' : 'Одна позиция'
  const amount = evidence.qualifier === 'range'
    ? `${formatKzt(evidence.minKzt)}–${formatKzt(evidence.maxKzt!)}`
    : evidence.qualifier === 'from' ? `от ${formatKzt(evidence.minKzt)}` : formatKzt(evidence.minKzt)
  const block = document.createElement('div')
  block.className = 'place-price'
  const value = document.createElement('strong')
  value.className = 'price-value'
  value.textContent = `${unit}: ${amount}`
  const meta = document.createElement('div')
  meta.className = 'price-meta'
  const date = document.createElement('span')
  date.textContent = `Проверено ${checkedAt}`
  const source = createLink('Источник цены ↗', evidence.sourceUrl, 'price-source')
  appendNodes(meta, date)
  if (source) meta.appendChild(source)
  appendNodes(block, value, meta)
  if (evidence.unit === 'item') {
    const note = document.createElement('span')
    note.className = 'price-note'
    note.textContent = 'Цена одной позиции, не всего посещения.'
    block.appendChild(note)
  }
  const plannedBudget = Number(budget.value)
  if (Number.isFinite(plannedBudget) && plannedBudget > 0 && evidence.minKzt > plannedBudget
    && evidence.unit !== 'item') {
    const note = document.createElement('span')
    note.className = 'price-note'
    note.textContent = evidence.unit === 'entry'
      ? 'Указанная цена билета выше вашего бюджета на человека.'
      : 'Опубликованный средний чек выше вашего бюджета на человека.'
    block.appendChild(note)
  }
  return block
}

function showMapPreview(item: Recommendation): void {
  const preview = results.querySelector<HTMLElement>('#mapPreview')
  if (!preview) return
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
  if (shell.dataset.sheet === 'peek-results') setSheetMode('results')
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
    setSheetMode('peek-results')
  })
  appendNodes(top, number, category, mapButton)
  const name = document.createElement('h3')
  name.textContent = item.name
  const why = document.createElement('p')
  why.className = 'place-why'
  why.textContent = item.why
  const facts = document.createElement('div')
  facts.className = 'place-facts'
  const priceBlock = createPriceBlock(item)
  if (typeof item.travelMinutesApprox === 'number') addFact(facts, `≈ ${formatMinutes(item.travelMinutesApprox)} ${travelModeLabel(item.travelMode)}`)
  else if (typeof item.walkMinutes === 'number') addFact(facts, `≈ ${formatMinutes(item.walkMinutes)} пешком`)
  else addFact(facts, 'Время дороги неизвестно')
  if (typeof item.visitMinutes === 'number') addFact(facts, `≈ ${formatMinutes(item.visitMinutes)} на месте`)
  if (item.estimatedCostKzt) {
    addFact(facts, `Расходы на дорогу ≈ ${formatKzt(item.estimatedCostKzt.min)}–${formatKzt(item.estimatedCostKzt.max)}`)
  } else if (!priceBlock) addFact(facts, 'Стоимость посещения неизвестна')
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
    ['Сайт из OSM ↗', item.venueWebsite, 'source-link'],
    ['Источник места ↗', item.sourceUrl, 'source-link'],
    ['Источник времени ↗', item.travelSourceUrl, 'source-link'],
    ['Источник стоимости ↗', item.costSourceUrl, 'source-link'],
  ] as const) {
    const link = createLink(label, value, className)
    if (link) links.appendChild(link)
  }
  appendNodes(card, top, name, why, facts)
  if (priceBlock) card.appendChild(priceBlock)
  card.appendChild(action)
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

function rememberShownStops(routes: RoutePlan[]): void {
  if (state.scope !== 'city') return
  for (const route of routes.slice(0, 3)) {
    for (const stop of route.stops.slice(0, 3)) seenPlaceIds.add(stop.id)
  }
}

function recentExcludedPlaceIds(): string[] {
  return [...seenPlaceIds]
    .filter((id) => /^osm:(?:node|way|relation):[1-9]\d{0,12}$/.test(id))
    .slice(-36)
}

function showResults(response: RouteResponse, selectedRoute = 0, focusVariant = false): void {
  results.hidden = false
  results.replaceChildren()
  const routes = response.routes?.filter((candidate) => Array.isArray(candidate.stops) && candidate.stops.length > 0) ?? []
  const route = routes[selectedRoute] ?? routes[0]
  if (!route) {
    showError(response.summary || 'По вашему запросу пока не нашлось подтверждённых мест. Попробуйте описать интересы иначе или выделить больше времени.')
    return
  }
  rememberShownStops(routes)
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
  const editButton = document.createElement('button')
  editButton.type = 'button'
  editButton.className = 'edit-route-button'
  editButton.textContent = 'Изменить запрос'
  editButton.addEventListener('click', () => setSheetMode('expanded'))
  heading.appendChild(editButton)
  const preview = document.createElement('div')
  preview.id = 'mapPreview'
  preview.className = 'map-preview'
  preview.setAttribute('role', 'status')
  preview.hidden = true
  heading.appendChild(preview)
  results.appendChild(heading)

  if (routes.length > 1) {
    const variantSection = document.createElement('section')
    variantSection.className = 'route-variants'
    const variantHeading = document.createElement('h3')
    variantHeading.textContent = state.scope === 'day_trip' ? 'Варианты поездки' : 'Варианты маршрута'
    const variants = document.createElement('div')
    variants.className = 'trip-variants'
    variants.setAttribute('role', 'group')
    variants.setAttribute('aria-label', variantHeading.textContent)
    routes.slice(0, 3).forEach((candidate, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'trip-variant'
      button.classList.toggle('is-selected', candidate === route)
      button.setAttribute('aria-pressed', String(candidate === route))
      const number = document.createElement('span')
      number.className = 'variant-number'
      number.textContent = `${state.scope === 'day_trip' ? 'Поездка' : 'Маршрут'} ${index + 1}`
      const name = document.createElement('span')
      name.className = 'variant-name'
      name.textContent = state.scope === 'city'
        ? candidate.stops[0]?.name || `Вариант ${index + 1}`
        : candidate.title || candidate.stops[0]?.name || `Вариант ${index + 1}`
      appendNodes(button, number, name)
      button.addEventListener('click', () => showResults(response, index, true))
      variants.appendChild(button)
    })
    appendNodes(variantSection, variantHeading, variants)
    results.appendChild(variantSection)
  }

  const geometry = Array.isArray(route.geometry) ? route.geometry.filter(validPoint) : []
  const geometryIsRoad = geometry.length >= 2
  const mapNote = document.createElement('p')
  mapNote.className = 'map-disclosure'
  mapNote.textContent = geometryIsRoad
    ? 'Линия показывает рассчитанный путь. Перед дорогой проверьте его во внешней карте.'
    : 'Пунктир показывает порядок остановок, а не дорогу по улицам. Точный путь откройте во внешней карте.'
  const stopPanel = document.createElement('section')
  stopPanel.className = 'route-stops'
  const stopTitle = document.createElement('h3')
  stopTitle.textContent = 'Остановки по порядку'
  const list = document.createElement('div')
  list.className = 'place-list'
  state.stops.forEach((item, index) => list.appendChild(createStopCard(item, index)))
  appendNodes(stopPanel, stopTitle, list, mapNote)
  results.appendChild(stopPanel)
  if (response.note) {
    const note = document.createElement('p')
    note.className = 'results-note'
    note.textContent = response.note
    results.appendChild(note)
  }
  if (state.scope === 'city') {
    const exploration = document.createElement('div')
    exploration.className = 'more-ideas'
    const moreButton = document.createElement('button')
    moreButton.type = 'button'
    moreButton.className = 'more-ideas-button'
    moreButton.textContent = 'Ещё идеи →'
    moreButton.setAttribute('aria-describedby', 'moreIdeasStatus')
    const status = document.createElement('p')
    status.id = 'moreIdeasStatus'
    status.className = 'more-ideas-status'
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    moreButton.addEventListener('click', () => { void requestMoreIdeas(moreButton, status) })
    appendNodes(exploration, moreButton, status)
    results.appendChild(exploration)
  }

  const markers = state.stops.filter((item): item is Recommendation & MapCoordinate => validPoint(item))
    .map((item) => ({ id: item.id, name: item.name, lat: item.lat, lon: item.lon, kind: item.kind, category: item.category, sourceUrl: item.sourceUrl }))
  const routeOrigin = validPoint(route.origin) ? route.origin : origin()
  const routeLine = geometryIsRoad ? geometry : [routeOrigin, ...markers]
  currentRouteOrigin = routeOrigin
  mapController?.update(markers, routeOrigin, routeLine, !geometryIsRoad)
  fitButton.hidden = false
  setSheetMode('results')
  if (focusVariant) {
    results.querySelector<HTMLButtonElement>('.trip-variant.is-selected')?.focus({ preventScroll: true })
  } else scrollToResults()
}

async function requestMoreIdeas(button: HTMLButtonElement, status: HTMLElement): Promise<void> {
  if (state.scope !== 'city' || state.isLoading) return
  const validated = validateForm()
  if (!validated) return
  if (!telegram?.initData) {
    status.textContent = 'Откройте приложение через бота в Telegram и попробуйте снова.'
    return
  }
  setLoading(true, 'Ищем ещё…')
  button.disabled = true
  button.textContent = 'Ищем идеи…'
  status.textContent = 'Ищем другие места по тем же условиям.'
  const controller = new AbortController()
  const version = ++requestVersion
  activeRecommendation = controller
  const timeout = window.setTimeout(() => controller.abort(), 45_000)
  let exhausted = false
  try {
    const response = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeRequest(validated, recentExcludedPlaceIds())),
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Сессия Telegram устарела. Откройте приложение через бота заново.')
      if (response.status === 429) throw new Error('Слишком много запросов. Подождите немного и попробуйте снова.')
      throw new Error('Не удалось найти новые идеи. Попробуйте чуть позже.')
    }
    const data: RouteResponse = await response.json()
    if (version !== requestVersion) return
    if (!data || !Array.isArray(data.routes)) throw new Error('Ответ сервера неполный. Попробуйте ещё раз.')
    const hasStops = data.routes.some((route) => Array.isArray(route.stops) && route.stops.length > 0)
    if (!hasStops) {
      exhausted = true
      status.textContent = 'Новых мест пока не нашлось. Попробуйте изменить запрос или параметры.'
      return
    }
    showResults(data)
    const newHeading = results.querySelector<HTMLHeadingElement>('.results-heading h2')
    if (newHeading) {
      newHeading.tabIndex = -1
      newHeading.focus({ preventScroll: true })
    }
  } catch (error) {
    if (version !== requestVersion) return
    status.textContent = error instanceof DOMException && error.name === 'AbortError'
      ? 'Поиск занял слишком много времени. Попробуйте ещё раз.'
      : error instanceof Error ? error.message : 'Не удалось найти новые идеи. Попробуйте ещё раз.'
  } finally {
    window.clearTimeout(timeout)
    if (version === requestVersion) {
      activeRecommendation = null
      setLoading(false)
      if (button.isConnected) {
        button.disabled = exhausted
        button.textContent = 'Ещё идеи →'
      }
    }
  }
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
updateSettingsSummary()

const mapStage = requiredElement<HTMLElement>('.map-stage')
const routeSheet = requiredElement<HTMLElement>('#routeSheet')
mapController = mountRecommendationsMap(requiredElement<HTMLElement>('#map'), {
  markers: [],
  center: ASTANA_CENTER,
  onSelect: (id) => {
    const item = state.stops.find((stop) => stop.id === id)
    if (item) showMapPreview(item)
  },
})

function syncMapInset(): void {
  const stage = mapStage.getBoundingClientRect()
  const sheet = routeSheet.getBoundingClientRect()
  const isBottomSheet = window.matchMedia('(max-width: 760px)').matches
  mapController?.setBottomInset(isBottomSheet ? Math.max(0, stage.bottom - sheet.top) : 0)
}
const sheetObserver = new ResizeObserver(syncMapInset)
sheetObserver.observe(routeSheet)
window.addEventListener('resize', syncMapInset)
requestAnimationFrame(syncMapInset)

recenterButton.addEventListener('click', () => mapController?.focus(currentRouteOrigin ?? origin()))
fitButton.addEventListener('click', () => mapController?.fit())
