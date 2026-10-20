import {
  GPUInitializationError,
  Map as MapLibreMap,
  setWorkerUrl,
  type MapEventType,
} from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const LOAD_TIMEOUT_MS = 12_000
// The existing overlay projects a 256 px world tile; MapLibre uses a 512 px world tile.
const OVERLAY_ZOOM_OFFSET = 1

export interface VectorBasemapCamera {
  center: { lat: number; lon: number }
  zoom: number
  width: number
  height: number
  bottomInset: number
  language: 'ru' | 'kk' | 'en'
}

export interface VectorBasemapController {
  update(camera: VectorBasemapCamera): void
  destroy(): void
}

export interface VectorBasemapFrame {
  width: number
  height: number
  /** Zoom in the overlay's 256 px world-tile convention. */
  zoom: number
  /** Project synchronously during onRender, using the camera that was just drawn. */
  project(point: { lat: number; lon: number }): { x: number; y: number }
}

export interface VectorBasemapCallbacks {
  /** Called after MapLibre's first visually complete render. */
  onReady(): void
  /** Called synchronously after a canvas render, after onReady has been delivered. */
  onRender?(frame: VectorBasemapFrame): void
  /** Called once if the vector map cannot become or remain usable. */
  onFailure(error: Error): void
}

function currentPixelRatio(): number {
  const ratio = window.devicePixelRatio
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

function cameraPadding(camera: VectorBasemapCamera): number {
  return Math.round(Math.max(0, Math.min(camera.bottomInset, camera.height - 80)))
}

function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value
  return new Error(typeof value === 'string' ? value : fallback)
}

function referencesPlaceName(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  if (value[0] === 'get' && typeof value[1] === 'string'
    && (value[1] === 'name' || value[1] === 'name_en'
      || value[1] === 'name:latin' || value[1] === 'name:nonlatin')) return true
  return value.some(referencesPlaceName)
}

function translatedName(language: VectorBasemapCamera['language']): unknown[] {
  const localized = `name:${language}`
  const present = (key: string): unknown[] => [
    'all', ['has', key], ['!=', ['get', key], ''],
  ]
  // OpenMapTiles keeps translated names as data fields. Keep the original name
  // where no translation exists, rather than inventing a label.
  return language === 'en'
    ? [
      'case', present(localized), ['get', localized],
      present('name_en'), ['get', 'name_en'],
      present('name'), ['get', 'name'],
      ['coalesce', ['get', 'name:latin'], ''],
    ]
    : [
      'case', present(localized), ['get', localized],
      present('name'), ['get', 'name'],
      ['coalesce', ['get', 'name:latin'], ''],
    ]
}

/**
 * Mount a sharp vector basemap behind the app's existing route and marker overlay.
 * The map does not receive pointer input; the app remains the sole camera controller.
 * The caller keeps its raster layer visible until onReady, and may restore it on onFailure.
 */
