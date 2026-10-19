import type { Language, WalkRequest } from '../shared/types'

export function languageOf(request: Pick<WalkRequest, 'language'>): Language {
  return request.language === 'kk' || request.language === 'en' ? request.language : 'ru'
}

export function pick(language: Language, ru: string, kk: string, en: string): string {
  return language === 'kk' ? kk : language === 'en' ? en : ru
}

export function astanaName(language: Language): string {
  return language === 'en' ? 'Astana' : 'Астана'
}

export function placeName(place: { name: string; names?: { ru?: string; kk?: string; en?: string };
  tags?: Record<string, string> }, language: Language): string {
  const tagName = place.tags?.[`name:${language}`]
  return (place.names?.[language] || tagName || place.name).trim() || place.name
}

export function countPlaces(language: Language, count: number): string {
  if (language === 'en') return `${count} ${count === 1 ? 'place' : 'places'}`
  if (language === 'kk') return `${count} орын`
  return `${count} ${count === 1 ? 'место' : count < 5 ? 'места' : 'мест'}`
}

export function countStops(language: Language, count: number): string {
  if (language === 'en') return `${count} ${count === 1 ? 'stop' : 'stops'}`
  if (language === 'kk') return `${count} аялдама`
  return `${count} ${count === 1 ? 'остановка' : count < 5 ? 'остановки' : 'остановок'}`
}

export function countPeople(language: Language, count: number): string {
  if (language === 'en') return `${count} ${count === 1 ? 'person' : 'people'}`
  if (language === 'kk') return `${count} адамға`
  return `${count} ${count === 1 ? 'человека' : 'человек'}`
}
