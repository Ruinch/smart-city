import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { closeAnimatedDialog, openDialog } from './dialog-motion'

class FakeAnimation {
  onfinish: (() => void) | null = null
  cancelled = false

  cancel(): void { this.cancelled = true }
  finish(): void { this.onfinish?.() }
}

class FakeDialog extends EventTarget {
  open = false
  dataset: DOMStringMap = {} as DOMStringMap
  animations: FakeAnimation[] = []
  closes = 0
  showModal(): void { this.open = true }
  close(): void {
    this.open = false
    this.closes += 1
    this.dispatchEvent(new Event('close'))
  }
  animate(): Animation {
    const animation = new FakeAnimation()
    this.animations.push(animation)
    return animation as unknown as Animation
  }
  removeAttribute(name: string): void {
    if (name === 'data-motion') delete this.dataset.motion
  }
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('getComputedStyle', () => ({ opacity: '1', translate: 'none' }))
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
})

afterEach(() => vi.unstubAllGlobals())

test('keeps the modal open and focus-trapped until exit finishes', async () => {
  const fake = new FakeDialog()
  const dialog = fake as unknown as HTMLDialogElement
  openDialog(dialog)
  const closing = closeAnimatedDialog(dialog)

  expect(fake.open).toBe(true)
  expect(fake.closes).toBe(0)
  expect(closeAnimatedDialog(dialog)).toBe(closing)

  fake.animations.at(-1)?.finish()
  await closing
  expect(fake.open).toBe(false)
  expect(fake.closes).toBe(1)
})

test('reopen interrupts exit without a stale native close', async () => {
  const fake = new FakeDialog()
  const dialog = fake as unknown as HTMLDialogElement
  openDialog(dialog)
  const closing = closeAnimatedDialog(dialog)
  const staleExit = fake.animations.at(-1)!

  openDialog(dialog)
  await closing
  staleExit.finish() // A delayed finish callback must not close the reopened modal.

  expect(staleExit.cancelled).toBe(true)
  expect(fake.open).toBe(true)
  expect(fake.closes).toBe(0)
  expect(fake.dataset.motion).toBe('open')
})

test('reduced motion closes immediately', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const fake = new FakeDialog()
  const dialog = fake as unknown as HTMLDialogElement
  openDialog(dialog)
  await closeAnimatedDialog(dialog)

  expect(fake.animations).toHaveLength(0)
  expect(fake.closes).toBe(1)
})
