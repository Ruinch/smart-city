import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountVectorBasemap, type VectorBasemapCamera } from './vector-basemap'

const mocked = vi.hoisted(() => {
  type Listener = (event?: unknown) => void

  class FakeGPUInitializationError extends Error {}

  class FakeMap {
    static instances: FakeMap[] = []
    static failConstruction = false

    options: Record<string, unknown>
    listeners = new globalThis.Map<string, Set<Listener>>()
    jumps: Record<string, unknown>[] = []
    layoutChanges: { id: string; property: string; value: unknown }[] = []
    pixelRatios: number[] = []
    renderedFeatures: unknown[] = [{ type: 'Feature' }]
    resizeCount = 0
    removed = false

    constructor(options: Record<string, unknown>) {
      if (FakeMap.failConstruction) throw new FakeGPUInitializationError('WebGL2 unavailable')
      this.options = options
      FakeMap.instances.push(this)
    }

    on(type: string, listener: Listener): this {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type)?.add(listener)
      return this
    }

    off(type: string, listener: Listener): this {
      this.listeners.get(type)?.delete(listener)
      return this
    }

    emit(type: string, event?: unknown): void {
      for (const listener of this.listeners.get(type) ?? []) listener(event)
    }

    jumpTo(camera: Record<string, unknown>): this {
      this.jumps.push(camera)
      return this
    }

    resize(): this {
      this.resizeCount += 1
      return this
    }

    setPixelRatio(ratio: number): void {
      this.pixelRatios.push(ratio)
    }

    getStyle(): { layers: Record<string, unknown>[] } {
      return {
        layers: [
          { id: 'city', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
          { id: 'road-shield', type: 'symbol', layout: { 'text-field': ['get', 'ref'] } },
        ],
      }
    }

    queryRenderedFeatures(): unknown[] {
      return this.renderedFeatures
    }

    setLayoutProperty(id: string, property: string, value: unknown): this {
      this.layoutChanges.push({ id, property, value })
      return this
    }

    remove(): void {
      this.removed = true
    }
  }

  const workerUrls: string[] = []
  return { FakeMap, FakeGPUInitializationError, workerUrls }
})

vi.mock('maplibre-gl', () => ({
  Map: mocked.FakeMap,
  GPUInitializationError: mocked.FakeGPUInitializationError,
  setWorkerUrl: (url: string) => mocked.workerUrls.push(url),
}))

vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({
  default: '/assets/fake-map-worker.mjs',
}))

const initialCamera: VectorBasemapCamera = {
  center: { lat: 51.1694, lon: 71.4491 },
  zoom: 15,
  width: 400,
  height: 800,
  bottomInset: 200,
  language: 'ru',
}

const container = {} as HTMLElement

beforeEach(() => {
  mocked.FakeMap.instances.length = 0
  mocked.FakeMap.failConstruction = false
  mocked.workerUrls.length = 0
  vi.stubGlobal('window', { devicePixelRatio: 3 })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('vector basemap adapter', () => {
  it('aligns the vector camera and retains native high-DPI rendering', async () => {
    const onReady = vi.fn()
    const onFailure = vi.fn()
    const controller = mountVectorBasemap(container, initialCamera, { onReady, onFailure })
    const map = mocked.FakeMap.instances[0]

    expect(mocked.workerUrls).toEqual(['/assets/fake-map-worker.mjs'])
    expect(map.options).toMatchObject({
      style: 'https://tiles.openfreemap.org/styles/positron',
      interactive: false,
      attributionControl: false,
      pixelRatio: 3,
      maxZoom: 17,
    })
    expect(map.jumps[0]).toMatchObject({
      center: [71.4491, 51.1694],
      zoom: 14,
      padding: { top: 0, right: 0, bottom: 200, left: 0 },
    })
    expect(map.resizeCount).toBe(1)

    map.emit('style.load')
    expect(map.layoutChanges).toHaveLength(1)
    expect(map.layoutChanges[0].id).toBe('city')
    expect(JSON.stringify(map.layoutChanges[0].value)).toContain('name:ru')
    map.emit('load')
    await Promise.resolve()
    expect(onReady).toHaveBeenCalledOnce()

    controller.update({ ...initialCamera, language: 'kk' })
    expect(map.layoutChanges).toHaveLength(2)
    expect(JSON.stringify(map.layoutChanges[1].value)).toContain('name:kk')
    expect(map.jumps).toHaveLength(1)

    window.devicePixelRatio = 2
    controller.update({ ...initialCamera, width: 420, language: 'kk' })
    expect(map.pixelRatios).toEqual([2])
    expect(map.resizeCount).toBe(2)
    expect(onFailure).not.toHaveBeenCalled()
    controller.destroy()
    expect(map.removed).toBe(true)
  })

  it('reports constructor failure after returning a controller', async () => {
    mocked.FakeMap.failConstruction = true
    const onFailure = vi.fn()
    const controller = mountVectorBasemap(container, initialCamera, {
      onReady: vi.fn(), onFailure,
    })
    expect(onFailure).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure.mock.calls[0][0].message).toBe('WebGL2 unavailable')
    controller.destroy()
  })

  it('lets transient source errors recover and cancels the load timer on destroy', async () => {
    vi.useFakeTimers()
    const onReady = vi.fn()
    const onFailure = vi.fn()
    const controller = mountVectorBasemap(container, initialCamera, { onReady, onFailure })
    const map = mocked.FakeMap.instances[0]
    map.emit('error', { error: new Error('Temporary tile error') })
    await Promise.resolve()
    expect(onFailure).not.toHaveBeenCalled()
    map.emit('load')
    await Promise.resolve()
    expect(onReady).toHaveBeenCalledOnce()
    controller.destroy()
    await vi.advanceTimersByTimeAsync(12_001)
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('keeps raster visible until vector geometry actually renders', async () => {
    const onReady = vi.fn()
    const onFailure = vi.fn()
    const controller = mountVectorBasemap(container, initialCamera, { onReady, onFailure })
    const map = mocked.FakeMap.instances[0]
    map.renderedFeatures = []
    map.emit('load')
    await Promise.resolve()
    expect(onReady).not.toHaveBeenCalled()

    map.renderedFeatures = [{ type: 'Feature' }]
    map.emit('render')
    await Promise.resolve()
    expect(onReady).toHaveBeenCalledOnce()
    expect(map.listeners.get('render')?.size).toBe(0)
    expect(onFailure).not.toHaveBeenCalled()
    controller.destroy()
  })

  it('falls back when WebGL context is lost after loading', async () => {
    const onFailure = vi.fn()
    const controller = mountVectorBasemap(container, initialCamera, {
      onReady: vi.fn(), onFailure,
    })
    const map = mocked.FakeMap.instances[0]
    map.emit('load')
    map.emit('webglcontextlost')
    await Promise.resolve()
    expect(onFailure).toHaveBeenCalledOnce()
    controller.destroy()
  })
})
