import './launch-screen.css'

export type LaunchLanguage = 'ru' | 'kk' | 'en'

export interface LaunchScreenController {
  dismiss(): void
  setLanguage(language: LaunchLanguage): void
}

interface LaunchScreenOptions {
  language: LaunchLanguage
  minimumMs?: number
  maximumMs?: number
}

const copy: Record<LaunchLanguage, { eyebrow: string; subtitle: string; status: string; skip: string }> = {
  ru: {
    eyebrow: 'АСТАНА · СВОЙ МАРШРУТ',
    subtitle: 'Город под ваше настроение',
    status: 'Открываем карту',
    skip: 'К карте',
  },
  kk: {
    eyebrow: 'АСТАНА · ӨЗ БАҒЫТЫҢЫЗ',
    subtitle: 'Қала — сіздің көңіл күйіңізге сай',
    status: 'Карта ашылып жатыр',
    skip: 'Картаға өту',
  },
  en: {
    eyebrow: 'ASTANA · YOUR ROUTE',
    subtitle: 'The city, your way',
    status: 'Opening the map',
    skip: 'Go to map',
  },
}

function duration(value: number | undefined, fallback: number, ceiling: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(ceiling, value))
    : fallback
}

/**
 * A short, dismissible launch layer. Call dismiss() once the initial interface is mounted.
 * The fallback timer and the skip button release the interface even if initialization fails.
 */
export function mountLaunchScreen(options: LaunchScreenOptions): LaunchScreenController {
  const maximumMs = duration(options.maximumMs, 2800, 5000)
  const minimumMs = Math.min(duration(options.minimumMs, 560, 1600), maximumMs)
  const startedAt = performance.now()
  // Reuse an optional first-paint shell from index.html, shown before the JS bundle loads.
  const screen = document.querySelector<HTMLDivElement>('#launch-screen') ?? document.createElement('div')
  screen.id = 'launch-screen'
  screen.className = 'launch-screen'
  screen.innerHTML = `
    <div class="launch-screen__top">
      <span class="launch-screen__eyebrow"></span>
      <span class="launch-screen__top-line" aria-hidden="true"></span>
    </div>
    <div class="launch-screen__center">
      <svg class="launch-screen__symbol" viewBox="0 0 144 144" fill="none" aria-hidden="true">
        <circle class="launch-screen__symbol-ring" cx="72" cy="72" r="67" />
        <path class="launch-screen__symbol-route" d="M33 99C44 99 42 53 67 53C80 53 82 86 102 77C110 73 111 58 111 46" />
        <circle class="launch-screen__symbol-start" cx="33" cy="99" r="5" />
        <circle class="launch-screen__symbol-end-halo" cx="111" cy="46" r="11" />
        <circle class="launch-screen__symbol-end" cx="111" cy="46" r="5" />
      </svg>
      <div class="launch-screen__wordmark" aria-label="рядом">рядом<span>.</span></div>
      <p class="launch-screen__subtitle"></p>
    </div>
    <div class="launch-screen__bottom">
      <div class="launch-screen__progress" aria-hidden="true"><span></span></div>
      <div class="launch-screen__bottom-line">
        <span class="launch-screen__status" role="status" aria-live="polite"></span>
        <button class="launch-screen__skip" type="button"></button>
      </div>
    </div>
  `

  const eyebrow = screen.querySelector<HTMLElement>('.launch-screen__eyebrow')!
  const subtitle = screen.querySelector<HTMLElement>('.launch-screen__subtitle')!
  const status = screen.querySelector<HTMLElement>('.launch-screen__status')!
  const skip = screen.querySelector<HTMLButtonElement>('.launch-screen__skip')!
  let removed = false
  let dismissQueued = false
  let minimumTimer = 0
  let exitTimer = 0
  let fallbackTimer = 0

  function setLanguage(language: LaunchLanguage): void {
    if (removed) return
    const next = copy[language]
    eyebrow.textContent = next.eyebrow
    subtitle.textContent = next.subtitle
    status.textContent = next.status
    skip.textContent = next.skip
    skip.setAttribute('aria-label', next.skip)
  }

  function remove(): void {
    if (removed) return
    removed = true
    window.clearTimeout(minimumTimer)
    window.clearTimeout(exitTimer)
    window.clearTimeout(fallbackTimer)
    screen.remove()
  }

  function beginExit(): void {
    if (removed || screen.classList.contains('is-leaving')) return
    screen.classList.add('is-leaving')
    // Release hit testing immediately. The visual exit can finish without blocking the map.
    screen.style.pointerEvents = 'none'
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) remove()
    else exitTimer = window.setTimeout(remove, 300)
  }

  function dismiss(): void {
    if (removed || dismissQueued) return
    dismissQueued = true
    const remaining = Math.max(0, minimumMs - (performance.now() - startedAt))
    if (remaining === 0) beginExit()
    else minimumTimer = window.setTimeout(beginExit, remaining)
  }

  setLanguage(options.language)
  skip.addEventListener('click', () => { skip.blur(); beginExit() })
  document.body.appendChild(screen)
  fallbackTimer = window.setTimeout(beginExit, maximumMs)

  return { dismiss, setLanguage }
}
