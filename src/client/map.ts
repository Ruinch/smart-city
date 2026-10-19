import './map.css'
import { ASTANA_CENTER } from '../shared/astana'

export interface MapMarker {
  id: string
  name: string
  lat: number
  lon: number
  kind?: string
  category?: string
  sourceUrl?: string
}

export interface MapCoordinate {
  lat: number
  lon: number
}

export type MapLanguage = 'ru' | 'kk' | 'en'

export interface RecommendationsMapOptions {
  markers: MapMarker[]
  language?: MapLanguage
  center?: MapCoordinate
  startPoint?: MapCoordinate
  routeLine?: MapCoordinate[]
  schematic?: boolean
  onSelect?: (id: string) => void
  onStartPointSelect?: (point: MapCoordinate) => void
}

export interface RecommendationsMapController {
  update(markers: MapMarker[], center?: MapCoordinate, routeLine?: MapCoordinate[], schematic?: boolean): void
  select(id: string): void
  focus(point: MapCoordinate): void
  fit(): void
  setBottomInset(px: number): void
  setLanguage(language: MapLanguage): void
  setStartPoint(point?: MapCoordinate): void
  setStartPointSelectionMode(enabled: boolean): void
  destroy(): void
}

interface MapCopy {
  root: string
  viewport: string
  zoomIn: string
  zoomOut: string
  fitAll: string
  fitCity: string
  fitAllLabel: string
  fitCityLabel: string
  failure: string
  stops: string
  mapPoints: string
  attribution: string
  selected: (name: string) => string
  selectPrompt: string
  showTrip: (name: string) => string
  showStop: (name: string) => string
  noPins: string
  clusterOpen: (count: number) => string
  clusterZoom: (count: number) => string
  chooseStart: string
  startPin: string
  startLabel: string
}

const MAP_COPY: Record<MapLanguage, MapCopy> = {
  ru: {
    root: 'Карта Астаны и маршрута', viewport: 'Карта. Стрелки передвигают её, плюс и минус меняют масштаб.',
    zoomIn: 'Приблизить карту', zoomOut: 'Отдалить карту', fitAll: 'Все', fitCity: 'Астана',
    fitAllLabel: 'Показать весь маршрут', fitCityLabel: 'Вернуться к Астане',
    failure: 'Часть карты не загрузилась. Остановки маршрута остаются в панели.',
    stops: 'Остановки маршрута', mapPoints: 'Точки на карте',
    attribution: '© участники OpenStreetMap',
    selected: (name) => `Выбрано: ${name}`, selectPrompt: 'Выберите точку на карте или в списке.',
    showTrip: (name) => `Показать поездку: ${name}`, showStop: (name) => `Показать остановку: ${name}`,
    noPins: 'На карте пока нет точек.',
    clusterOpen: (count) => `Открыть группу из ${count} точек`,
    clusterZoom: (count) => `Приблизить группу из ${count} точек`,
    chooseStart: 'Нажмите на карту, чтобы выбрать точку старта. Можно перемещать карту и выбрать её клавишей Enter.',
    startPin: 'Выбранная точка старта', startLabel: 'Старт',
  },
  kk: {
    root: 'Астана мен маршрут картасы', viewport: 'Карта. Көрсеткілермен жылжытыңыз, плюс пен минус арқылы масштабты өзгертіңіз.',
    zoomIn: 'Картаны жақындату', zoomOut: 'Картаны алыстату', fitAll: 'Бәрі', fitCity: 'Астана',
    fitAllLabel: 'Маршрутты толық көрсету', fitCityLabel: 'Астанаға оралу',
    failure: 'Картаның бір бөлігі жүктелмеді. Маршрут аялдамалары панельде бар.',
    stops: 'Маршрут аялдамалары', mapPoints: 'Картадағы нүктелер',
    attribution: '© OpenStreetMap қатысушылары',
    selected: (name) => `Таңдалды: ${name}`, selectPrompt: 'Картадан немесе тізімнен нүктені таңдаңыз.',
    showTrip: (name) => `Сапарды көрсету: ${name}`, showStop: (name) => `Аялдаманы көрсету: ${name}`,
    noPins: 'Картада әзірге нүктелер жоқ.',
    clusterOpen: (count) => `${count} нүктеден тұратын топты ашу`,
    clusterZoom: (count) => `${count} нүктеден тұратын топты жақындату`,
    chooseStart: 'Бастау нүктесін таңдау үшін картаны түртіңіз. Картаны жылжытып, Enter пернесімен таңдауға да болады.',
    startPin: 'Таңдалған бастау нүктесі', startLabel: 'Бастау',
  },
  en: {
    root: 'Astana and route map', viewport: 'Map. Use arrow keys to move and plus or minus to zoom.',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', fitAll: 'All', fitCity: 'Astana',
    fitAllLabel: 'Show the full route', fitCityLabel: 'Return to Astana',
    failure: 'Some map tiles did not load. Route stops remain in the panel.',
    stops: 'Route stops', mapPoints: 'Map points',
    attribution: '© OpenStreetMap contributors',
    selected: (name) => `Selected: ${name}`, selectPrompt: 'Choose a point on the map or in the list.',
    showTrip: (name) => `Show trip: ${name}`, showStop: (name) => `Show stop: ${name}`,
    noPins: 'No points on the map yet.',
    clusterOpen: (count) => `Open group of ${count} points`,
    clusterZoom: (count) => `Zoom to group of ${count} points`,
    chooseStart: 'Tap the map to choose where to start. You can move the map and press Enter to choose its center.',
    startPin: 'Selected starting point', startLabel: 'Start',
  },
}

