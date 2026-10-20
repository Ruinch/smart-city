import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mountDisclosure } from './disclosure-motion'

class FakeAnimation {
  onfinish: (() => void) | null = null
  cancelled = false
  cancel(): void { this.cancelled = true }
  finish(): void { this.onfinish?.() }
}

class FakeSummary extends EventTarget {
  tagName = 'SUMMARY'
  classList = { contains: () => false }
  click(): void { this.dispatchEvent(new Event('click', { cancelable: true })) }
}

class FakeBody {
  tagName = 'DIV'
  classList = { contains: (name: string) => name === 'place-details-body' }
  scrollHeight = 120
  animations: FakeAnimation[] = []
  getBoundingClientRect(): { height: number } { return { height: 120 } }
  animate(): Animation {
    const animation = new FakeAnimation()
    this.animations.push(animation)
    return animation as unknown as Animation
  }
}

class FakeDetails {
  open = false
  dataset: DOMStringMap = {} as DOMStringMap
  summary = new FakeSummary()
  body = new FakeBody()
  children = [this.summary, this.body]
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('getComputedStyle', () => ({ opacity: '1' }))
})
afterEach(() => vi.unstubAllGlobals())

test('keeps details open until the body exit completes', () => {
  const fake = new FakeDetails()
  mountDisclosure(fake as unknown as HTMLDetailsElement)

  fake.summary.click()
  fake.body.animations.at(-1)?.finish()
  fake.summary.click()

  expect(fake.open).toBe(true)
  expect(fake.dataset.disclosureMotion).toBe('closing')
  fake.body.animations.at(-1)?.finish()
  expect(fake.open).toBe(false)
})

test('a rapid second activation reverses closing and ignores stale finish', () => {
  const fake = new FakeDetails()
  mountDisclosure(fake as unknown as HTMLDetailsElement)
  fake.summary.click()
  fake.body.animations.at(-1)?.finish()
  fake.summary.click()
  const staleExit = fake.body.animations.at(-1)!

  fake.summary.click()
  staleExit.finish()

  expect(staleExit.cancelled).toBe(true)
  expect(fake.open).toBe(true)
  expect(fake.dataset.disclosureMotion).toBe('opening')
})

test('reduced motion toggles immediately without animations', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const fake = new FakeDetails()
  mountDisclosure(fake as unknown as HTMLDetailsElement)

  fake.summary.click()
  expect(fake.open).toBe(true)
  fake.summary.click()
  expect(fake.open).toBe(false)
  expect(fake.body.animations).toHaveLength(0)
})