export function mountVectorBasemap(
  container: HTMLElement,
  initial: VectorBasemapCamera,
  callbacks: VectorBasemapCallbacks,
): VectorBasemapController {
  let map: MapLibreMap | undefined
  let destroyed = false
  let failed = false
  let ready = false
  let readyNotified = false
  let initialLoadComplete = false
  let loadTimeout: ReturnType<typeof setTimeout> | undefined
  let lastWidth = -1
  let lastHeight = -1
  let lastPixelRatio = currentPixelRatio()
  let lastCameraKey = ''
  let language = initial.language
  let appliedLanguage: VectorBasemapCamera['language'] | undefined
  let styleReady = false
  let nameLayerIds: string[] = []

  const fail = (error: Error): void => {
    if (destroyed || failed) return
    failed = true
    if (loadTimeout !== undefined) clearTimeout(loadTimeout)
    // Defer callbacks so a synchronous constructor failure cannot race the caller's
    // assignment of the returned controller.
    queueMicrotask(() => {
      if (!destroyed) callbacks.onFailure(error)
    })
  }

  const tryReady = (): void => {
    if (destroyed || failed || ready || !initialLoadComplete || !map) return
    // MapLibre may fire `load` after tile requests fail. Keep the usable raster
    // beneath this canvas until actual vector geometry has rendered.
    try {
      if (map.queryRenderedFeatures().length === 0) return
    } catch {
      return
    }
    ready = true
    if (loadTimeout !== undefined) clearTimeout(loadTimeout)
    queueMicrotask(() => {
      if (destroyed || failed || !map) return
      callbacks.onReady()
      if (destroyed || failed || !map) return
      readyNotified = true
      // A ready callback may leave the camera unchanged. Still draw one frame so
      // the overlay receives its initial projection after readiness is delivered.
      map.triggerRepaint()
    })
  }

  const handleRender = (): void => {
    if (destroyed || failed || !map) return
    tryReady()
    if (!readyNotified || !callbacks.onRender) return
    const renderedMap = map
    const canvas = renderedMap.getCanvas()
    const mapContainer = renderedMap.getContainer()
    const centerLng = renderedMap.getCenter().lng
    callbacks.onRender({
      width: canvas.clientWidth || mapContainer.clientWidth,
      height: canvas.clientHeight || mapContainer.clientHeight,
      zoom: renderedMap.getZoom() + OVERLAY_ZOOM_OFFSET,
      project(point) {
        const longitude = point.lon + 360 * Math.round((centerLng - point.lon) / 360)
        const projected = renderedMap.project([longitude, point.lat])
        return { x: projected.x, y: projected.y }
      },
    })
  }

  const handleLoad = (): void => {
    initialLoadComplete = true
    tryReady()
  }

  const handleError = (event: MapEventType['error']): void => {
    if (destroyed || failed) return
    // Style, glyph and tile requests can fail transiently. The initial load
    // timeout handles a map that genuinely never becomes usable.
    if (event.error instanceof GPUInitializationError) {
      fail(toError(event.error, 'The vector map could not start.'))
    }
  }

  const handleContextLost = (): void => {
    fail(new Error('The vector map lost its graphics context.'))
  }

  const applyLanguage = (): void => {
    if (destroyed || failed || !styleReady || !map || appliedLanguage === language) return
    try {
      const expression = translatedName(language) as Parameters<typeof map.setLayoutProperty<'text-field'>>[2]
      for (const id of nameLayerIds) map.setLayoutProperty(id, 'text-field', expression)
      appliedLanguage = language
    } catch (error) {
      fail(toError(error, 'The map could not apply its language.'))
    }
  }

  const handleStyleLoad = (): void => {
    if (destroyed || failed || !map) return
    nameLayerIds = map.getStyle().layers
      .filter((layer) => layer.type === 'symbol' && referencesPlaceName(layer.layout?.['text-field']))
      .map((layer) => layer.id)
    styleReady = true
    appliedLanguage = undefined
    applyLanguage()
  }

  const controller: VectorBasemapController = {
    update(camera) {
      if (destroyed || failed || !map) return
      try {
        language = camera.language
        applyLanguage()
        const pixelRatio = currentPixelRatio()
        if (pixelRatio !== lastPixelRatio) {
          map.setPixelRatio(pixelRatio)
          lastPixelRatio = pixelRatio
        }
        if (camera.width !== lastWidth || camera.height !== lastHeight) {
          map.resize()
          lastWidth = camera.width
          lastHeight = camera.height
        }
        const padding = cameraPadding(camera)
        const cameraKey = [camera.center.lat, camera.center.lon, camera.zoom, padding].join('/')
        if (cameraKey !== lastCameraKey) {
          lastCameraKey = cameraKey
          map.jumpTo({
            center: [camera.center.lon, camera.center.lat],
            zoom: camera.zoom - OVERLAY_ZOOM_OFFSET,
            bearing: 0,
            pitch: 0,
            padding: { top: 0, right: 0, bottom: padding, left: 0 },
          })
        }
        // Markers may have changed even with an identical camera. Deliver their
        // projection on the next canvas frame, never ahead of the basemap.
        map.triggerRepaint()
      } catch (error) {
        fail(toError(error, 'The vector map could not update.'))
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      if (loadTimeout !== undefined) clearTimeout(loadTimeout)
      if (!map) return
      map.off('load', handleLoad)
      map.off('render', handleRender)
      map.off('error', handleError)
      map.off('webglcontextlost', handleContextLost)
      map.off('style.load', handleStyleLoad)
      map.remove()
      map = undefined
    },
  }

  try {
    setWorkerUrl(workerUrl)
    map = new MapLibreMap({
      container,
      style: STYLE_URL,
      center: [initial.center.lon, initial.center.lat],
      zoom: initial.zoom - OVERLAY_ZOOM_OFFSET,
      minZoom: 4,
      maxZoom: 17,
      pitch: 0,
      maxPitch: 0,
      bearing: 0,
      interactive: false,
      attributionControl: false,
      maplibreLogo: false,
      pixelRatio: lastPixelRatio,
      renderWorldCopies: true,
    })
    map.on('load', handleLoad)
    map.on('render', handleRender)
    map.on('error', handleError)
    map.on('webglcontextlost', handleContextLost)
    map.on('style.load', handleStyleLoad)
    controller.update(initial)
    loadTimeout = setTimeout(() => {
      fail(new Error('The vector map did not finish loading in time.'))
    }, LOAD_TIMEOUT_MS)
  } catch (error) {
    if (map) {
      map.off('load', handleLoad)
      map.off('render', handleRender)
      map.off('error', handleError)
      map.off('webglcontextlost', handleContextLost)
      map.off('style.load', handleStyleLoad)
      try { map.remove() } catch { /* A partially initialized map may not be removable. */ }
      map = undefined
    }
    fail(toError(error, 'The vector map could not start.'))
  }

  return controller
}