const TILE_SIZE = 256
const MIN_ZOOM = 5
const MAX_ZOOM = 18
const MAX_FIT_ZOOM = 15
const MAX_LATITUDE = 85.05112878
const OSM_TILE_BASE = 'https://tile.openstreetmap.org/'
const CITY_ZOOM = 12

interface Pixel {
  x: number
  y: number
}

function validCoordinate(value: MapCoordinate | undefined): value is MapCoordinate {
  return !!value && Number.isFinite(value.lat) && Number.isFinite(value.lon)
    && Math.abs(value.lat) <= 90 && Math.abs(value.lon) <= 180
}

function cleanMarkers(markers: MapMarker[]): MapMarker[] {
  const seen = new Set<string>()
  return markers.filter((marker) => {
    if (!marker || typeof marker.id !== 'string' || !marker.id
      || typeof marker.name !== 'string' || !marker.name
      || !validCoordinate(marker) || seen.has(marker.id)) return false
    seen.add(marker.id)
    return true
  })
}

function cleanRouteLine(points: MapCoordinate[] | undefined): MapCoordinate[] {
  const valid = (points ?? []).filter(validCoordinate)
  const limit = 1500
  if (valid.length <= limit) return valid
  return Array.from({ length: limit }, (_, index) =>
    valid[Math.round(index * (valid.length - 1) / (limit - 1))])
}

function project(point: MapCoordinate, zoom: number): Pixel {
  const latitude = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, point.lat))
  const sine = Math.sin(latitude * Math.PI / 180)
  const world = TILE_SIZE * 2 ** zoom
  return {
    x: (point.lon + 180) / 360 * world,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * world,
  }
}

function unproject(pixel: Pixel, zoom: number): MapCoordinate {
  const world = TILE_SIZE * 2 ** zoom
  const latitudeRadians = Math.atan(Math.sinh(Math.PI * (1 - 2 * pixel.y / world)))
  const longitude = ((pixel.x / world * 360) % 360 + 360) % 360 - 180
  return {
    lat: latitudeRadians * 180 / Math.PI,
    lon: longitude,
  }
}

function makeButton(className: string, label: string, visibleText: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.setAttribute('aria-label', label)
  button.textContent = visibleText
  return button
}

/**
 * Mounts a small, token-free OSM map. The caller owns API requests and synchronizes
 * result cards with the returned select method. Tiles are loaded only for the visible
 * viewport, with the browser's normal cache and a visible OSM attribution link.
 */
