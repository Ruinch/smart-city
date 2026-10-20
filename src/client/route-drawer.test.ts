import { describe, expect, it } from 'vitest'
import { drawerHeights, drawerSnap } from './route-drawer'

describe('route drawer snap points', () => {
  it('keeps a usable map strip, handle and ordered stops with safe areas', () => {
    const heights = drawerHeights(844, 44, 34)
    expect(heights.collapsed).toBe(98)
    expect(heights.half).toBeGreaterThan(heights.collapsed)
    expect(heights.expanded).toBe(728)
    expect(heights.half).toBeLessThan(heights.expanded)
  })
  it('stays within a very short viewport', () => {
    const heights = drawerHeights(150, 80, 34)
    expect(heights.collapsed).toBeLessThanOrEqual(heights.half)
    expect(heights.half).toBeLessThanOrEqual(heights.expanded)
    expect(heights.expanded).toBeLessThanOrEqual(150)
  })
  it('settles a slow drag at the nearest position', () => {
    const heights = drawerHeights(844)
    expect(drawerSnap(heights, 115, 0)).toBe('collapsed')
    expect(drawerSnap(heights, 470, .1)).toBe('half')
    expect(drawerSnap(heights, 720, -.1)).toBe('expanded')
  })
  it('follows a deliberate fling in either direction without overshooting', () => {
    const heights = drawerHeights(844)
    expect(drawerSnap(heights, 180, .8)).toBe('half')
    expect(drawerSnap(heights, 600, .8)).toBe('expanded')
    expect(drawerSnap(heights, 600, -.8)).toBe('half')
    expect(drawerSnap(heights, 280, -.8)).toBe('collapsed')
    expect(drawerSnap(heights, heights.expanded, 4)).toBe('expanded')
    expect(drawerSnap(heights, heights.collapsed, -4)).toBe('collapsed')
  })
})