export function mountRecommendationsMap(
  container: HTMLElement,
  options: RecommendationsMapOptions,
): RecommendationsMapController {
  let language: MapLanguage = options.language ?? 'ru'
  const copy = () => MAP_COPY[language]
  const root = document.createElement('section')
  root.className = 'rec-map'
  root.lang = language
  root.setAttribute('aria-label', copy().root)

  const viewport = document.createElement('div')
  viewport.className = 'rec-map__viewport'
  viewport.tabIndex = 0
  viewport.setAttribute('role', 'group')
  viewport.setAttribute('aria-label', copy().viewport)

  const tileLayer = document.createElement('div')
  tileLayer.className = 'rec-map__tiles'
  tileLayer.setAttribute('aria-hidden', 'true')
  const fallbackTilePlane = document.createElement('div')
  fallbackTilePlane.className = 'rec-map__tile-plane rec-map__tile-plane--fallback'
  const activeTilePlane = document.createElement('div')
  activeTilePlane.className = 'rec-map__tile-plane rec-map__tile-plane--active'
  tileLayer.appendChild(fallbackTilePlane)
  tileLayer.appendChild(activeTilePlane)
  const routeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  routeSvg.classList.add('rec-map__route')
  routeSvg.setAttribute('aria-hidden', 'true')
  const routeHalo = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  routeHalo.classList.add('rec-map__route-halo')
  const routePath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  routePath.classList.add('rec-map__route-path')
  const routeStart = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  routeStart.classList.add('rec-map__route-start')
  routeStart.setAttribute('r', '6')
  routeSvg.appendChild(routeHalo)
  routeSvg.appendChild(routePath)
  routeSvg.appendChild(routeStart)
  const markerLayer = document.createElement('div')
  markerLayer.className = 'rec-map__markers'
  const clusterLayer = document.createElement('div')
  clusterLayer.className = 'rec-map__clusters'
  const startPin = document.createElement('div')
  startPin.className = 'rec-map__start-point'
  startPin.setAttribute('role', 'img')
  startPin.setAttribute('aria-label', copy().startPin)
  startPin.textContent = copy().startLabel
  startPin.hidden = true
  const controlLayer = document.createElement('div')
  controlLayer.className = 'rec-map__controls'
  const zoomIn = makeButton('rec-map__control', copy().zoomIn, '+')
  const zoomOut = makeButton('rec-map__control', copy().zoomOut, '−')
  const fitButton = makeButton('rec-map__control rec-map__control-fit', copy().fitAllLabel, copy().fitAll)
  controlLayer.appendChild(zoomIn)
  controlLayer.appendChild(zoomOut)
  controlLayer.appendChild(fitButton)

  const failure = document.createElement('p')
  failure.className = 'rec-map__failure'
  failure.setAttribute('role', 'status')
  failure.hidden = true
  failure.textContent = copy().failure

  const attribution = document.createElement('a')
  attribution.className = 'rec-map__attribution'
  attribution.href = 'https://www.openstreetmap.org/copyright'
  attribution.target = '_blank'
  attribution.rel = 'noopener noreferrer'
  attribution.textContent = copy().attribution

  viewport.appendChild(tileLayer)
  viewport.appendChild(routeSvg)
  viewport.appendChild(markerLayer)
  viewport.appendChild(clusterLayer)
  viewport.appendChild(startPin)
  viewport.appendChild(controlLayer)
  viewport.appendChild(failure)
  viewport.appendChild(attribution)

  const selectedLine = document.createElement('p')
  selectedLine.className = 'rec-map__selected'
  selectedLine.setAttribute('role', 'status')
  const fallbackDetails = document.createElement('details')
  fallbackDetails.className = 'rec-map__details'
  const fallbackSummary = document.createElement('summary')
  fallbackSummary.textContent = copy().stops
  const fallbackList = document.createElement('nav')
  fallbackList.className = 'rec-map__list'
  fallbackList.setAttribute('aria-label', copy().mapPoints)
  fallbackDetails.appendChild(fallbackSummary)
  fallbackDetails.appendChild(fallbackList)

  root.appendChild(viewport)
  root.appendChild(selectedLine)
  root.appendChild(fallbackDetails)
  container.replaceChildren(root)

  let markers = cleanMarkers(options.markers)
  let routeLine = cleanRouteLine(options.routeLine)
  let schematic = options.schematic ?? true
  let preferredCenter = validCoordinate(options.center) ? options.center : undefined
  let startPoint = validCoordinate(options.startPoint) ? options.startPoint : undefined
  let center: MapCoordinate = preferredCenter ?? markers[0] ?? ASTANA_CENTER
  let zoom = CITY_ZOOM
  let selectedId = ''
  let resizedAfterInteraction = false
  let bottomInset = 0
  let frame = 0
  let cameraFrame = 0
  let cameraTargetCenter: MapCoordinate = center
  let cameraTargetZoom = zoom
  let insetFitTimer = 0
  let destroyed = false
  let activePointer: number | null = null
  let lastPointer: Pixel | null = null
  let pointerOrigin: Pixel | null = null
  let pointerMoved = false
  let selectingStartPoint = false
  const tiles = new Map<string, HTMLImageElement>()
  let activeTileZoom = -1
  let activeTileOrigin: Pixel = { x: 0, y: 0 }
  let fallbackTileZoom = -1
  let fallbackTileOrigin: Pixel = { x: 0, y: 0 }
  let fallbackRemovalTimer = 0
  let tileGeneration = 0
  const markerButtons = new Map<string, HTMLButtonElement>()
  const listButtons = new Map<string, HTMLButtonElement>()
  const clusterButtons = new Map<string, HTMLButtonElement>()
  const clusterGroups = new Map<string, MapMarker[]>()
  const reducedMotion = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null

  function applyLanguage(): void {
    root.lang = language
    root.setAttribute('aria-label', copy().root)
    viewport.setAttribute('aria-label', selectingStartPoint ? `${copy().viewport} ${copy().chooseStart}` : copy().viewport)
    zoomIn.setAttribute('aria-label', copy().zoomIn)
    zoomOut.setAttribute('aria-label', copy().zoomOut)
    failure.textContent = copy().failure
    attribution.textContent = copy().attribution
    startPin.setAttribute('aria-label', copy().startPin)
    startPin.textContent = copy().startLabel
    fallbackList.setAttribute('aria-label', copy().mapPoints)
    rebuildMarkerControls()
    queueRender()
  }

  function viewportSize(): { width: number; height: number } {
    return {
      width: Math.max(1, viewport.clientWidth),
      height: Math.max(1, viewport.clientHeight),
    }
  }

  function effectiveBottomInset(height: number): number {
    return Math.min(bottomInset, Math.max(0, height - 80))
  }

  function visibleHeight(height: number): number {
    return height - effectiveBottomInset(height)
  }

  function mapAnchorY(height: number): number {
    return visibleHeight(height) / 2
  }

  function cancelCamera(): void {
    if (cameraFrame) cancelAnimationFrame(cameraFrame)
    cameraFrame = 0
    cameraTargetCenter = center
    cameraTargetZoom = zoom
    viewport.classList.remove('is-moving')
  }

  function moveCamera(targetCenter: MapCoordinate, targetZoom: number, animate = true): void {
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom))
    cancelCamera()
    cameraTargetCenter = targetCenter
    cameraTargetZoom = nextZoom
    if (!animate || reducedMotion?.matches || document.hidden) {
      center = targetCenter
      zoom = nextZoom
      queueRender()
      return
    }

    const from = project(center, 0)
    const to = project(targetCenter, 0)
    let deltaX = to.x - from.x
    if (deltaX > TILE_SIZE / 2) deltaX -= TILE_SIZE
    if (deltaX < -TILE_SIZE / 2) deltaX += TILE_SIZE
    const deltaY = to.y - from.y
    const zoomDelta = nextZoom - zoom
    if (Math.abs(deltaX) < 0.000001 && Math.abs(deltaY) < 0.000001 && Math.abs(zoomDelta) < 0.001) {
      center = targetCenter
      zoom = nextZoom
      queueRender()
      return
    }

    const initialZoom = zoom
    const { width, height } = viewportSize()
    const travel = Math.hypot(deltaX, deltaY)
    const farMove = travel * 2 ** Math.max(initialZoom, nextZoom)
      > Math.max(width, visibleHeight(height)) * 2.5
    const travelZoom = farMove
      ? Math.max(MIN_ZOOM, Math.min(initialZoom, nextZoom,
        Math.log2(Math.max(width, visibleHeight(height)) * 1.2 / travel)))
      : Math.min(initialZoom, nextZoom)
    const smoothstep = (value: number): number => value * value * (3 - 2 * value)
    const started = performance.now()
    const duration = farMove ? 650 : Math.min(460, 280 + Math.abs(zoomDelta) * 35)
    viewport.classList.add('is-moving')
    const tick = (now: number): void => {
      if (destroyed) return
      const progress = reducedMotion?.matches ? 1 : Math.min(1, (now - started) / duration)
      const panProgress = farMove
        ? smoothstep(Math.max(0, Math.min(1, (progress - 0.2) / 0.6)))
        : 1 - (1 - progress) ** 3
      center = progress < 1
        ? unproject({ x: from.x + deltaX * panProgress, y: from.y + deltaY * panProgress }, 0)
        : targetCenter
      if (farMove && progress < 1) {
        zoom = progress < 0.35
          ? initialZoom + (travelZoom - initialZoom) * smoothstep(progress / 0.35)
          : progress < 0.65
            ? travelZoom
            : travelZoom + (nextZoom - travelZoom) * smoothstep((progress - 0.65) / 0.35)
      } else {
        zoom = progress < 1 ? initialZoom + zoomDelta * panProgress : nextZoom
      }
      queueRender()
      if (progress < 1) cameraFrame = requestAnimationFrame(tick)
      else {
        cameraFrame = 0
        viewport.classList.remove('is-moving')
      }
    }
    cameraFrame = requestAnimationFrame(tick)
  }

  function fitMarkers(animate = false): void {
    const points: MapCoordinate[] = [...markers, ...routeLine]
    if (preferredCenter) points.push(preferredCenter)
    if (startPoint) points.push(startPoint)
    if (markers.length === 0 && routeLine.length === 0) {
      moveCamera(preferredCenter ?? startPoint ?? ASTANA_CENTER, CITY_ZOOM, animate)
      return
    }
    if (points.length === 0) return
    const { width, height } = viewportSize()
    const availableWidth = Math.max(80, width - 88)
    const availableHeight = Math.max(80, visibleHeight(height) - 88)
    for (let candidateZoom = MAX_FIT_ZOOM; candidateZoom >= MIN_ZOOM; candidateZoom -= 1) {
      const projected = points.map((point) => project(point, candidateZoom))
      const xs = projected.map((point) => point.x)
      const ys = projected.map((point) => point.y)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      if (candidateZoom === MIN_ZOOM
        || (maxX - minX <= availableWidth && maxY - minY <= availableHeight)) {
        moveCamera(
          unproject({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, candidateZoom),
          candidateZoom,
          animate,
        )
        break
      }
    }
  }

  function queueRender(): void {
    if (destroyed || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      render()
    })
  }

  function renderTiles(width: number, height: number): void {
    // Scale whole-zoom tile planes while the camera moves through fractional zoom.
    // Keep the previous plane behind new images until the visible tiles have loaded.
    const tileZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.floor(zoom + 0.000001)))
    if (tileZoom !== activeTileZoom) {
      tileGeneration += 1
      if (fallbackRemovalTimer) window.clearTimeout(fallbackRemovalTimer)
      fallbackRemovalTimer = 0
      if (activeTileZoom >= 0) {
        const activeLoaded = [...tiles.values()].filter((image) => image.complete && image.naturalWidth > 0).length
        const fallbackLoaded = fallbackTilePlane.querySelectorAll('.is-loaded').length
        if (fallbackTileZoom < 0 || activeLoaded >= fallbackLoaded) {
          fallbackTilePlane.replaceChildren(...Array.from(activeTilePlane.children))
          fallbackTileZoom = activeTileZoom
          fallbackTileOrigin = activeTileOrigin
        } else {
          activeTilePlane.replaceChildren()
        }
      }
      tiles.clear()
      activeTileZoom = tileZoom
    }
    const tileScale = 2 ** (zoom - tileZoom)
    const tileCenter = project(center, tileZoom)
    const left = tileCenter.x - width / (2 * tileScale)
    const top = tileCenter.y - mapAnchorY(height) / tileScale
    const startX = Math.floor(left / TILE_SIZE)
    const endX = Math.floor((left + width / tileScale - 1) / TILE_SIZE)
    const startY = Math.floor(top / TILE_SIZE)
    const endY = Math.floor((top + height / tileScale - 1) / TILE_SIZE)
    const tileCount = 2 ** tileZoom
    const visible = new Set<string>()

    activeTileOrigin = { x: startX, y: startY }
    activeTilePlane.style.transform = `translate3d(${((startX * TILE_SIZE - left) * tileScale).toFixed(2)}px, ${((startY * TILE_SIZE - top) * tileScale).toFixed(2)}px, 0) scale(${tileScale.toFixed(5)})`
    if (fallbackTileZoom >= 0) {
      const fallbackScale = 2 ** (zoom - fallbackTileZoom)
      const fallbackCenter = project(center, fallbackTileZoom)
      fallbackTilePlane.style.transform = `translate3d(${(width / 2 + (fallbackTileOrigin.x * TILE_SIZE - fallbackCenter.x) * fallbackScale).toFixed(2)}px, ${(mapAnchorY(height) + (fallbackTileOrigin.y * TILE_SIZE - fallbackCenter.y) * fallbackScale).toFixed(2)}px, 0) scale(${fallbackScale.toFixed(5)})`
    }

    for (let x = startX; x <= endX; x += 1) {
      for (let y = startY; y <= endY; y += 1) {
        if (y < 0 || y >= tileCount) continue
        const wrappedX = ((x % tileCount) + tileCount) % tileCount
        const key = tileZoom + '/' + wrappedX + '/' + y
        visible.add(key)
        let image = tiles.get(key)
        if (!image) {
          const tileImage = document.createElement('img')
          image = tileImage
          tileImage.className = 'rec-map__tile'
          tileImage.alt = ''
          tileImage.draggable = false
          tileImage.decoding = 'async'
          tileImage.loading = 'lazy'
          tileImage.referrerPolicy = 'strict-origin-when-cross-origin'
          tileImage.addEventListener('load', () => {
            tileImage.classList.add('is-loaded')
            if (!destroyed && fallbackTileZoom >= 0 && tiles.get(key) === tileImage) queueRender()
          })
          tileImage.addEventListener('error', () => {
            if (!destroyed && tiles.get(key) === tileImage) {
              failure.hidden = false
              fallbackDetails.open = true
            }
          })
          tileImage.src = OSM_TILE_BASE + key + '.png'
          tiles.set(key, tileImage)
          activeTilePlane.appendChild(tileImage)
        }
        image.style.left = (x - startX) * TILE_SIZE + 'px'
        image.style.top = (y - startY) * TILE_SIZE + 'px'
      }
    }
    for (const [key, image] of tiles) {
      if (visible.has(key)) continue
      image.remove()
      tiles.delete(key)
    }
    if (fallbackTileZoom >= 0 && !fallbackRemovalTimer && visible.size > 0 && [...visible].every((key) => {
      const image = tiles.get(key)
      return image?.complete && image.naturalWidth > 0
    })) {
      const generation = tileGeneration
      fallbackRemovalTimer = window.setTimeout(() => {
        fallbackRemovalTimer = 0
        if (destroyed || tileGeneration !== generation) return
        if ([...visible].some((key) => {
          const image = tiles.get(key)
          return !image?.complete || image.naturalWidth === 0
        })) {
          queueRender()
          return
        }
        fallbackTilePlane.replaceChildren()
        fallbackTileZoom = -1
      }, 170)
    }
  }

  function renderMarkers(centerPixel: Pixel, width: number, height: number): void {
    const world = TILE_SIZE * 2 ** zoom
    const visible: Array<{ marker: MapMarker; button: HTMLButtonElement; x: number; y: number }> = []
    for (const marker of markers) {
      const button = markerButtons.get(marker.id)
      if (!button) continue
      const pixel = project(marker, zoom)
      let deltaX = pixel.x - centerPixel.x
      if (deltaX > world / 2) deltaX -= world
      if (deltaX < -world / 2) deltaX += world
      const x = width / 2 + deltaX
      const y = mapAnchorY(height) + pixel.y - centerPixel.y
      button.style.left = x.toFixed(1) + 'px'
      button.style.top = y.toFixed(1) + 'px'
      button.hidden = x < -30 || x > width + 30 || y < -30 || y > height + 30
      if (!button.hidden) visible.push({ marker, button, x, y })
    }

    clusterGroups.clear()
    const activeClusters = new Set<string>()
    const groups: Array<Array<(typeof visible)[number]>> = []
    for (const point of visible) {
      const nearby = groups.find((group) => {
        const anchor = group[0]
        return Math.hypot(point.x - anchor.x, point.y - anchor.y) < 42
      })
      if (nearby) nearby.push(point)
      else groups.push([point])
    }
    for (const group of groups) {
      if (group.length < 2) continue
      for (const point of group) point.button.hidden = true
      const x = group.reduce((sum, point) => sum + point.x, 0) / group.length
      const y = group.reduce((sum, point) => sum + point.y, 0) / group.length
      const key = JSON.stringify(group.map((point) => point.marker.id).sort())
      activeClusters.add(key)
      clusterGroups.set(key, group.map((point) => point.marker))
      let cluster = clusterButtons.get(key)
      if (!cluster) {
        cluster = makeButton('rec-map__cluster', '', String(group.length))
        cluster.addEventListener('click', () => {
          const current = clusterGroups.get(key)
          if (!current?.length) return
          if (zoom >= MAX_ZOOM) {
            selectMarker(current[0].id, true)
            return
          }
          const centerLat = current.reduce((sum, point) => sum + point.lat, 0) / current.length
          const centerLon = current.reduce((sum, point) => sum + point.lon, 0) / current.length
          resizedAfterInteraction = true
          moveCamera({ lat: centerLat, lon: centerLon }, Math.min(MAX_ZOOM, Math.floor(zoom) + 1))
        })
        clusterButtons.set(key, cluster)
        clusterLayer.appendChild(cluster)
      }
      cluster.setAttribute('aria-label', zoom >= MAX_ZOOM ? copy().clusterOpen(group.length) : copy().clusterZoom(group.length))
      cluster.style.left = x.toFixed(1) + 'px'
      cluster.style.top = y.toFixed(1) + 'px'
    }
    for (const [key, cluster] of clusterButtons) {
      if (activeClusters.has(key)) continue
      cluster.remove()
      clusterButtons.delete(key)
    }
  }

  function renderStartPoint(centerPixel: Pixel, width: number, height: number): void {
    if (!startPoint) {
      startPin.hidden = true
      return
    }
    const world = TILE_SIZE * 2 ** zoom
    const pixel = project(startPoint, zoom)
    let deltaX = pixel.x - centerPixel.x
    if (deltaX > world / 2) deltaX -= world
    if (deltaX < -world / 2) deltaX += world
    const x = width / 2 + deltaX
    const y = mapAnchorY(height) + pixel.y - centerPixel.y
    startPin.style.left = x.toFixed(1) + 'px'
    startPin.style.top = y.toFixed(1) + 'px'
    startPin.hidden = x < -60 || x > width + 60 || y < -60 || y > height + 60
  }

  function renderRouteLine(centerPixel: Pixel, width: number, height: number): void {
    if (routeLine.length < 2) {
      routeSvg.style.display = 'none'
      return
    }
    routeSvg.style.display = ''
    routeSvg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    routeSvg.setAttribute('width', String(width))
    routeSvg.setAttribute('height', String(height))
    routeSvg.classList.toggle('is-schematic', schematic)
    const world = TILE_SIZE * 2 ** zoom
    const positions = routeLine.map((point) => {
      const pixel = project(point, zoom)
      let deltaX = pixel.x - centerPixel.x
      if (deltaX > world / 2) deltaX -= world
      if (deltaX < -world / 2) deltaX += world
      return { x: width / 2 + deltaX, y: mapAnchorY(height) + pixel.y - centerPixel.y }
    })
    const path = positions.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
    routeHalo.setAttribute('d', path)
    routePath.setAttribute('d', path)
    routeStart.setAttribute('cx', positions[0].x.toFixed(1))
    routeStart.setAttribute('cy', positions[0].y.toFixed(1))
  }

  function render(): void {
    if (destroyed) return
    const { width, height } = viewportSize()
    viewport.style.setProperty('--map-bottom-inset', Math.round(effectiveBottomInset(height)) + 'px')
    const centerPixel = project(center, zoom)
    renderTiles(width, height)
    renderRouteLine(centerPixel, width, height)
    renderMarkers(centerPixel, width, height)
    renderStartPoint(centerPixel, width, height)
    zoomIn.disabled = zoom >= MAX_ZOOM
    zoomOut.disabled = zoom <= MIN_ZOOM
    fitButton.textContent = markers.length ? copy().fitAll : copy().fitCity
    fitButton.setAttribute('aria-label', markers.length ? copy().fitAllLabel : copy().fitCityLabel)
  }

  function syncSelection(): void {
    const marker = markers.find((item) => item.id === selectedId)
    selectedLine.textContent = marker ? copy().selected(marker.name) : copy().selectPrompt
    for (const [id, button] of markerButtons) {
      const selected = id === selectedId
      button.classList.toggle('is-selected', selected)
      button.setAttribute('aria-pressed', String(selected))
    }
    for (const [id, button] of listButtons) {
      const selected = id === selectedId
      button.classList.toggle('is-selected', selected)
      button.setAttribute('aria-pressed', String(selected))
    }
  }

  function selectMarker(id: string, notify: boolean): void {
    const marker = markers.find((item) => item.id === id)
    if (!marker) return
    selectedId = id
    syncSelection()
    const { width, height } = viewportSize()
    const markerPixel = project(marker, zoom)
    const centerPixel = project(center, zoom)
    const selectedY = mapAnchorY(height) + markerPixel.y - centerPixel.y
    let nextCenter = center
    let nextZoom = zoom
    if (Math.abs(markerPixel.x - centerPixel.x) > width * 0.32
      || selectedY < 40 || selectedY > visibleHeight(height) - 40) {
      nextCenter = { lat: marker.lat, lon: marker.lon }
    }
    if (markerButtons.get(id)?.hidden) {
      nextCenter = { lat: marker.lat, lon: marker.lon }
      while (nextZoom < MAX_ZOOM) {
        const markerAtZoom = project(marker, nextZoom)
        const overlaps = markers.some((other) => other.id !== id
          && Math.hypot(
            project(other, nextZoom).x - markerAtZoom.x,
            project(other, nextZoom).y - markerAtZoom.y,
          ) < 42)
        if (!overlaps) break
        nextZoom += 1
      }
      resizedAfterInteraction = true
    }
    if (nextCenter !== center || nextZoom !== zoom) moveCamera(nextCenter, nextZoom)
    if (notify) options.onSelect?.(id)
  }

  function rebuildMarkerControls(): void {
    markerLayer.replaceChildren()
    clusterLayer.replaceChildren()
    clusterButtons.clear()
    clusterGroups.clear()
    fallbackList.replaceChildren()
    fallbackSummary.textContent = `${copy().stops} (${markers.length})`
    fallbackDetails.hidden = markers.length === 0
    markerButtons.clear()
    listButtons.clear()
    markers.forEach((marker, index) => {
      const isTrip = marker.kind === 'trip'
      const label = isTrip ? copy().showTrip(marker.name) : copy().showStop(marker.name)
      const pin = makeButton('rec-map__marker', label, String(index + 1))
      pin.title = marker.name
      pin.classList.toggle('is-trip', isTrip)
      pin.addEventListener('click', () => selectMarker(marker.id, true))
      markerLayer.appendChild(pin)
      markerButtons.set(marker.id, pin)

      const listButton = makeButton('rec-map__list-item', label, '')
      const number = document.createElement('span')
      number.className = 'rec-map__list-number'
      number.textContent = String(index + 1)
      const name = document.createElement('span')
      name.textContent = marker.name
      listButton.appendChild(number)
      listButton.appendChild(name)
      listButton.addEventListener('click', () => selectMarker(marker.id, true))
      fallbackList.appendChild(listButton)
      listButtons.set(marker.id, listButton)
    })
    if (markers.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'rec-map__empty'
      empty.textContent = copy().noPins
      fallbackList.appendChild(empty)
    }
    syncSelection()
  }

  function changeZoom(delta: number): void {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(cameraTargetZoom) + delta))
    if (next === cameraTargetZoom) return
    resizedAfterInteraction = true
    moveCamera(cameraTargetCenter, next)
  }

  function panBy(dx: number, dy: number, animate = false): void {
    const baseCenter = animate ? cameraTargetCenter : center
    const baseZoom = animate ? cameraTargetZoom : zoom
    const centerPixel = project(baseCenter, baseZoom)
    const world = TILE_SIZE * 2 ** baseZoom
    const nextCenter = unproject({
      x: centerPixel.x - dx,
      y: Math.max(0, Math.min(world, centerPixel.y - dy)),
    }, baseZoom)
    resizedAfterInteraction = true
    moveCamera(nextCenter, baseZoom, animate)
  }

  function pointAtClientPosition(clientX: number, clientY: number): MapCoordinate {
    const { width, height } = viewportSize()
    const rect = viewport.getBoundingClientRect()
    const x = (clientX - rect.left) * width / Math.max(1, rect.width)
    const y = (clientY - rect.top) * height / Math.max(1, rect.height)
    const centerPixel = project(center, zoom)
    const world = TILE_SIZE * 2 ** zoom
    return unproject({
      x: centerPixel.x + x - width / 2,
      y: Math.max(0, Math.min(world, centerPixel.y + y - mapAnchorY(height))),
    }, zoom)
  }

  zoomIn.addEventListener('click', () => changeZoom(1))
  zoomOut.addEventListener('click', () => changeZoom(-1))
  fitButton.addEventListener('click', () => {
    resizedAfterInteraction = false
    fitMarkers(true)
  })
  viewport.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Element && event.target.closest('button, a')) return
    if (activePointer !== null) return
    cancelCamera()
    activePointer = event.pointerId
    lastPointer = { x: event.clientX, y: event.clientY }
    pointerOrigin = lastPointer
    pointerMoved = false
    viewport.setPointerCapture(event.pointerId)
  })
  viewport.addEventListener('pointermove', (event) => {
    if (activePointer !== event.pointerId || !lastPointer || !pointerOrigin) return
    if (!pointerMoved) {
      if (Math.hypot(event.clientX - pointerOrigin.x, event.clientY - pointerOrigin.y) < 8) return
      pointerMoved = true
      viewport.classList.add('is-dragging')
    }
    panBy(event.clientX - lastPointer.x, event.clientY - lastPointer.y)
    lastPointer = { x: event.clientX, y: event.clientY }
  })
  function stopDragging(event: PointerEvent): void {
    if (activePointer !== event.pointerId) return
    const isTap = event.type === 'pointerup' && !pointerMoved && pointerOrigin
      && Math.hypot(event.clientX - pointerOrigin.x, event.clientY - pointerOrigin.y) < 8
    activePointer = null
    lastPointer = null
    pointerOrigin = null
    pointerMoved = false
    viewport.classList.remove('is-dragging')
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
    if (isTap && selectingStartPoint) {
      options.onStartPointSelect?.(pointAtClientPosition(event.clientX, event.clientY))
    }
  }
  viewport.addEventListener('pointerup', stopDragging)
  viewport.addEventListener('pointercancel', stopDragging)
  viewport.addEventListener('keydown', (event) => {
    const key = event.key
    if (selectingStartPoint && event.target === viewport && (key === 'Enter' || key === ' ')) {
      options.onStartPointSelect?.({ ...center })
      event.preventDefault()
      return
    }
    if (key === '+' || key === '=') changeZoom(1)
    else if (key === '-') changeZoom(-1)
    else if (key === 'ArrowLeft') panBy(64, 0, true)
    else if (key === 'ArrowRight') panBy(-64, 0, true)
    else if (key === 'ArrowUp') panBy(0, 64, true)
    else if (key === 'ArrowDown') panBy(0, -64, true)
    else if (key === '0') {
      resizedAfterInteraction = false
      fitMarkers(true)
    } else return
    event.preventDefault()
  })
  viewport.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return
    event.preventDefault()
    changeZoom(event.deltaY < 0 ? 1 : -1)
  }, { passive: false })

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      if (destroyed) return
      if (!resizedAfterInteraction) fitMarkers()
      else queueRender()
    })
    : null
  resizeObserver?.observe(viewport)
  rebuildMarkerControls()
  fitMarkers()

  return {
    update(nextMarkers, nextCenter, nextRouteLine, nextSchematic) {
      markers = cleanMarkers(nextMarkers)
      routeLine = cleanRouteLine(nextRouteLine)
      schematic = nextSchematic ?? true
      preferredCenter = validCoordinate(nextCenter) ? nextCenter : undefined
      if (!markers.some((marker) => marker.id === selectedId)) selectedId = ''
      failure.hidden = true
      resizedAfterInteraction = false
      rebuildMarkerControls()
      fitMarkers(true)
    },
    select(id) {
      selectMarker(id, false)
    },
    focus(point) {
      if (!validCoordinate(point)) return
      resizedAfterInteraction = true
      moveCamera({ lat: point.lat, lon: point.lon }, Math.max(cameraTargetZoom, 14))
    },
    fit() {
      resizedAfterInteraction = false
      fitMarkers(true)
    },
    setBottomInset(px) {
      const next = Number.isFinite(px) ? Math.max(0, px) : 0
      if (Math.abs(next - bottomInset) < 1) return
      bottomInset = next
      // The bottom sheet can resize every frame. Follow it immediately, then
      // calculate one new fit after movement settles instead of restarting a fly-to.
      queueRender()
      if (insetFitTimer) window.clearTimeout(insetFitTimer)
      if (!resizedAfterInteraction && (markers.length || routeLine.length)) {
        insetFitTimer = window.setTimeout(() => {
          insetFitTimer = 0
          if (!destroyed && !resizedAfterInteraction) fitMarkers(true)
        }, 150)
      }
    },
    setLanguage(nextLanguage) {
      if (language === nextLanguage) return
      language = MAP_COPY[nextLanguage] ? nextLanguage : 'ru'
      applyLanguage()
    },
    setStartPoint(point) {
      if (point !== undefined && !validCoordinate(point)) return
      startPoint = point ? { lat: point.lat, lon: point.lon } : undefined
      resizedAfterInteraction = true
      queueRender()
    },
    setStartPointSelectionMode(enabled) {
      selectingStartPoint = enabled
      viewport.classList.toggle('is-selecting-start', enabled)
      viewport.setAttribute('aria-label', enabled ? `${copy().viewport} ${copy().chooseStart}` : copy().viewport)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      if (frame) cancelAnimationFrame(frame)
      if (insetFitTimer) window.clearTimeout(insetFitTimer)
      if (fallbackRemovalTimer) window.clearTimeout(fallbackRemovalTimer)
      cancelCamera()
      resizeObserver?.disconnect()
      tiles.clear()
      markerButtons.clear()
      listButtons.clear()
      clusterButtons.clear()
      clusterGroups.clear()
      root.remove()
    },
  }
}
