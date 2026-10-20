import type { LiveEvent, Recommendation, WalkRequest } from '../shared/types'
import { ASTANA_CENTER, insideAstana, insideTripPlanningArea } from '../shared/astana'
import { mountRecommendationsMap, type MapCoordinate, type RecommendationsMapController } from './map'
import { mountLaunchScreen } from './launch-screen'
import { openDialog, closeAnimatedDialog } from './dialog-motion'
import { mountDisclosure } from './disclosure-motion'
import { mountRouteDrawer, type RouteDrawerController, type DrawerPosition } from './route-drawer'
import { redesignCopy } from './redesign-copy'
import './style.css'
import './redesign.css'
import './motion.css'

interface TelegramLocation { latitude: number; longitude: number }
interface TelegramLocationManager {
  isLocationAvailable: boolean
  init(callback: () => void): void
  getLocation(callback: (location: TelegramLocation | null) => void): void
}
interface TelegramWebApp {
  viewportStableHeight?: number
  viewportHeight?: number
  safeAreaInset?: { top: number; bottom: number; left: number; right: number }
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number }
  BackButton?: { show(): void; hide(): void; onClick(callback: () => void): void }
  hideKeyboard?(): void
  initData: string
  initDataUnsafe?: { user?: { language_code?: string } }
  LocationManager?: TelegramLocationManager
  ready(): void
  expand(): void
  isVersionAtLeast?(version: string): boolean
  setHeaderColor?(color: string): void
  setBackgroundColor?(color: string): void
  setBottomBarColor?(color: string): void
  disableVerticalSwipes?(): void
  openLink?(url: string): void
  onEvent?(event: string, callback: (event?: { isStateStable?: boolean }) => void): void
}
declare global {
  interface Window { Telegram?: { WebApp: TelegramWebApp } }
}

type Scope = 'city' | 'day_trip'
type Transport = 'walk' | 'transit' | 'car'
type Mood = 'relax' | 'fun' | 'photo' | 'learn' | 'quiet' | 'unsure'
type SwapReason = 'far' | 'expensive' | 'visited' | 'other'
interface RoutePlan {
  title: string
  summary: string
  stops: Recommendation[]
  routeUrl?: string
  origin?: MapCoordinate & { name?: string }
  geometry?: MapCoordinate[]
  totalMinutesApprox?: number
  distanceKmApprox?: number
}
interface RouteResponse {
  summary: string
  routes?: RoutePlan[]
  events?: LiveEvent[]
  eventsStatus?: 'ok' | 'partial' | 'unavailable'
  note?: string
  headingAdjusted?: boolean
  replacementUnchanged?: boolean
}

const telegram = window.Telegram?.WebApp
const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing application root')

type Language = 'ru' | 'kk' | 'en'
const languageNames: Record<Language, string> = { ru: 'Русский', kk: 'Қазақша', en: 'English' }
const compassNames: Record<Language, readonly string[]> = {
  ru: ['севера', 'северо-востока', 'востока', 'юго-востока', 'юга', 'юго-запада', 'запада', 'северо-запада'],
  kk: ['солтүстікке', 'солтүстік-шығысқа', 'шығысқа', 'оңтүстік-шығысқа', 'оңтүстікке', 'оңтүстік-батысқа', 'батысқа', 'солтүстік-батысқа'],
  en: ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'],
}
const compassLabels: Record<Language, readonly string[]> = {
  ru: ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'],
  kk: ['солтүстік', 'солтүстік-шығыс', 'шығыс', 'оңтүстік-шығыс', 'оңтүстік', 'оңтүстік-батыс', 'батыс', 'солтүстік-батыс'],
  en: compassNames.en,
}
const ruMessages = {
  skip: 'К содержимому', mapRegion: 'Карта Астаны и маршрута', map: 'Карта Астаны', brand: 'Рядом — маршруты из Астаны', astana: 'Астана', mapActions: 'Управление картой', recenter: 'Показать начало маршрута', fit: 'Показать весь маршрут', osm: '© участники OpenStreetMap', license: 'Лицензия', data: 'О данных', planner: 'Планировщик маршрута', expandPanel: 'Развернуть панель', collapsePanel: 'Свернуть панель', expandRoute: 'Развернуть маршрут', collapseRoute: 'Свернуть маршрут', heading: 'Куда хочется?', subtitle: 'Расскажите, какой вечер или прогулку вы задумали.', backRoute: '← К маршруту', interest: 'Что вам интересно', promptHint: 'Опишите настроение, места и детали своими словами.', promptPlaceholder: 'Например, тихое кафе с книгой или танцы до ночи', examples: 'Примеры запросов', exampleClub: 'Клуб и танцы', exampleClubPrompt: 'Хочу в клуб: музыка, танцы и движная ночь', exampleCoffee: 'Кофе и книга', exampleCoffeePrompt: 'Тихое кафе, где можно попить кофе и почитать книгу', exampleFriends: 'С друзьями', exampleFriendsPrompt: 'Прогулка с друзьями по интересным местам Астаны', where: 'Где искать', whereRoute: 'Где искать маршрут', inAstana: 'В Астане', fromCity: 'Поездка из города', duration: 'Сколько времени есть', durationAria: 'Время вместе с дорогой', transport: 'Как доберётесь', transportAria: 'Способ передвижения', budget: 'Бюджет на человека, ₸', noLimit: 'Без ограничения', budgetHint: 'Цены многих мест неизвестны. 0 ₸ уберёт кафе, клубы и магазины, но бесплатность оставшихся мест не проверена.', group: 'Сколько вас будет', groupHint: 'От 1 до 12 человек.', locationButton: 'Взять мою геопозицию', locationDefault: 'Без геопозиции начнём от центра Астаны.', submit: 'Составить маршрут', readyRoute: 'Готовый маршрут', language: 'Язык интерфейса', fromAstana: 'Из Астаны', allDay: 'Весь день', walk: 'Пешком', transit: 'Транспорт', car: 'На машине', walkLower: 'пешком', transitLower: 'на транспорте', carLower: 'на машине', perPerson: 'на чел.', personOne: 'человек', personMany: 'чел.', stopsOne: 'остановка', stopsFew: 'остановки', stopsMany: 'остановок', hoursShort: 'ч', minutesShort: 'мин', tripTransportHint: 'Для поездок из Астаны пока доступна машина. Время дороги, расходы и часы работы проверьте перед выездом.', walkTransportHint: 'Время пешком ориентировочное. Часы работы и условия места проверьте перед выходом.', otherTransportHint: 'Время на выбранном транспорте может быть неизвестно. Проверьте дорогу во внешней карте.', locationLoading: 'Запрашиваем геопозицию…', locationUnavailable: 'Геопозиция недоступна. Начнём от центра Астаны.', locationDenied: 'Доступ к геопозиции не получен. Начнём от центра Астаны.', locationFar: 'Вы далеко от Астаны. Начнём маршрут от центра города.', locationFound: 'Начнём маршрут от вашей геопозиции.', promptError: 'Опишите, какой маршрут вам нужен, хотя бы в нескольких словах.', groupError: 'Укажите число от 1 до 12.', budgetError: 'Укажите сумму от 0 до 10 000 000 ₸ или оставьте поле пустым.', loadingRoute: 'Ищем маршрут…', searchingPlaces: 'Ищем подходящие места', searchDescription: 'Проверяем реальные места и собираем маршрут. Это может занять до минуты.', routeNotReady: 'Маршрут пока не готов', edit: 'Изменить запрос', entry: 'Вход', averageBill: 'Средний чек', oneItem: 'Одна позиция', fromPrice: 'от {amount}', checked: 'Проверено {date}', priceSource: 'Источник цены ↗', itemPriceNote: 'Цена одной позиции, не всего посещения.', entryOverBudget: 'Указанная цена билета выше вашего бюджета на человека.', billOverBudget: 'Опубликованный средний чек выше вашего бюджета на человека.', trip: 'Поездка', stop: 'Остановка', place: 'Место', source: 'Источник ↗', onMap: 'На карте ↗', travelApprox: '≈ {time} {mode}', onSiteApprox: '≈ {time} на месте', unknownTravel: 'Время дороги неизвестно', roadCost: 'Расходы на дорогу ≈ {min}–{max}', unknownCost: 'Стоимость посещения неизвестна', whatToDo: 'Что здесь сделать', aiCaveat: 'Идея создана ИИ; детали места проверьте перед выходом.', evidence: 'Подробности в источниках', directions: 'Маршрут до места ↗', osmWebsite: 'Сайт из OSM ↗', placeSource: 'Источник места ↗', timeSource: 'Источник времени ↗', costSource: 'Источник стоимости ↗', noPlaces: 'По вашему запросу пока не нашлось подтверждённых мест. Попробуйте описать интересы иначе или выделить больше времени.', cityRoute: 'Маршрут по Астане', astanaTrip: 'Поездка из Астаны', yourRoute: 'Ваш маршрут', walkAndStops: '≈ {time} пешком и на местах', openRoute: 'Открыть весь маршрут ↗', tripVariants: 'Варианты поездки', routeVariants: 'Варианты маршрута', route: 'Маршрут', variant: 'Вариант', roadLine: 'Линия показывает рассчитанный путь. Перед дорогой проверьте его во внешней карте.', dottedLine: 'Пунктир показывает порядок остановок, а не дорогу по улицам. Точный путь откройте во внешней карте.', stopsOrder: 'Остановки по порядку', moreIdeas: 'Ещё идеи →', openInTelegram: 'Откройте приложение через бота в Telegram и попробуйте снова.', loadingMore: 'Ищем ещё…', searchingIdeas: 'Ищем идеи…', otherPlaces: 'Ищем другие места по тем же условиям.', telegramExpired: 'Сессия Telegram устарела. Откройте приложение через бота заново.', rateLimit: 'Слишком много запросов. Подождите немного и попробуйте снова.', newIdeasError: 'Не удалось найти новые идеи. Попробуйте чуть позже.', incomplete: 'Ответ сервера неполный. Попробуйте ещё раз.', noNewPlaces: 'Новых мест пока не нашлось. Попробуйте изменить запрос или параметры.', searchTimeoutShort: 'Поиск занял слишком много времени. Попробуйте ещё раз.', newIdeasRetry: 'Не удалось найти новые идеи. Попробуйте ещё раз.', telegramRequired: 'Для составления маршрута откройте приложение через бота в Telegram. Так мы сможем безопасно обработать ваш запрос.', telegramInvalid: 'Не удалось подтвердить запуск в Telegram. Полностью закройте окно приложения и откройте его снова через @smart_city_ryadombot.', serviceError: 'Сервис временно недоступен. Попробуйте ещё раз через несколько секунд.', searchTimeout: 'Поиск занял слишком много времени. Проверьте соединение и попробуйте ещё раз.', unknownError: 'Произошла ошибка. Попробуйте ещё раз.', languageChange: 'Язык изменён. Составьте маршрут заново, чтобы описание тоже было на новом языке.',
  startTitle: 'Откуда начнём?',
  startCenter: 'Центр Астаны',
  startDevice: 'Моя геопозиция',
  startMap: 'Указать на карте',
  startMapSelected: 'Точка на карте',
  noRouteCoverage: 'По доступным данным пока не удалось собрать маршрут с выбранными условиями. Это не значит, что подходящих мест нет.',
  noRouteTargetHint: 'Ориентир сужает поиск. Уберите его, чтобы посмотреть варианты в других местах.',
  noRouteGeneralHint: 'Попробуйте увеличить время, изменить бюджет или описать желание чуть шире.',
  noRouteAccessibilityHint: 'При фильтре доступности мы показываем только места с подтверждённой отметкой. Отсутствие отметки не означает, что место недоступно.',
  retryWithoutTarget: 'Искать без ориентира',
  routeAdjusted: 'Ориентир учтён как пожелание. Эти места лучше подходят вашему запросу и времени, но маршрут может идти в другую сторону.',
  startCancel: 'Отменить выбор',
  openPlanner: 'Открыть поиск',
  showMap: 'Показать карту',
  keyboardDone: 'Готово',
  startReset: 'Сбросить',
  startCenterStatus: 'По умолчанию — центр Астаны.',
  startDeviceFound: 'Стартуем от вашей геопозиции.',
  startMapFound: 'Стартуем от выбранной точки.',
  startPickInstruction: 'Коснитесь карты, чтобы выбрать старт. Карту можно двигать.',
  startOutside: 'Точка за пределами Астаны. Выберите место в городе.',
  startUnavailable: 'Геопозиция недоступна. Выберите точку на карте.',
  startDenied: 'Доступ к геопозиции не получен. Выберите точку на карте.',
  startLoading: 'Определяем геопозицию…',
  targetTitle: 'В какую сторону?',
  targetAny: 'Любое направление',
  targetMap: 'Выбрать на карте',
  targetCancel: 'Отменить выбор',
  targetHint: 'Укажите примерную область. Конкретные места подберём по вашему запросу.',
  targetSelectedHint: 'Это ориентир, а не точный финиш маршрута.',
  targetPickInstruction: 'Коснитесь карты в той стороне, куда хотите отправиться. Карту можно двигать.',
  targetOutside: 'Для прогулки выберите точку в Астане.',
  targetFar: 'Для поездки выберите область не дальше 350 км от Астаны.',
  targetNear: 'Рядом со стартом',
  targetToward: 'В сторону {direction}',
  targetTowardCenter: 'Центр → {direction}',
  targetNearCenter: 'Рядом с центром',
  targetDistance: '≈ {distance} км по прямой',
  targetCenterCaveat: 'Если в запросе указан другой старт, маршрут пойдёт от него.',
  routeDirectionTitle: 'Куда ведёт маршрут',
  routeDirectionHint: 'Реальную дорогу проверьте на карте.',
  routeDirectionNear: 'Последняя остановка рядом со стартом.',
  durationScaleHint: 'Пеший путь оценочный; время дороги на транспорте может быть неизвестно.',
  accessibleTitle: 'Доступность мест',
  wheelchairLabel: 'Нужен доступ для коляски',
  wheelchairHint: 'Покажем только места с отметкой wheelchair=yes в OpenStreetMap. Путь между ними не проверен.',
  wheelchairTripHint: 'Для поездок из города таких подтверждённых данных пока нет — маршрут может не найтись.',
  shortLegsLabel: 'Короткие переходы · до ≈10 мин',
  shortLegsHint: 'Оценка пешком между каждой парой остановок и от старта. Доступно для прогулки по Астане.',
  shortLegsUnavailable: 'Короткие пешие переходы доступны только для маршрута по Астане пешком.',
  gentleLabel: 'Без спешки · до 2 мест',
  gentleHint: 'Меньше переходов и больше времени на каждой остановке. Наличие мест для отдыха и туалетов неизвестно.',
  gentleUnavailable: 'Неспешный сценарий доступен только для маршрутов по Астане.',
  specialTitle: 'Особый маршрут',
  questLabel: 'Микроприключение',
  questHint: 'Несколько разных реальных мест и маленькое задание в каждом. Без слежения за перемещением.',
  questUnavailable: 'Микроприключение доступно для маршрутов по Астане.',
  wheelchairBadgeYes: 'OSM: доступ для коляски — да',
  wheelchairBadgeLimited: 'OSM: доступ для коляски — частично',
  wheelchairBadgeNo: 'OSM: доступ для коляски — нет',
  accessibilityResultTitle: 'Что известно о доступности',
  accessibilityResultNote: 'Отметка OSM относится к месту. Тротуары, бордюры и вход на всём пути не проверены. Перед выходом уточните условия у места.',
  accessibilityMap: 'Свериться с картой доступности Казахстана ↗',
  questResultTitle: 'Микроприключение',
  questSource: 'Идея приложения',
  questFirst: 'Заметьте одну деталь этого места: звук, цвет, фактуру или настроение.',
  questMiddle: 'Сравните с прошлой остановкой: что здесь ощущается иначе?',
  questLast: 'Выберите любимую точку маршрута и расскажите, почему она запомнилась.',
  questProgress: 'Выполнено {done} из {total}',
  questMark: 'Отметить выполненным',
  questDone: 'Выполнено ✓',
  wheelchairSummary: 'коляска',
  shortLegsSummary: 'короткие переходы',
  gentleSummary: 'без спешки',
  questSummary: 'микроприключение',
  moodTitle: 'Под настроение', moodRelax: 'Расслабиться', moodFun: 'Развлечься', moodPhoto: 'Пофотографироваться', moodLearn: 'Узнать новое', moodQuiet: 'Побыть в тишине', moodUnsure: 'Не знаю',
  surprise: 'Удиви меня', surpriseHint: 'Необычное место рядом с учётом вашего времени и настроек', loadingSurprise: 'Ищем сюрприз…',
  swap: 'Заменить точку', swapReasons: 'Почему заменить?', swapFar: 'Слишком далеко', swapExpensive: 'Дорого', swapVisited: 'Уже был', swapOther: 'Хочу другое', swapping: 'Ищем другую точку…', swapNoAlternative: 'Подходящей замены пока нет. Эта точка осталась в маршруте.', swapError: 'Не удалось заменить точку. Маршрут не изменился.', swapSuccess: 'Точка заменена. Остальные остановки сохранены.',
} as const
type MessageKey = keyof typeof ruMessages
const messages: Record<Language, Record<MessageKey, string>> = {
  ru: ruMessages,
  kk: {
    skip: 'Мазмұнға өту', mapRegion: 'Астана картасы мен бағыты', map: 'Астана картасы', brand: 'Рядом — Астанадан басталатын бағыттар', astana: 'Астана', mapActions: 'Картаны басқару', recenter: 'Бағыттың басын көрсету', fit: 'Бүкіл бағытты көрсету', osm: '© OpenStreetMap қатысушылары', license: 'Лицензия', data: 'Деректер туралы', planner: 'Бағыт жоспарлаушысы', expandPanel: 'Панельді ашу', collapsePanel: 'Панельді жинау', expandRoute: 'Бағытты ашу', collapseRoute: 'Бағытты жинау', heading: 'Қайда барғыңыз келеді?', subtitle: 'Қандай серуен немесе кеш қалайтыныңызды айтыңыз.', backRoute: '← Бағытқа оралу', interest: 'Сізді не қызықтырады?', promptHint: 'Көңіл күйіңізді, орындар мен маңызды жайттарды өз сөзіңізбен жазыңыз.', promptPlaceholder: 'Мысалы, кітап оқитын тыныш кафе немесе түнгі би', examples: 'Сұрау мысалдары', exampleClub: 'Клуб пен би', exampleClubPrompt: 'Музыка, би және қызықты түнгі клуб іздеймін', exampleCoffee: 'Кофе мен кітап', exampleCoffeePrompt: 'Кофе ішіп, кітап оқуға болатын тыныш кафе іздеймін', exampleFriends: 'Достармен', exampleFriendsPrompt: 'Достарыммен Астананың қызықты жерлерін аралағым келеді', where: 'Қайдан іздейміз?', whereRoute: 'Бағытты қайдан іздейміз?', inAstana: 'Астанада', fromCity: 'Қаладан сапар', duration: 'Қанша уақытыңыз бар?', durationAria: 'Жолды қоса есептегендегі уақыт', transport: 'Қалай барасыз?', transportAria: 'Қозғалыс тәсілі', budget: 'Бір адамға бюджет, ₸', noLimit: 'Шектеусіз', budgetHint: 'Көп орындардың бағасы белгісіз. 0 ₸ кафе, клуб және дүкендерді алып тастайды, бірақ қалған орындардың тегін екені тексерілмеген.', group: 'Неше адам боласыздар?', groupHint: '1–12 адам.', locationButton: 'Геолокациямды пайдалану', locationDefault: 'Геолокациясыз Астана орталығынан бастаймыз.', submit: 'Бағыт құру', readyRoute: 'Дайын бағыт', language: 'Интерфейс тілі', fromAstana: 'Астанадан', allDay: 'Күні бойы', walk: 'Жаяу', transit: 'Қоғамдық көлік', car: 'Көлікпен', walkLower: 'жаяу', transitLower: 'қоғамдық көлікпен', carLower: 'көлікпен', perPerson: 'әр адамға', personOne: 'адам', personMany: 'адам', stopsOne: 'аялдама', stopsFew: 'аялдама', stopsMany: 'аялдама', hoursShort: 'сағ', minutesShort: 'мин', tripTransportHint: 'Астанадан сапарға әзірге тек көлік қолжетімді. Жол уақытын, шығынды және жұмыс сағатын шығар алдында тексеріңіз.', walkTransportHint: 'Жаяу жүру уақыты шамамен берілген. Шығар алдында жұмыс сағаты мен шарттарын тексеріңіз.', otherTransportHint: 'Таңдалған көлікпен жүру уақыты белгісіз болуы мүмкін. Жолды сыртқы картадан тексеріңіз.', locationLoading: 'Геолокация сұралып жатыр…', locationUnavailable: 'Геолокация қолжетімсіз. Астана орталығынан бастаймыз.', locationDenied: 'Геолокацияға рұқсат берілмеді. Астана орталығынан бастаймыз.', locationFar: 'Сіз Астанадан алыстасыз. Бағытты қала орталығынан бастаймыз.', locationFound: 'Бағытты сіз тұрған жерден бастаймыз.', promptError: 'Қандай бағыт керек екенін бірнеше сөзбен жазыңыз.', groupError: '1 мен 12 арасындағы санды көрсетіңіз.', budgetError: '0 мен 10 000 000 ₸ арасындағы соманы жазыңыз немесе өрісті бос қалдырыңыз.', loadingRoute: 'Бағыт ізделуде…', searchingPlaces: 'Лайықты орындар ізделуде', searchDescription: 'Нақты орындарды тексеріп, бағыт құрастырып жатырмыз. Бұл бір минутқа дейін созылуы мүмкін.', routeNotReady: 'Бағыт әзірге дайын емес', edit: 'Сұрауды өзгерту', entry: 'Кіру ақысы', averageBill: 'Орташа чек', oneItem: 'Бір өнім', fromPrice: '{amount} бастап', checked: '{date} тексерілді', priceSource: 'Баға дереккөзі ↗', itemPriceNote: 'Бұл бүкіл сапардың емес, бір өнімнің бағасы.', entryOverBudget: 'Көрсетілген билет бағасы бір адамға арналған бюджеттен жоғары.', billOverBudget: 'Жарияланған орташа чек бір адамға арналған бюджеттен жоғары.', trip: 'Сапар', stop: 'Аялдама', place: 'Орын', source: 'Дереккөз ↗', onMap: 'Картада ↗', travelApprox: '≈ {time} {mode}', onSiteApprox: '≈ {time} орында', unknownTravel: 'Жол уақыты белгісіз', roadCost: 'Жол шығыны ≈ {min}–{max}', unknownCost: 'Барудың бағасы белгісіз', whatToDo: 'Мұнда не істеуге болады?', aiCaveat: 'Ұсынысты ЖИ жасады; барар алдында орын туралы мәліметті тексеріңіз.', evidence: 'Дереккөздердегі мәлімет', directions: 'Орынға баратын жол ↗', osmWebsite: 'OSM сайт сілтемесі ↗', placeSource: 'Орын дереккөзі ↗', timeSource: 'Уақыт дереккөзі ↗', costSource: 'Баға дереккөзі ↗', noPlaces: 'Сұрауыңызға сай расталған орындар табылмады. Қызығушылығыңызды басқаша сипаттап немесе көбірек уақыт бөліп көріңіз.', cityRoute: 'Астана бағыты', astanaTrip: 'Астанадан сапар', yourRoute: 'Сіздің бағытыңыз', walkAndStops: '≈ {time} жаяу жүріп және орындарда', openRoute: 'Бүкіл бағытты ашу ↗', tripVariants: 'Сапар нұсқалары', routeVariants: 'Бағыт нұсқалары', route: 'Бағыт', variant: 'Нұсқа', roadLine: 'Сызық есептелген жолды көрсетеді. Сапар алдында оны сыртқы картадан тексеріңіз.', dottedLine: 'Үзік сызық аялдамалардың ретін көрсетеді, көшедегі жолды емес. Нақты жолды сыртқы картадан ашыңыз.', stopsOrder: 'Аялдамалар ретімен', moreIdeas: 'Басқа идеялар →', openInTelegram: 'Қолданбаны Telegram-дағы бот арқылы ашып, қайталап көріңіз.', loadingMore: 'Тағы ізделуде…', searchingIdeas: 'Идеялар ізделуде…', otherPlaces: 'Сол шарттармен басқа орындарды іздеп жатырмыз.', telegramExpired: 'Telegram сессиясының мерзімі өтті. Қолданбаны бот арқылы қайта ашыңыз.', rateLimit: 'Сұраулар тым көп. Сәл күтіп, қайталап көріңіз.', newIdeasError: 'Жаңа идеялар табылмады. Кейінірек қайталап көріңіз.', incomplete: 'Сервер жауабы толық емес. Қайталап көріңіз.', noNewPlaces: 'Әзірге жаңа орындар табылмады. Сұрауды немесе параметрлерді өзгертіңіз.', searchTimeoutShort: 'Іздеу тым ұзаққа созылды. Қайталап көріңіз.', newIdeasRetry: 'Жаңа идеялар табылмады. Қайталап көріңіз.', telegramRequired: 'Бағыт құру үшін қолданбаны Telegram-дағы бот арқылы ашыңыз. Осылайша сұрауыңызды қауіпсіз өңдей аламыз.', telegramInvalid: 'Telegram арқылы ашылғанын растау мүмкін болмады. Қолданбаны толық жауып, @smart_city_ryadombot арқылы қайта ашыңыз.', serviceError: 'Қызмет уақытша қолжетімсіз. Бірнеше секундтан кейін қайталап көріңіз.', searchTimeout: 'Іздеу тым ұзаққа созылды. Байланысты тексеріп, қайталап көріңіз.', unknownError: 'Қате пайда болды. Қайталап көріңіз.', languageChange: 'Тіл өзгерді. Сипаттама да жаңа тілде болуы үшін бағытты қайта құрыңыз.',
    startTitle: 'Қай жерден бастаймыз?',
    startCenter: 'Астана орталығы',
    startDevice: 'Менің геолокациям',
    startMap: 'Картадан көрсету',
    startMapSelected: 'Картадағы нүкте',
    noRouteCoverage: 'Қолда бар деректерден таңдалған шарттарға сай бағыт құра алмадық. Бұл лайықты орындар жоқ деген сөз емес.',
    noRouteTargetHint: 'Бағдар іздеуді тарылтады. Басқа жерлердегі нұсқаларды көру үшін оны алып тастаңыз.',
    noRouteGeneralHint: 'Уақытты көбейтіп, бюджетті өзгертіп немесе қалауыңызды кеңірек сипаттап көріңіз.',
    noRouteAccessibilityHint: 'Қолжетімділік сүзгісі тек расталған белгісі бар орындарды көрсетеді. Белгінің болмауы орын қолжетімсіз дегенді білдірмейді.',
    retryWithoutTarget: 'Бағдарсыз іздеу',
    routeAdjusted: 'Бағдар қалауыңыз ретінде ескерілді. Бұл орындар сұрауыңыз бен уақытыңызға жақсырақ сай келеді, бірақ бағыт басқа жаққа кетуі мүмкін.',
    startCancel: 'Таңдауды тоқтату',
    openPlanner: 'Іздеуді ашу',
    showMap: 'Картаны көрсету',
    keyboardDone: 'Дайын',
    startReset: 'Қалпына келтіру',
    startCenterStatus: 'Әдепкі бойынша Астана орталығынан бастаймыз.',
    startDeviceFound: 'Сіз тұрған жерден бастаймыз.',
    startMapFound: 'Картадан таңдалған жерден бастаймыз.',
    startPickInstruction: 'Бастау нүктесін таңдау үшін картаны түртіңіз. Картаны жылжытуға болады.',
    startOutside: 'Нүкте Астанадан тыс жерде. Қала ішіндегі орынды таңдаңыз.',
    startUnavailable: 'Геолокация қолжетімсіз. Картадан нүктені таңдаңыз.',
    startDenied: 'Геолокацияға рұқсат берілмеді. Картадан нүктені таңдаңыз.',
    startLoading: 'Геолокация анықталуда…',
    targetTitle: 'Қай бағытқа?',
    targetAny: 'Кез келген бағыт',
    targetMap: 'Картадан таңдау',
    targetCancel: 'Таңдауды тоқтату',
    targetHint: 'Шамамен қай аймаққа барғыңыз келетінін көрсетіңіз. Нақты орындарды сұрауыңызға сай таңдаймыз.',
    targetSelectedHint: 'Бұл бағдар ғана, бағыттың нақты соңғы нүктесі емес.',
    targetPickInstruction: 'Барғыңыз келетін бағыттағы картаны түртіңіз. Картаны жылжытуға болады.',
    targetOutside: 'Серуен үшін Астана ішіндегі нүктені таңдаңыз.',
    targetFar: 'Сапар үшін Астанадан 350 км-ден аспайтын аймақты таңдаңыз.',
    targetNear: 'Бастау нүктесіне жақын',
    targetToward: 'Бағыт: {direction}',
    targetTowardCenter: 'Орталық → {direction}',
    targetNearCenter: 'Орталыққа жақын',
    targetDistance: 'Түзу сызықпен ≈ {distance} км',
    targetCenterCaveat: 'Сұрауда басқа бастау нүктесі көрсетілсе, бағыт сол жерден басталады.',
    routeDirectionTitle: 'Бағыт қай жаққа апарады',
    routeDirectionHint: 'Нақты жолды картадан тексеріңіз.',
    routeDirectionNear: 'Соңғы аялдама бастау нүктесіне жақын.',
    durationScaleHint: 'Жаяу жол шамамен есептеледі; көлікпен жүру уақыты белгісіз болуы мүмкін.',
    accessibleTitle: 'Орындардың қолжетімділігі',
    wheelchairLabel: 'Арбамен кіру керек',
    wheelchairHint: 'OpenStreetMap картасында wheelchair=yes белгісі бар орындарды ғана көрсетеміз. Арадағы жол тексерілмеген.',
    wheelchairTripHint: 'Қала сыртындағы сапарлар үшін мұндай расталған дерек әзірге жоқ — бағыт табылмауы мүмкін.',
    shortLegsLabel: 'Қысқа өткелдер · ≈10 минутқа дейін',
    shortLegsHint: 'Бастапқы нүктеден және аялдамалар арасындағы жаяу уақыт шамамен есептеледі. Астана ішіндегі серуенге арналған.',
    shortLegsUnavailable: 'Қысқа жаяу өткелдер тек Астанада жаяу серуендеу үшін қолжетімді.',
    gentleLabel: 'Асықпай · 2 орынға дейін',
    gentleHint: 'Аралықтар аз, әр аялдамаға көбірек уақыт. Демалатын орындар мен дәретханалар туралы дерек жоқ.',
    gentleUnavailable: 'Асықпай серуендеу тек Астана ішіндегі бағыттарда қолжетімді.',
    specialTitle: 'Ерекше бағыт',
    questLabel: 'Шағын шытырман',
    questHint: 'Бірнеше түрлі нақты орын және әрқайсында шағын тапсырма. Қозғалысыңызды қадағаламаймыз.',
    questUnavailable: 'Шағын шытырман тек Астана ішіндегі бағыттарға арналған.',
    wheelchairBadgeYes: 'OSM: арбамен кіруге болады',
    wheelchairBadgeLimited: 'OSM: арбамен кіру ішінара',
    wheelchairBadgeNo: 'OSM: арбамен кіруге болмайды',
    accessibilityResultTitle: 'Қолжетімділік туралы не белгілі',
    accessibilityResultNote: 'OSM белгісі тек орынға қатысты. Жолдағы тротуарлар, жиектастар мен кіреберіс толық тексерілмеген. Бармас бұрын орыннан жағдайды нақтылаңыз.',
    accessibilityMap: 'Қазақстанның қолжетімділік картасын қарау (орысша) ↗',
    questResultTitle: 'Шағын шытырман',
    questSource: 'Қолданба идеясы',
    questFirst: 'Осы жердің бір ерекшелігін байқаңыз: дыбысын, түсін, бедерін немесе көңіл күйін.',
    questMiddle: 'Алдыңғы аялдамамен салыстырыңыз: мұнда не өзгеше сезіледі?',
    questLast: 'Бағыттағы сүйікті жеріңізді таңдап, неге есте қалғанын айтыңыз.',
    questProgress: '{total} ішінен {done} орындалды',
    questMark: 'Орындалды деп белгілеу',
    questDone: 'Орындалды ✓',
    wheelchairSummary: 'арбамен',
    shortLegsSummary: 'қысқа өткелдер',
    gentleSummary: 'асықпай',
    questSummary: 'шағын шытырман',
    moodTitle: 'Көңіл күйім', moodRelax: 'Демалғым келеді', moodFun: 'Көңіл көтеру', moodPhoto: 'Суретке түсу', moodLearn: 'Жаңа нәрсе білу', moodQuiet: 'Тыныштық', moodUnsure: 'Білмеймін',
    surprise: 'Мені таңғалдыр', surpriseHint: 'Уақытыңыз бен баптауларыңызға сай жақын маңдағы ерекше орын', loadingSurprise: 'Ерекше орын іздейміз…',
    swap: 'Орынды ауыстыру', swapReasons: 'Неге ауыстырамыз?', swapFar: 'Тым алыс', swapExpensive: 'Қымбат', swapVisited: 'Барып көрдім', swapOther: 'Басқасын қалаймын', swapping: 'Басқа орын іздейміз…', swapNoAlternative: 'Әзірге лайықты балама жоқ. Бұл орын бағытта қалды.', swapError: 'Орынды ауыстыру мүмкін болмады. Бағыт өзгерген жоқ.', swapSuccess: 'Орын ауыстырылды. Қалған аялдамалар сақталды.',
  },
  en: {
    skip: 'Skip to content', mapRegion: 'Astana map and route', map: 'Map of Astana', brand: 'Ryadom — routes from Astana', astana: 'Astana', mapActions: 'Map controls', recenter: 'Show route starting point', fit: 'Show full route', osm: '© OpenStreetMap contributors', license: 'License', data: 'About the data', planner: 'Route planner', expandPanel: 'Expand panel', collapsePanel: 'Collapse panel', expandRoute: 'Expand route', collapseRoute: 'Collapse route', heading: 'Where to?', subtitle: 'Tell us what kind of outing or evening you have in mind.', backRoute: '← Back to route', interest: 'What interests you?', promptHint: 'Describe the mood, places and details that matter to you.', promptPlaceholder: 'For example, a quiet café for reading or dancing all night', examples: 'Example requests', exampleClub: 'Clubs and dancing', exampleClubPrompt: 'I want a club with music, dancing and a lively night', exampleCoffee: 'Coffee and a book', exampleCoffeePrompt: 'A quiet café where I can drink coffee and read a book', exampleFriends: 'With friends', exampleFriendsPrompt: 'A walk with friends around interesting places in Astana', where: 'Search area', whereRoute: 'Where to look for a route', inAstana: 'In Astana', fromCity: 'Trip from the city', duration: 'Time available', durationAria: 'Time including travel', transport: 'How will you travel?', transportAria: 'Transport mode', budget: 'Budget per person, ₸', noLimit: 'No limit', budgetHint: 'Prices are unknown for many places. 0 ₸ excludes cafés, clubs and shops, but the remaining places have not been confirmed free.', group: 'How many people?', groupHint: 'Between 1 and 12 people.', locationButton: 'Use my location', locationDefault: 'Without your location, we start from central Astana.', submit: 'Build a route', readyRoute: 'Your route', language: 'Interface language', fromAstana: 'From Astana', allDay: 'All day', walk: 'Walk', transit: 'Public transport', car: 'Car', walkLower: 'on foot', transitLower: 'by public transport', carLower: 'by car', perPerson: 'per person', personOne: 'person', personMany: 'people', stopsOne: 'stop', stopsFew: 'stops', stopsMany: 'stops', hoursShort: 'h', minutesShort: 'min', tripTransportHint: 'Trips from Astana currently require a car. Check travel time, costs and opening hours before you leave.', walkTransportHint: 'Walking times are approximate. Check opening hours and venue conditions before leaving.', otherTransportHint: 'Travel time by your chosen transport may be unknown. Check directions in an external map.', locationLoading: 'Requesting location…', locationUnavailable: 'Location unavailable. We will start from central Astana.', locationDenied: 'Location access was not granted. We will start from central Astana.', locationFar: 'You are far from Astana. We will start from the city center.', locationFound: 'We will start from your location.', promptError: 'Describe the route you want in at least a few words.', groupError: 'Enter a number from 1 to 12.', budgetError: 'Enter an amount from 0 to 10,000,000 ₸ or leave the field empty.', loadingRoute: 'Finding a route…', searchingPlaces: 'Finding places that fit', searchDescription: 'We are checking real places and planning a route. This may take up to a minute.', routeNotReady: 'Route is not ready yet', edit: 'Edit request', entry: 'Admission', averageBill: 'Average bill', oneItem: 'One item', fromPrice: 'from {amount}', checked: 'Checked {date}', priceSource: 'Price source ↗', itemPriceNote: 'This is the price of one item, not the full visit.', entryOverBudget: 'The listed ticket price exceeds your budget per person.', billOverBudget: 'The published average bill exceeds your budget per person.', trip: 'Trip', stop: 'Stop', place: 'Place', source: 'Source ↗', onMap: 'On map ↗', travelApprox: '≈ {time} {mode}', onSiteApprox: '≈ {time} at this stop', unknownTravel: 'Travel time unknown', roadCost: 'Travel cost ≈ {min}–{max}', unknownCost: 'Visit cost unknown', whatToDo: 'What to do here', aiCaveat: 'This idea was generated by AI; check venue details before leaving.', evidence: 'Details in sources', directions: 'Directions to place ↗', osmWebsite: 'Website from OSM ↗', placeSource: 'Place source ↗', timeSource: 'Time source ↗', costSource: 'Cost source ↗', noPlaces: 'No verified places matched your request yet. Try describing your interests differently or allowing more time.', cityRoute: 'Route in Astana', astanaTrip: 'Trip from Astana', yourRoute: 'Your route', walkAndStops: '≈ {time} walking and at stops', openRoute: 'Open full route ↗', tripVariants: 'Trip options', routeVariants: 'Route options', route: 'Route', variant: 'Option', roadLine: 'The line shows a calculated route. Check it in an external map before traveling.', dottedLine: 'The dotted line shows stop order, not a street route. Open precise directions in an external map.', stopsOrder: 'Stops in order', moreIdeas: 'More ideas →', openInTelegram: 'Open this app through the Telegram bot and try again.', loadingMore: 'Finding more…', searchingIdeas: 'Finding ideas…', otherPlaces: 'Looking for different places with the same settings.', telegramExpired: 'Your Telegram session has expired. Reopen the app through the bot.', rateLimit: 'Too many requests. Wait a moment and try again.', newIdeasError: 'Could not find new ideas. Please try again later.', incomplete: 'The server response was incomplete. Please try again.', noNewPlaces: 'No new places found yet. Try changing your request or settings.', searchTimeoutShort: 'The search took too long. Please try again.', newIdeasRetry: 'Could not find new ideas. Please try again.', telegramRequired: 'To build a route, open the app through the Telegram bot. This lets us process your request securely.', telegramInvalid: 'Could not verify the Telegram launch. Close the app completely and reopen it through @smart_city_ryadombot.', serviceError: 'The service is temporarily unavailable. Please try again in a few seconds.', searchTimeout: 'The search took too long. Check your connection and try again.', unknownError: 'Something went wrong. Please try again.', languageChange: 'Language changed. Build the route again so its description uses the new language.',
    startTitle: 'Where do we start?',
    startCenter: 'Central Astana',
    startDevice: 'My location',
    startMap: 'Pick on map',
    startMapSelected: 'Map point',
    noRouteCoverage: 'We could not build a route from the available data under these settings. This does not mean suitable places do not exist.',
    noRouteTargetHint: 'The chosen direction narrows the search. Remove it to explore options elsewhere.',
    noRouteGeneralHint: 'Try allowing more time, changing your budget or describing your plans more broadly.',
    noRouteAccessibilityHint: 'The accessibility filter shows only places with a confirmed tag. A missing tag does not mean a place is inaccessible.',
    retryWithoutTarget: 'Search without direction',
    routeAdjusted: 'We treated your chosen direction as a preference. These places better match your request and time, but the route may go another way.',
    startCancel: 'Cancel selection',
    openPlanner: 'Open search',
    showMap: 'Show map',
    keyboardDone: 'Done',
    startReset: 'Reset',
    startCenterStatus: 'Starting from central Astana by default.',
    startDeviceFound: 'Starting from your location.',
    startMapFound: 'Starting from the selected map point.',
    startPickInstruction: 'Tap the map to choose a start. You can move the map first.',
    startOutside: 'This point is outside Astana. Choose a place in the city.',
    startUnavailable: 'Location unavailable. Pick a point on the map.',
    startDenied: 'Location access was not granted. Pick a point on the map.',
    startLoading: 'Finding your location…',
    targetTitle: 'Which direction?',
    targetAny: 'Anywhere',
    targetMap: 'Choose on map',
    targetCancel: 'Cancel selection',
    targetHint: 'Pick an approximate area. We will choose actual places based on your request.',
    targetSelectedHint: 'This is a guide, not an exact route endpoint.',
    targetPickInstruction: 'Tap the map in the direction you want to explore. You can move the map.',
    targetOutside: 'Choose a point in Astana for a city walk.',
    targetFar: 'Choose an area within 350 km of Astana for a trip.',
    targetNear: 'Near the starting point',
    targetToward: 'Towards {direction}',
    targetTowardCenter: 'Center → {direction}',
    targetNearCenter: 'Near the center',
    targetDistance: '≈ {distance} km in a straight line',
    targetCenterCaveat: 'If your request names another start, the route will begin there.',
    routeDirectionTitle: 'Where this route heads',
    routeDirectionHint: 'Check the actual road on the map.',
    routeDirectionNear: 'The final stop is near your starting point.',
    durationScaleHint: 'Walking time is approximate; travel time by transport may be unknown.',
    accessibleTitle: 'Venue accessibility',
    wheelchairLabel: 'Wheelchair access needed',
    wheelchairHint: 'Show only places tagged wheelchair=yes in OpenStreetMap. The route between them has not been checked.',
    wheelchairTripHint: 'There is no confirmed accessibility data for trips outside the city yet, so there may be no result.',
    shortLegsLabel: 'Short walking legs · up to ≈10 min',
    shortLegsHint: 'Approximate walk from the start and between each stop. Available for walks in Astana.',
    shortLegsUnavailable: 'Short walking legs are available only for walking routes in Astana.',
    gentleLabel: 'Easy pace · up to 2 stops',
    gentleHint: 'Fewer transfers and more time at each stop. Seating and toilets are unknown.',
    gentleUnavailable: 'Easy pace is available only for routes within Astana.',
    specialTitle: 'Special route',
    questLabel: 'Micro adventure',
    questHint: 'A few varied real places, each with a small prompt. No location tracking.',
    questUnavailable: 'Micro adventures are available for routes within Astana.',
    wheelchairBadgeYes: 'OSM: wheelchair access — yes',
    wheelchairBadgeLimited: 'OSM: wheelchair access — limited',
    wheelchairBadgeNo: 'OSM: wheelchair access — no',
    accessibilityResultTitle: 'What we know about access',
    accessibilityResultNote: 'The OSM tag describes the venue. Sidewalks, kerbs and the entrance along the route have not been checked. Confirm conditions with the venue before leaving.',
    accessibilityMap: 'Check Kazakhstan accessibility map (Russian) ↗',
    questResultTitle: 'Micro adventure',
    questSource: 'App idea',
    questFirst: 'Notice one detail here: a sound, colour, texture or mood.',
    questMiddle: 'Compare this with your last stop. What feels different?',
    questLast: 'Choose your favourite stop and say why it stayed with you.',
    questProgress: '{done} of {total} complete',
    questMark: 'Mark complete',
    questDone: 'Completed ✓',
    wheelchairSummary: 'wheelchair',
    shortLegsSummary: 'short legs',
    gentleSummary: 'easy pace',
    questSummary: 'micro adventure',
    moodTitle: 'Pick a mood', moodRelax: 'Unwind', moodFun: 'Have fun', moodPhoto: 'Take photos', moodLearn: 'Learn something', moodQuiet: 'Find quiet', moodUnsure: 'Not sure',
    surprise: 'Surprise me', surpriseHint: 'An unusual nearby place that fits your time and settings', loadingSurprise: 'Finding a surprise…',
    swap: 'Replace this stop', swapReasons: 'Why replace it?', swapFar: 'Too far', swapExpensive: 'Too expensive', swapVisited: 'Been there', swapOther: 'Something else', swapping: 'Finding another stop…', swapNoAlternative: 'No suitable replacement yet. This stop remains in the route.', swapError: 'Could not replace this stop. Your route is unchanged.', swapSuccess: 'Stop replaced. Other stops are unchanged.',
  },
}
function matchLanguage(value: string | undefined): Language | null {
  const base = value?.toLowerCase().split(/[-_]/)[0]
  return base === 'ru' || base === 'kk' || base === 'en' ? base : null
}
function initialLanguage(): Language {
  try {
    const saved = matchLanguage(localStorage.getItem('ryadom-language') ?? undefined)
    if (saved) return saved
  } catch { /* Storage may be blocked in an embedded browser. */ }
  return matchLanguage(telegram?.initDataUnsafe?.user?.language_code)
    ?? navigator.languages?.map(matchLanguage).find((value): value is Language => value !== null)
    ?? matchLanguage(navigator.language)
    ?? 'ru'
}
let language: Language = initialLanguage()
const launchScreen = mountLaunchScreen({ language })
document.documentElement.lang = language
function t(key: MessageKey, values: Record<string, string | number> = {}): string {
  return messages[language][key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] === undefined ? match : String(values[name]))
}

const moodSearchText: Record<Language, Record<Mood, string>> = {
  ru: { relax: 'Хочу расслабиться в приятном месте', fun: 'Хочу развлечься и весело провести время', photo: 'Хочу красивые необычные места для фотографий', learn: 'Хочу узнать что-то новое и интересное', quiet: 'Хочу побыть в тихом спокойном месте', unsure: 'Предложи интересное место или прогулку рядом' },
  kk: { relax: 'Жайлы жерде демалғым келеді', fun: 'Көңіл көтеріп, жақсы уақыт өткізгім келеді', photo: 'Суретке түсуге әдемі ерекше орындар іздеймін', learn: 'Жаңа әрі қызықты нәрсе білгім келеді', quiet: 'Тыныш жерде болғым келеді', unsure: 'Жақын маңда қызықты орын не серуен ұсын' },
  en: { relax: 'I want to unwind somewhere pleasant', fun: 'I want to have fun and do something lively', photo: 'I want unusual photogenic places', learn: 'I want to learn something new and interesting', quiet: 'I want a quiet peaceful place', unsure: 'Suggest an interesting nearby place or walk' },
}

const eventSearchText: Record<Language, string> = {
  ru: 'Интересные выставки, концерты, фестивали, спортивные или вечерние события в Астане',
  kk: 'Астанадағы көрмелер, концерттер, фестивальдер, спорт немесе кешкі іс-шаралар',
  en: 'Interesting exhibitions, concerts, festivals, sports or evening events in Astana',
}

const eventCopy: Record<Language, {
  toggle: string
  toggleHint: string
  summary: string
  heading: string
  intro: string
  noEvents: string
  noEventsFree: string
  noEventsAccessible: string
  noEventsPartial: string
  unavailable: string
  partial: string
  types: Record<LiveEvent['category'], string>
  venue: string
  source: string
  checked: string
  zone: string
  older: string
  noTime: string
  price: string
  priceUnknown: string
  availability: string
}> = {
  ru: {
    toggle: 'События и афиша', toggleHint: 'Покажем временные мероприятия с датой и источником. Они не входят в маршрут автоматически.', summary: 'события',
    heading: 'Афиша Астаны', intro: 'События показаны отдельно от маршрута: расстояние до площадки не рассчитано. Перед выходом проверьте расписание у организатора.',
    noEvents: 'Событий с подтверждённой датой по этому запросу пока не нашлось.',
    noEventsFree: 'Бесплатных событий с подтверждённой ценой по этому запросу пока не нашлось. Неизвестная цена не означает бесплатный вход.',
    noEventsAccessible: 'Событий с отдельно подтверждённой доступностью площадки для коляски пока не нашлось. Отсутствие данных не означает недоступность.',
    noEventsPartial: 'Часть источников сейчас недоступна. По проверенным источникам подходящие события пока не нашлись.',
    unavailable: 'Афиши временно недоступны. Попробуйте проверить события позже.',
    partial: 'Часть источников афиши сейчас недоступна.',
    types: { exhibition: 'Выставка', concert: 'Концерт', festival: 'Фестиваль', sport: 'Спорт', evening: 'Вечернее событие' },
    venue: 'Место: {name}', source: 'Источник: {name} ↗', checked: 'Сведения прочитаны {date}', zone: 'время Астаны',
    older: 'Источник проверялся более суток назад.', noTime: 'Время начала не указано в источнике.',
    price: 'Цена в источнике: {amount}', priceUnknown: 'Цена не подтверждена.',
    availability: 'Наличие билетов и изменения программы проверьте у организатора.',
  },
  kk: {
    toggle: 'Іс-шаралар афишасы', toggleHint: 'Күні мен дереккөзі белгілі уақытша іс-шаралар көрсетіледі. Олар бағытқа автоматты түрде қосылмайды.', summary: 'іс-шаралар',
    heading: 'Астанадағы іс-шаралар', intro: 'Іс-шаралар бағыттан бөлек көрсетіледі: өтетін жерге дейінгі қашықтық есептелмеген. Шығар алдында кестені ұйымдастырушыдан тексеріңіз.',
    noEvents: 'Бұл сұрауға сай күні расталған іс-шаралар әзірге табылмады.',
    noEventsFree: 'Бұл сұрауға сай бағасы расталған тегін іс-шаралар табылмады. Белгісіз баға тегін кіруді білдірмейді.',
    noEventsAccessible: 'Арбаға қолжетімділігі бөлек расталған іс-шаралар табылмады. Деректің жоқтығы қолжетімсіздікті білдірмейді.',
    noEventsPartial: 'Кей дереккөздер қазір қолжетімсіз. Тексерілген дереккөздерден лайықты іс-шара табылмады.',
    unavailable: 'Афиша дереккөздері уақытша қолжетімсіз. Кейінірек қайталап көріңіз.',
    partial: 'Афишаның кей дереккөздері қазір қолжетімсіз.',
    types: { exhibition: 'Көрме', concert: 'Концерт', festival: 'Фестиваль', sport: 'Спорт', evening: 'Кешкі іс-шара' },
    venue: 'Өтетін орны: {name}', source: 'Дереккөз: {name} ↗', checked: 'Мәлімет {date} оқылды', zone: 'Астана уақыты',
    older: 'Дереккөз бір тәуліктен астам бұрын тексерілген.', noTime: 'Басталу уақыты дереккөзде көрсетілмеген.',
    price: 'Дереккөздегі баға: {amount}', priceUnknown: 'Бағасы расталмаған.',
    availability: 'Билеттер мен бағдарлама өзгерістерін ұйымдастырушыдан тексеріңіз.',
  },
  en: {
    toggle: 'Events and listings', toggleHint: 'Show temporary events with a date and source. They are not added to the route automatically.', summary: 'events',
    heading: 'Events in Astana', intro: 'Events are separate from the route; distance to each venue has not been calculated. Check the schedule with the organizer before leaving.',
    noEvents: 'No events with a sourced date matched this request yet.',
    noEventsFree: 'No events with a verified free entry price matched yet. An unknown price does not mean free admission.',
    noEventsAccessible: 'No events with separately verified wheelchair access to the venue matched yet. Missing data does not mean a venue is inaccessible.',
    noEventsPartial: 'Some event sources are unavailable. No matching events were found in the sources we could check.',
    unavailable: 'Event listings are temporarily unavailable. Please try again later.',
    partial: 'Some event sources are currently unavailable.',
    types: { exhibition: 'Exhibition', concert: 'Concert', festival: 'Festival', sport: 'Sport', evening: 'Evening event' },
    venue: 'Venue: {name}', source: 'Source: {name} ↗', checked: 'Information read {date}', zone: 'Astana time',
    older: 'The source was checked more than a day ago.', noTime: 'The source does not give a start time.',
    price: 'Price in source: {amount}', priceUnknown: 'Price is unconfirmed.',
    availability: 'Check ticket availability and schedule changes with the organizer.',
  },
}

const categoryLabelsRu: Record<string, string> = {
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
const categoryLabelsKk: Record<string, string> = {
  cafe: 'Кафе', nightclub: 'Түнгі клуб', bar: 'Бар', music_venue: 'Концерт алаңы', events_venue: 'Іс-шара алаңы', restaurant: 'Мейрамхана', library: 'Кітапхана', bookshop: 'Кітап дүкені', cinema: 'Кинотеатр', museum: 'Мұражай', gallery: 'Галерея', theatre: 'Театр', park: 'Саябақ', garden: 'Бақ', viewpoint: 'Көрініс алаңы', artwork: 'Өнер нысаны', monument: 'Ескерткіш', memorial: 'Мемориал', attraction: 'Көрікті жер', arts_centre: 'Өнер орталығы', playground: 'Балалар алаңы', nature_reserve: 'Табиғи саябақ', lake: 'Көл', place_of_worship: 'Құлшылық орны', biergarten: 'Сыра бағы', community_centre: 'Қоғамдық орталық', food_court: 'Фудкорт', ice_cream: 'Балмұздақ', planetarium: 'Планетарий', coffee: 'Кофе дүкені', gift: 'Сыйлық дүкені', art: 'Өнер дүкені', fast_food: 'Жылдам тамақ', confectionery: 'Кондитерлік', mall: 'Сауда орталығы', zoo: 'Хайуанаттар бағы', bowling_alley: 'Боулинг', escape_game: 'Квест', fitness_centre: 'Фитнес орталығы', marina: 'Айлақ', sports_centre: 'Спорт орталығы', stadium: 'Стадион', water_park: 'Аквапарк', archaeological_site: 'Археологиялық ескерткіш',
}
const categoryLabelsEn: Record<string, string> = {
  cafe: 'Café', nightclub: 'Nightclub', bar: 'Bar', music_venue: 'Music venue', events_venue: 'Event venue', restaurant: 'Restaurant', library: 'Library', bookshop: 'Bookshop', cinema: 'Cinema', museum: 'Museum', gallery: 'Gallery', theatre: 'Theatre', park: 'Park', garden: 'Garden', viewpoint: 'Viewpoint', artwork: 'Artwork', monument: 'Monument', memorial: 'Memorial', attraction: 'Attraction', arts_centre: 'Arts center', playground: 'Playground', nature_reserve: 'Nature reserve', lake: 'Lake', place_of_worship: 'Place of worship', biergarten: 'Beer garden', community_centre: 'Community center', food_court: 'Food court', ice_cream: 'Ice cream shop', planetarium: 'Planetarium', coffee: 'Coffee shop', gift: 'Gift shop', art: 'Art shop', fast_food: 'Fast food', confectionery: 'Confectionery', mall: 'Shopping mall', zoo: 'Zoo', bowling_alley: 'Bowling alley', escape_game: 'Escape game', fitness_centre: 'Fitness center', marina: 'Marina', sports_centre: 'Sports center', stadium: 'Stadium', water_park: 'Water park', archaeological_site: 'Archaeological site',
}
function categoryLabel(category: string): string | undefined {
  return ({ ru: categoryLabelsRu, kk: categoryLabelsKk, en: categoryLabelsEn })[language][category]
}

app.innerHTML = `
  <a class="skip-link" href="#content">К содержимому</a>
  <div class="app-shell" data-sheet="peek" data-screen="request">
    <main id="content" class="map-stage" aria-label="Карта Астаны и маршрута">
      <div id="map" class="map-canvas" role="region" aria-label="Карта Астаны"></div>
      <header class="map-topbar topbar">
        <div class="brand" aria-label="Рядом — маршруты из Астаны">
          <span class="brand-mark" aria-hidden="true"><span></span></span>
          <span class="brand-name">рядом<span class="brand-period">.</span></span>
        </div>
        <span class="topbar-country">Астана</span>
        <label class="language-picker">
          <span class="visually-hidden">Язык интерфейса</span>
          <select id="languageSelect" aria-label="Язык интерфейса">
            <option value="ru">RU</option><option value="kk">ҚАЗ</option><option value="en">EN</option>
          </select>
        </label>
      </header>
      <p id="mapPickHint" class="map-pick-hint" hidden>Коснитесь карты, чтобы выбрать старт. Карту можно двигать.</p>
      <div class="map-actions" aria-label="Управление картой">
        <button id="recenterButton" class="map-action" type="button" aria-label="Показать начало маршрута" title="Показать начало маршрута"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg></button>
        <button id="fitButton" class="map-action" type="button" aria-label="Показать весь маршрут" title="Показать весь маршрут" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5m0 6v5h-5M4 15v5h5"/></svg></button>
      </div>
      <footer class="map-credits">
        <span>© участники OpenStreetMap</span>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Лицензия</a>
        <a id="privacyLink" href="/privacy.html">О данных</a>
      </footer>
    </main>

    <section id="routeSheet" class="route-sheet" aria-label="Планировщик маршрута">
      <button id="sheetHandle" class="sheet-handle" type="button" aria-label="Развернуть панель" aria-expanded="false" aria-controls="sheetBody">
        <span class="sheet-grip" aria-hidden="true"></span>
        <span id="sheetHandleLabel" class="sheet-handle-label" aria-hidden="true">Показать карту</span>
      </button>
      <button id="keyboardDone" class="keyboard-done" type="button" hidden>Готово</button>
      <div id="sheetBody" class="sheet-scroll" tabindex="-1">
        <div class="sheet-heading">
          <h1>Куда хочется?</h1>
          <p>Расскажите, какой вечер или прогулку вы задумали.</p>
          <p id="languageNotice" class="language-notice" role="status" hidden></p>
          <button id="returnToRouteButton" class="return-route-button" type="button" hidden>← К маршруту</button>
        </div>
        <form id="planner" class="planner" novalidate>
        <div class="planner-lead">
          <label for="prompt">Что вам интересно</label>
          <p id="promptHint" class="visually-hidden">Опишите настроение, места и детали своими словами.</p>
        </div>
        <textarea id="prompt" name="prompt" rows="2" maxlength="300" enterkeyhint="done" aria-describedby="promptHint promptError" placeholder="Например, тихое кафе с книгой или танцы до ночи"></textarea>
        <p id="promptError" class="field-error" role="alert" hidden></p>
        <div class="example-row" role="group" aria-label="Примеры запросов">
          <button type="button" data-example="quiet">Клуб и танцы</button>
          <button type="button" data-example="coffee">Кофе и книга</button>
          <button type="button" data-example="friends">С друзьями</button>
        </div>
        <fieldset class="mood-picker">
          <legend id="moodTitle">Под настроение</legend>
          <div class="mood-options" role="group" aria-labelledby="moodTitle">
            <button type="button" data-mood="relax" aria-pressed="false">Расслабиться</button>
            <button type="button" data-mood="fun" aria-pressed="false">Развлечься</button>
            <button type="button" data-mood="photo" aria-pressed="false">Пофотографироваться</button>
            <button type="button" data-mood="learn" aria-pressed="false">Узнать новое</button>
            <button type="button" data-mood="quiet" aria-pressed="false">Побыть в тишине</button>
            <button type="button" data-mood="unsure" aria-pressed="false">Не знаю</button>
          </div>
        </fieldset>
        <div id="eventOption" class="event-option">
          <label class="option-card" for="includeEvents">
            <input id="includeEvents" type="checkbox" aria-labelledby="includeEventsLabel" aria-describedby="includeEventsHint" />
            <span class="option-copy"><strong id="includeEventsLabel">События и афиша</strong><small id="includeEventsHint">Покажем временные мероприятия с датой и источником. Они не входят в маршрут автоматически.</small></span>
          </label>
        </div>
        <div id="startPicker" class="start-picker" role="group" aria-labelledby="startLabel">
          <div class="start-heading">
            <span id="startLabel">Откуда начнём?</span>
            <strong id="startValue">Центр Астаны</strong>
          </div>
          <div class="start-actions">
            <button id="deviceButton" class="start-button" type="button" aria-pressed="false">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 21 9-18-18 9 8 1 1 8Z"/></svg>
              <span id="deviceButtonLabel">Моя геопозиция</span>
            </button>
            <button id="mapPickButton" class="start-button" type="button" aria-pressed="false">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
              <span id="mapPickButtonLabel">Указать на карте</span>
            </button>
          </div>
          <div class="start-feedback">
            <p id="locationStatus" role="status">По умолчанию — центр Астаны.</p>
            <button id="resetStartButton" type="button" hidden>Сбросить</button>
          </div>
        </div>
        <div id="targetPicker" class="target-picker" role="group" aria-labelledby="targetLabel">
          <div class="target-heading">
            <span class="target-compass" aria-hidden="true">↑</span>
            <div class="target-heading-copy">
              <span id="targetLabel">В какую сторону?</span>
              <strong id="targetValue">Любое направление</strong>
            </div>
          </div>
          <p id="targetHint" class="target-hint">Укажите примерную область. Конкретные места подберём по вашему запросу.</p>
          <div class="target-actions">
            <button id="targetPickButton" class="start-button" type="button" aria-pressed="false">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
              <span id="targetPickButtonLabel">Выбрать на карте</span>
            </button>
            <button id="targetResetButton" type="button" hidden>Сбросить</button>
          </div>
          <p id="targetStatus" class="target-status" role="status" hidden></p>
        </div>
        <button id="settingsToggle" class="settings-toggle" type="button" aria-expanded="false" aria-controls="settingsDialog" aria-haspopup="dialog">
          <span><strong id="settingsLabel">Настройки</strong><span id="settingsSummary"></span></span>
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
            <legend id="durationLegend">Сколько времени есть</legend>
            <div class="duration-topline"><output id="durationValue" for="durationRange">2 ч</output></div>
            <input id="durationRange" class="duration-range" type="range" min="30" max="1440" step="15" value="120" aria-labelledby="durationLegend" aria-describedby="durationScaleHint" />
            <div class="duration-ticks" aria-hidden="true"><span>30 мин</span><span>6 ч</span><span>12 ч</span><span>18 ч</span><span>24 ч</span></div>
            <p id="durationScaleHint" class="field-hint">Пеший путь оценочный; время дороги на транспорте может быть неизвестно.</p>
          </fieldset>
          <fieldset class="field-group">
            <legend id="transportLegend">Как доберётесь</legend>
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
          <fieldset class="special-options">
            <legend id="accessibleTitle">Доступность мест</legend>
            <label class="option-card" for="wheelchairOnly">
              <input id="wheelchairOnly" type="checkbox" aria-labelledby="wheelchairLabel" aria-describedby="wheelchairHint wheelchairTripHint" />
              <span class="option-copy"><strong id="wheelchairLabel">Нужен доступ для коляски</strong><small id="wheelchairHint">Покажем только места с отметкой wheelchair=yes в OpenStreetMap. Путь между ними не проверен.</small></span>
            </label>
            <p id="wheelchairTripHint" class="option-availability" hidden></p>
            <label class="option-card" for="shortLegs">
              <input id="shortLegs" type="checkbox" aria-labelledby="shortLegsLabel" aria-describedby="shortLegsHint shortLegsAvailability" />
              <span class="option-copy"><strong id="shortLegsLabel">Короткие переходы · до ≈10 мин</strong><small id="shortLegsHint">Оценка пешком между каждой парой остановок и от старта. Доступно для прогулки по Астане.</small></span>
            </label>
            <p id="shortLegsAvailability" class="option-availability" hidden></p>
            <label class="option-card" for="gentlePace">
              <input id="gentlePace" type="checkbox" aria-labelledby="gentleLabel" aria-describedby="gentleHint gentleAvailability" />
              <span class="option-copy"><strong id="gentleLabel">Без спешки · до 2 мест</strong><small id="gentleHint">Меньше переходов и больше времени на каждой остановке. Наличие мест для отдыха и туалетов неизвестно.</small></span>
            </label>
            <p id="gentleAvailability" class="option-availability" hidden></p>
          </fieldset>
          <fieldset class="special-options">
            <legend id="specialTitle">Особый маршрут</legend>
            <label class="option-card" for="microQuest">
              <input id="microQuest" type="checkbox" aria-labelledby="questLabel" aria-describedby="questHint questAvailability" />
              <span class="option-copy"><strong id="questLabel">Микроприключение</strong><small id="questHint">Несколько разных реальных мест и маленькое задание в каждом. Без слежения за перемещением.</small></span>
            </label>
            <p id="questAvailability" class="option-availability" hidden></p>
          </fieldset>
          <p id="transportHint" class="form-note">Время дороги ориентировочное. Перед выходом проверьте маршрут и часы работы.</p>
        </div>
        <div class="submit-dock">
          <button id="surpriseButton" class="surprise-button" type="button" title="Необычное место рядом с учётом вашего времени и настроек">
            <span class="surprise-spark" aria-hidden="true">✦</span><span id="surpriseLabel">Удиви меня</span>
          </button>
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

// Keep controls mounted while switching surfaces so entered values and focus targets survive.
const pinIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>'
const closeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>'
const appShell = requiredElement<HTMLElement>('.app-shell')
appShell.insertBefore(requiredElement<HTMLElement>('.map-topbar'), appShell.firstChild)
requiredElement('.brand').remove()
requiredElement('.mood-picker').remove()
requiredElement('.sheet-heading').classList.add('request-intro')
requiredElement('#settingsToggle').insertAdjacentHTML('beforebegin', `
  <fieldset class="request-duration"><legend id="requestDurationLabel"></legend>
    <div class="duration-presets">${[30, 45, 60, 120].map((minutes) => `<button type="button" data-minutes="${minutes}" aria-pressed="false"></button>`).join('')}</div>
    <button id="customDuration" class="custom-duration" type="button"><span id="customDurationLabel"></span><span id="requestDurationValue"></span></button>
  </fieldset>`)
requiredElement('#startPicker').insertAdjacentHTML('beforebegin', `<button id="startRow" class="start-row" type="button" aria-haspopup="dialog" aria-controls="startDialog">${pinIcon}<span class="start-row-copy"><span id="fromLabel"></span><strong id="startValue"></strong><small id="startSourceLabel"></small></span><span class="settings-chevron" aria-hidden="true">›</span></button>`)
// The original start value lived inside the expanded picker.
requiredElement('#startPicker .start-heading').remove()
appShell.insertAdjacentHTML('beforeend', `
  <dialog id="startDialog" class="start-dialog" aria-labelledby="startLabel">
    <header class="dialog-header"><h2 id="startLabel"></h2><button type="button" class="dialog-close" data-close-dialog="startDialog">${closeIcon}</button></header>
    <div class="dialog-content"></div>
  </dialog>
  <dialog id="settingsDialog" class="settings-dialog" aria-labelledby="settingsTitle">
    <header class="dialog-header"><h2 id="settingsTitle" tabindex="-1"></h2><button type="button" class="dialog-close" data-close-dialog="settingsDialog">${closeIcon}</button></header>
    <div class="dialog-content"></div>
    <footer class="dialog-footer"><button id="applySettings" type="button" class="apply-settings"></button></footer>
  </dialog>`)
const settingsContent = requiredElement<HTMLElement>('#settingsDialog .dialog-content')
const advanced = requiredElement<HTMLElement>('#advancedSettings')
settingsContent.appendChild(advanced)
requiredElement('#startDialog .dialog-content').appendChild(requiredElement('#startPicker'))
const grid = requiredElement('.settings-grid')
const durationField = requiredElement('#durationLegend').closest('fieldset')!
const scopeField = requiredElement('.scope-row')
const specialField = requiredElement('#specialTitle').closest('fieldset')!
advanced.appendChild(durationField)
advanced.appendChild(scopeField)
advanced.appendChild(requiredElement('#targetPicker'))
advanced.appendChild(requiredElement('#eventOption'))
advanced.appendChild(specialField)
// Comfort stays independent of the wheelchair data filter.
const comfort = document.createElement('fieldset')
comfort.className = 'special-options'
comfort.innerHTML = '<legend id="comfortTitle"></legend>'
for (const id of ['shortLegs', 'shortLegsAvailability', 'gentlePace', 'gentleAvailability']) {
  const control = requiredElement('#' + id)
  comfort.appendChild(control.closest('label') ?? control)
}
grid.parentNode!.insertBefore(comfort, grid.nextSibling)
settingsContent.insertAdjacentHTML('beforeend', '<a id="settingsPrivacy" class="settings-privacy" href="/privacy.html"></a>')
const peopleInput = requiredElement<HTMLInputElement>('#groupSize')
const stepper = document.createElement('div')
stepper.className = 'people-stepper'
peopleInput.parentNode!.insertBefore(stepper, peopleInput)
stepper.innerHTML = '<button id="peopleLess" type="button">−</button><button id="peopleMore" type="button">+</button>'
stepper.insertBefore(peopleInput, stepper.lastElementChild)
requiredElement('.request-intro').insertAdjacentHTML('beforebegin', '<aside id="telegramGate" class="telegram-gate" hidden><strong id="telegramGateTitle"></strong><p id="telegramGateHint"></p><a id="telegramGateLink" href="https://t.me/smart_city_ryadombot?startapp" target="_blank" rel="noopener noreferrer"></a></aside>')
const settingsDialog = requiredElement<HTMLDialogElement>('#settingsDialog')
const startDialog = requiredElement<HTMLDialogElement>('#startDialog')
let mapReturn: 'request' | 'settings' = 'request'

const planner = requiredElement<HTMLFormElement>('#planner')
const prompt = requiredElement<HTMLTextAreaElement>('#prompt')
const promptError = requiredElement<HTMLElement>('#promptError')
const budget = requiredElement<HTMLInputElement>('#budget')
const groupSize = requiredElement<HTMLInputElement>('#groupSize')
const groupSizeError = requiredElement<HTMLElement>('#groupSizeError')
const wheelchairOnly = requiredElement<HTMLInputElement>('#wheelchairOnly')
const shortLegs = requiredElement<HTMLInputElement>('#shortLegs')
const gentlePace = requiredElement<HTMLInputElement>('#gentlePace')
const microQuest = requiredElement<HTMLInputElement>('#microQuest')
const includeEvents = requiredElement<HTMLInputElement>('#includeEvents')
const submitButton = requiredElement<HTMLButtonElement>('#submitButton')
const surpriseButton = requiredElement<HTMLButtonElement>('#surpriseButton')
const submitLabel = requiredElement<HTMLElement>('.submit-label')
const results = requiredElement<HTMLElement>('#results')
const locationStatus = requiredElement<HTMLElement>('#locationStatus')
const startValue = requiredElement<HTMLElement>('#startValue')
const deviceButton = requiredElement<HTMLButtonElement>('#deviceButton')
const mapPickButton = requiredElement<HTMLButtonElement>('#mapPickButton')
const resetStartButton = requiredElement<HTMLButtonElement>('#resetStartButton')
const targetValue = requiredElement<HTMLElement>('#targetValue')
const targetHint = requiredElement<HTMLElement>('#targetHint')
const targetStatus = requiredElement<HTMLElement>('#targetStatus')
const targetPickButton = requiredElement<HTMLButtonElement>('#targetPickButton')
const targetResetButton = requiredElement<HTMLButtonElement>('#targetResetButton')
const targetCompass = requiredElement<HTMLElement>('.target-compass')
const durationRange = requiredElement<HTMLInputElement>('#durationRange')
const durationValue = requiredElement<HTMLOutputElement>('#durationValue')
const mapPickHint = requiredElement<HTMLElement>('#mapPickHint')
const shell = requiredElement<HTMLElement>('.app-shell')
const sheetHandle = requiredElement<HTMLButtonElement>('#sheetHandle')
const sheetHandleLabel = requiredElement<HTMLElement>('#sheetHandleLabel')
const sheetScroll = requiredElement<HTMLElement>('#sheetBody')
const keyboardDone = requiredElement<HTMLButtonElement>('#keyboardDone')
const settingsToggle = requiredElement<HTMLButtonElement>('#settingsToggle')
const settingsSummary = requiredElement<HTMLElement>('#settingsSummary')
const recenterButton = requiredElement<HTMLButtonElement>('#recenterButton')
const fitButton = requiredElement<HTMLButtonElement>('#fitButton')
const returnToRouteButton = requiredElement<HTMLButtonElement>('#returnToRouteButton')
const languageSelect = document.getElementById('languageSelect') as unknown as HTMLSelectElement
if (!languageSelect) throw new Error('Missing language selector')
languageSelect.value = language

type SheetMode = 'map-only' | 'peek' | 'expanded' | 'loading' | 'results' | 'peek-results'
let sheetReturnMode: Exclude<SheetMode, 'map-only' | 'loading'> = 'peek'

function isTextEditor(element: Element | null): element is HTMLElement {
  return element instanceof HTMLTextAreaElement
    || element instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button', 'submit'].includes(element.type)
}

function blurActiveEditor(): void {
  const active = document.activeElement
  if (isTextEditor(active)) {
    active.blur()
    if (telegram?.isVersionAtLeast?.('9.1')) telegram.hideKeyboard?.()
  }
}

const state: {
  scope: Scope
  transport: Transport
  minutes: number
  coordinates: MapCoordinate | null
  targetArea: MapCoordinate | null
  startSource: 'center' | 'device' | 'map'
  isLoading: boolean
  wheelchairOnly: boolean
  shortLegs: boolean
  gentlePace: boolean
  microQuest: boolean
  includeEvents: boolean
  mood: Mood | null
  stops: Recommendation[]
} = {
  scope: 'city',
  transport: 'walk',
  minutes: 120,
  coordinates: null,
  targetArea: null,
  startSource: 'center',
  isLoading: false,
  wheelchairOnly: false,
  shortLegs: false,
  gentlePace: false,
  microQuest: false,
  includeEvents: false,
  mood: null,
  stops: [],
}

let requestVersion = 0
let activeRecommendation: AbortController | null = null
let mapController: RecommendationsMapController | null = null
let routeDrawer: RouteDrawerController | null = null
let currentRouteOrigin: MapCoordinate | null = null
let currentRoute: RoutePlan | null = null
let currentResponse: RouteResponse | null = null
let currentRouteIndex = 0
let lastRequest: WalkRequest | null = null
const seenPlaceIds = new Set<string>()
let startMessageKey: MessageKey = 'startCenterStatus'
let pickingStart = false
let pickingTarget = false
let targetStatusKey: MessageKey | null = null
let locationAttemptId = 0
let durationChangedByUser = false

function distanceKm(a: MapCoordinate, b: MapCoordinate): number {
  const radians = Math.PI / 180
  const deltaLat = (b.lat - a.lat) * radians
  const deltaLon = (b.lon - a.lon) * radians
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(deltaLon / 2) ** 2
  return 6_371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

function bearingDegrees(a: MapCoordinate, b: MapCoordinate): number {
  const radians = Math.PI / 180
  const deltaLon = (b.lon - a.lon) * radians
  const y = Math.sin(deltaLon) * Math.cos(b.lat * radians)
  const x = Math.cos(a.lat * radians) * Math.sin(b.lat * radians)
    - Math.sin(a.lat * radians) * Math.cos(b.lat * radians) * Math.cos(deltaLon)
  return (Math.atan2(y, x) / radians + 360) % 360
}

function renderMapPickHint(): void {
  mapPickHint.textContent = t(pickingTarget ? (targetStatusKey ?? 'targetPickInstruction') : startMessageKey === 'startOutside' ? 'startOutside' : 'startPickInstruction')
  mapPickHint.hidden = !pickingStart && !pickingTarget
}

function renderTargetPicker(): void {
  requiredElement<HTMLElement>('#targetLabel').textContent = t('targetTitle')
  requiredElement<HTMLElement>('#targetPickButtonLabel').textContent = t(pickingTarget ? 'targetCancel' : 'targetMap')
  targetResetButton.textContent = t('startReset')
  targetResetButton.hidden = !state.targetArea && !pickingTarget
  targetPickButton.classList.toggle('is-selected', pickingTarget || !!state.targetArea)
  targetPickButton.setAttribute('aria-pressed', String(pickingTarget || !!state.targetArea))
  targetStatus.hidden = !targetStatusKey
  targetStatus.textContent = targetStatusKey ? t(targetStatusKey) : ''
  if (!state.targetArea) {
    targetValue.textContent = t('targetAny')
    targetHint.textContent = t('targetHint')
    targetCompass.style.removeProperty('--bearing')
    targetCompass.classList.remove('has-target')
  } else {
    const from = origin()
    const distance = distanceKm(from, state.targetArea)
    const bearing = bearingDegrees(from, state.targetArea)
    const compassIndex = Math.round(bearing / 45) % 8
    const direction = state.startSource === 'center'
      ? compassLabels[language][compassIndex] : compassNames[language][compassIndex]
    targetValue.textContent = distance < .4
      ? t(state.startSource === 'center' ? 'targetNearCenter' : 'targetNear')
      : t(state.startSource === 'center' ? 'targetTowardCenter' : 'targetToward', { direction })
    const rounded = distance < 10 ? Math.round(distance * 10) / 10 : Math.round(distance)
    const formatter = new Intl.NumberFormat(language === 'kk' ? 'kk-KZ' : language === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: 1 })
    targetHint.textContent = `${t('targetDistance', { distance: formatter.format(rounded) })}. ${t('targetSelectedHint')}${state.startSource === 'center' ? ` ${t('targetCenterCaveat')}` : ''}`
    targetCompass.style.setProperty('--bearing', `${bearing}deg`)
    targetCompass.classList.add('has-target')
  }
  renderMapPickHint()
}

function renderStartPicker(): void {
  requiredElement<HTMLElement>('#startLabel').textContent = t('startTitle')
  startValue.textContent = t(state.startSource === 'center' ? 'startCenter' : state.startSource === 'device' ? 'startDevice' : 'startMapSelected')
  requiredElement<HTMLElement>('#deviceButtonLabel').textContent = t('startDevice')
  requiredElement<HTMLElement>('#mapPickButtonLabel').textContent = t(pickingStart ? 'startCancel' : 'startMap')
  resetStartButton.textContent = t('startReset')
  resetStartButton.hidden = state.startSource === 'center' && !pickingStart
  deviceButton.classList.toggle('is-selected', state.startSource === 'device')
  mapPickButton.classList.toggle('is-selected', pickingStart || state.startSource === 'map')
  deviceButton.setAttribute('aria-pressed', String(state.startSource === 'device'))
  mapPickButton.setAttribute('aria-pressed', String(pickingStart || state.startSource === 'map'))
  locationStatus.textContent = t(startMessageKey)
  requiredElement('#startSourceLabel').textContent = redesignCopy[language][state.startSource === 'center' ? 'automatic' : state.startSource === 'device' ? 'device' : 'manual']
  renderMapPickHint()
}

function applyTranslations(): void {
  document.documentElement.lang = language
  document.title = language === 'ru' ? 'Рядом — маршрут под ваше настроение'
    : language === 'kk' ? 'Рядом — көңіл күйіңізге сай бағыт'
      : 'Ryadom — a route for your mood'
  document.querySelector('meta[name="description"]')?.setAttribute('content', language === 'ru'
    ? 'Опишите, чего хочется, и получите маршрут по Астане или поездку из города с учётом времени и компании.'
    : language === 'kk' ? 'Қалауыңызды сипаттаңыз: уақыт пен серіктеріңізді ескеріп, Астанадағы бағытты немесе қаладан сапарды табыңыз.'
      : 'Describe what you feel like doing and get a route in Astana or a trip from the city, tailored to your time and group.')
  for (const option of languageSelect.options) option.title = languageNames[option.value as Language]
  const textTargets: Array<[string, MessageKey]> = [
    ['.skip-link', 'skip'], ['.topbar-country', 'astana'],
    ['.map-credits span', 'osm'], ['.map-credits a[href^="https://www.openstreetmap.org"]', 'license'],
    ['#privacyLink', 'data'], ['.sheet-heading h1', 'heading'], ['.sheet-heading p', 'subtitle'],
    ['#keyboardDone', 'keyboardDone'],
    ['#returnToRouteButton', 'backRoute'], ['.planner-lead label', 'interest'],
    ['#promptHint', 'promptHint'], ['.example-row [data-example="quiet"]', 'exampleClub'],
    ['.example-row [data-example="coffee"]', 'exampleCoffee'],
    ['.example-row [data-example="friends"]', 'exampleFriends'],
    ['.scope-row .field-label', 'where'], ['[data-scope="city"]', 'inAstana'],
    ['[data-scope="day_trip"]', 'fromCity'], ['#durationLegend', 'duration'],
    ['#durationScaleHint', 'durationScaleHint'],
    ['#transportLegend', 'transport'], ['.budget-group label', 'budget'],
    ['#budgetHint', 'budgetHint'], ['.group-size-group label', 'group'],
    ['#groupSizeHint', 'groupHint'],
    ['#accessibleTitle', 'accessibleTitle'], ['#wheelchairLabel', 'wheelchairLabel'],
    ['#wheelchairHint', 'wheelchairHint'], ['#shortLegsLabel', 'shortLegsLabel'],
    ['#shortLegsHint', 'shortLegsHint'], ['#specialTitle', 'specialTitle'],
    ['#gentleLabel', 'gentleLabel'], ['#gentleHint', 'gentleHint'],
    ['#questLabel', 'questLabel'], ['#questHint', 'questHint'],
    ['.submit-label', 'submit'], ['.language-picker span', 'language'],
    ['#moodTitle', 'moodTitle'], ['#surpriseLabel', 'surprise'],
  ]
  for (const [selector, key] of textTargets) {
    const element = document.querySelector<HTMLElement>(selector)
    if (element) element.textContent = t(key)
  }
  const ariaTargets: Array<[string, string, MessageKey]> = [
    ['.map-stage', 'aria-label', 'mapRegion'], ['#map', 'aria-label', 'map'],
    ['.brand', 'aria-label', 'brand'], ['.map-actions', 'aria-label', 'mapActions'],
    ['#recenterButton', 'aria-label', 'recenter'], ['#recenterButton', 'title', 'recenter'],
    ['#fitButton', 'aria-label', 'fit'], ['#fitButton', 'title', 'fit'],
    ['#routeSheet', 'aria-label', 'planner'], ['.example-row', 'aria-label', 'examples'],
    ['.scope-switch', 'aria-label', 'whereRoute'],
    ['#transportChoices', 'aria-label', 'transportAria'], ['#results', 'aria-label', 'readyRoute'],
    ['#languageSelect', 'aria-label', 'language'],
  ]
  for (const [selector, attribute, key] of ariaTargets) document.querySelector(selector)?.setAttribute(attribute, t(key))
  prompt.placeholder = t('promptPlaceholder')
  budget.placeholder = t('noLimit')
  requiredElement<HTMLElement>('#includeEventsLabel').textContent = eventCopy[language].toggle
  requiredElement<HTMLElement>('#includeEventsHint').textContent = eventCopy[language].toggleHint
  surpriseButton.title = t('surpriseHint')
  surpriseButton.setAttribute('aria-label', `${t('surprise')}. ${t('surpriseHint')}`)
  applyRedesignTranslations()
  renderStartPicker()
  renderTargetPicker()
  requiredElement<HTMLAnchorElement>('#privacyLink').href = `/privacy.html?lang=${language}`
  mapController?.setLanguage(language)
  renderDurationSlider()
  renderTransportChoices()
  renderSpecialSettings()
  renderMoodChoices()
  updateSettingsSummary()
  setSheetMode(shell.dataset.sheet as SheetMode)
}

function updateBackButton(): void {
  if (!telegram?.isVersionAtLeast?.('6.1')) return
  if (settingsDialog.open || startDialog.open || shell.dataset.screen !== 'request') telegram.BackButton?.show()
  else telegram.BackButton?.hide()
}

function openSettings(): void {
  blurActiveEditor()
  openDialog(settingsDialog)
  settingsToggle.setAttribute('aria-expanded', 'true')
  requiredElement<HTMLElement>('#settingsTitle').focus({ preventScroll: true })
  updateBackButton()
}

function closeDialog(dialog: HTMLDialogElement): void {
  blurActiveEditor()
  void closeAnimatedDialog(dialog).then(() => {
    settingsToggle.setAttribute('aria-expanded', String(settingsDialog.open))
    updateBackButton()
  })
  updateSettingsSummary()
  settingsToggle.setAttribute('aria-expanded', String(settingsDialog.open))
  updateBackButton()
}

function returnFromMap(): void {
  const wasPicking = pickingStart || pickingTarget
  pickingStart = false
  pickingTarget = false
  mapController?.setStartPointSelectionMode(false)
  mapController?.setTargetAreaSelectionMode(false)
  startMessageKey = startStatusForSource()
  targetStatusKey = null
  renderStartPicker()
  renderTargetPicker()
  setSheetMode(wasPicking ? 'peek' : sheetReturnMode)
  if (wasPicking && mapReturn === 'settings') openSettings()
}

function goBack(): void {
  blurActiveEditor()
  if (settingsDialog.open) closeDialog(settingsDialog)
  else if (startDialog.open) closeDialog(startDialog)
  else if (shell.dataset.screen === 'map' || shell.dataset.sheet === 'map-only') returnFromMap()
  else {
    if (state.isLoading) clearResults()
    setSheetMode('peek')
  }
}

function renderDrawerPosition(position: DrawerPosition): void {
  const collapsed = position === 'collapsed'
  shell.dataset.sheet = collapsed ? 'map-only' : 'results'
  sheetReturnMode = 'results'
  const copy = redesignCopy[language]
  const label = collapsed ? copy.drawerOpen : position === 'half' ? copy.drawerExpand : copy.drawerCollapse
  sheetHandleLabel.textContent = label
  sheetHandle.setAttribute('aria-label', `${label}. ${copy.drawerHint}`)
  sheetHandle.setAttribute('aria-expanded', String(!collapsed))
  updateBackButton()
}

let surfaceAnimation: Animation | null = null
function revealSurface(element: HTMLElement): void {
  surfaceAnimation?.cancel()
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  surfaceAnimation = element.animate([
    { opacity: .35, translate: '0 10px' }, { opacity: 1, translate: '0 0' },
  ], { duration: 240, easing: 'cubic-bezier(.2,.7,.3,1)' })
}

function setSheetMode(mode: SheetMode): void {
  const previousMode = shell.dataset.sheet as SheetMode
  const previousScreen = shell.dataset.screen
  if (mode === 'peek-results') mode = 'map-only'
  if (mode === 'map-only' && previousMode !== 'map-only' && previousMode !== 'loading') sheetReturnMode = previousMode
  blurActiveEditor()
  const drawerEnabled = !!currentRoute && !pickingStart && !pickingTarget && (mode === 'results' || mode === 'map-only')
  const mobileDrawer = drawerEnabled && window.matchMedia('(max-width: 760px)').matches
  shell.dataset.sheet = mode
  shell.dataset.screen = mobileDrawer ? 'result' : mode === 'map-only' ? 'map'
    : mode === 'results' || mode === 'loading' ? 'result' : 'request'
  const handleLabel = pickingStart ? redesignCopy[language].cancelPoint
    : pickingTarget ? redesignCopy[language].returnSettings
      : currentRoute ? t('expandRoute') : t('openPlanner')
  sheetHandleLabel.textContent = handleLabel
  sheetHandle.setAttribute('aria-label', handleLabel)
  sheetHandle.setAttribute('aria-expanded', String(mode !== 'map-only'))
  sheetHandle.disabled = mode === 'loading'
  planner.hidden = shell.dataset.screen !== 'request'
  requiredElement<HTMLElement>('.request-intro').hidden = planner.hidden
  requiredElement<HTMLAnchorElement>('.skip-link').href = planner.hidden ? '#content' : '#sheetBody'
  requiredElement<HTMLElement>('#telegramGate').hidden = Boolean(telegram?.initData) || planner.hidden
  results.hidden = shell.dataset.screen !== 'result'
  sheetScroll.inert = mode === 'map-only'
  sheetScroll.setAttribute('aria-hidden', String(mode === 'map-only'))
  returnToRouteButton.hidden = !currentRouteOrigin || planner.hidden
  // Preserve reading position when the same route is collapsed and reopened.
  if (mode !== previousMode && !drawerEnabled) sheetScroll.scrollTop = 0
  routeDrawer?.setEnabled(drawerEnabled, mode === previousMode && routeDrawer.active
    ? undefined : mode === 'map-only' ? 'collapsed' : 'half')
  if (mobileDrawer) renderDrawerPosition(routeDrawer?.position ?? 'half')
  updateBackButton()
  if (previousScreen !== shell.dataset.screen && !mobileDrawer) revealSurface(sheetScroll)
  requestAnimationFrame(() => {
    syncMapInset()
    if (mode === 'results' && currentRoute && !routeDrawer?.active) mapController?.fit()
  })
}

function updateSettingsSummary(): void {
  const count = Number(groupSize.value) || 1
  const people = `${count} ${count === 1 ? t('personOne') : t('personMany')}`
  const money = budget.value.trim() === '' ? t('noLimit') : `${formatKzt(Number(budget.value))} ${t('perPerson')}`
  const extras = [
    state.scope === 'day_trip' ? t('fromAstana') : '',
    state.wheelchairOnly ? t('wheelchairSummary') : '',
    state.shortLegs ? t('shortLegsSummary') : '',
    state.gentlePace ? t('gentleSummary') : '',
    state.microQuest ? t('questSummary') : '',
    state.includeEvents ? eventCopy[language].summary : '',
    state.targetArea ? targetValue.textContent : '',
  ].filter(Boolean)
  settingsSummary.textContent = [travelModeLabel(state.transport), money, people, ...extras].join(' · ')
  requiredElement<HTMLButtonElement>('#peopleLess').disabled = count <= 1
  requiredElement<HTMLButtonElement>('#peopleMore').disabled = count >= 12
  requiredElement('#budgetHint').textContent = budget.value.trim() === '0' ? redesignCopy[language].zeroBudgetHint : redesignCopy[language].budgetHint
}

function applyRedesignTranslations(): void {
  const copy = redesignCopy[language]
  const labels: Record<string, string> = {
    '.request-intro h1': copy.title, '.request-intro > p:first-of-type': copy.subtitle,
    '.planner-lead label': copy.prompt, '#fromLabel': copy.from,
    '#requestDurationLabel': copy.duration, '#customDurationLabel': copy.customTime,
    '#settingsLabel': copy.settings, '#settingsTitle': copy.settingsTitle,
    '#applySettings': copy.apply, '#comfortTitle': copy.comfort, '#specialTitle': copy.more,
    '#settingsPrivacy': copy.privacy, '#budgetHint': copy.budgetHint,
    '#telegramGateTitle': copy.telegramTitle, '#telegramGateHint': copy.telegramHint,
    '#telegramGateLink': copy.telegramOpen,
  }
  for (const [selector, label] of Object.entries(labels)) requiredElement(selector).textContent = label
  prompt.placeholder = copy.placeholder
  requiredElement<HTMLAnchorElement>('#settingsPrivacy').href = `/privacy.html?lang=${language}`
  document.querySelectorAll('[data-close-dialog]').forEach((button) => button.setAttribute('aria-label', copy.close))
  requiredElement('#peopleLess').setAttribute('aria-label', copy.decrease)
  requiredElement('#peopleMore').setAttribute('aria-label', copy.increase)
  document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((button) => {
    const key = button.dataset.example as 'quiet' | 'coffee' | 'friends'
    button.textContent = copy[key]
    button.dataset.exampleText = copy[`${key}Prompt`]
    button.setAttribute('aria-pressed', String(prompt.value === button.dataset.exampleText))
  })
  document.querySelectorAll<HTMLButtonElement>('[data-minutes]').forEach((button) => {
    button.textContent = formatMinutes(Number(button.dataset.minutes))
  })
  requiredElement('.duration-ticks').innerHTML = [30, 360, 720, 1080, 1440].map((value) => `<span>${formatMinutes(value)}</span>`).join('')
}

function renderSpecialSettings(): void {
  const cityWalk = state.scope === 'city' && state.transport === 'walk'
  if (!cityWalk) state.shortLegs = false
  if (state.scope !== 'city') {
    state.gentlePace = false
    state.microQuest = false
    state.includeEvents = false
  }
  wheelchairOnly.checked = state.wheelchairOnly
  wheelchairOnly.setAttribute('aria-describedby', state.scope === 'day_trip' && state.wheelchairOnly
    ? 'wheelchairHint wheelchairTripHint' : 'wheelchairHint')
  shortLegs.checked = state.shortLegs
  shortLegs.disabled = !cityWalk
  shortLegs.setAttribute('aria-describedby', cityWalk ? 'shortLegsHint' : 'shortLegsHint shortLegsAvailability')
  gentlePace.checked = state.gentlePace
  gentlePace.disabled = state.scope !== 'city'
  gentlePace.setAttribute('aria-describedby', state.scope === 'city' ? 'gentleHint' : 'gentleHint gentleAvailability')
  microQuest.checked = state.microQuest
  microQuest.disabled = state.scope !== 'city'
  microQuest.setAttribute('aria-describedby', state.scope === 'city' ? 'questHint' : 'questHint questAvailability')
  includeEvents.checked = state.includeEvents
  includeEvents.disabled = state.scope !== 'city'
  requiredElement<HTMLElement>('#eventOption').hidden = state.scope !== 'city'
  for (const input of [wheelchairOnly, shortLegs, gentlePace, microQuest, includeEvents]) {
    input.closest('.option-card')?.classList.toggle('is-selected', input.checked)
    input.closest('.option-card')?.classList.toggle('is-disabled', input.disabled)
  }
  const tripHint = requiredElement<HTMLElement>('#wheelchairTripHint')
  tripHint.textContent = t('wheelchairTripHint')
  tripHint.hidden = state.scope !== 'day_trip' || !state.wheelchairOnly
  const shortNote = requiredElement<HTMLElement>('#shortLegsAvailability')
  shortNote.textContent = t('shortLegsUnavailable')
  shortNote.hidden = cityWalk
  const gentleNote = requiredElement<HTMLElement>('#gentleAvailability')
  gentleNote.textContent = t('gentleUnavailable')
  gentleNote.hidden = state.scope === 'city'
  const questNote = requiredElement<HTMLElement>('#questAvailability')
  questNote.textContent = t('questUnavailable')
  questNote.hidden = state.scope === 'city'
}

const moodKeys: Record<Mood, MessageKey> = {
  relax: 'moodRelax', fun: 'moodFun', photo: 'moodPhoto', learn: 'moodLearn', quiet: 'moodQuiet', unsure: 'moodUnsure',
}
const swapReasonKeys: Record<SwapReason, MessageKey> = {
  far: 'swapFar', expensive: 'swapExpensive', visited: 'swapVisited', other: 'swapOther',
}

function renderMoodChoices(): void {
  document.querySelector<HTMLElement>('.mood-picker')?.toggleAttribute('hidden', state.scope !== 'city')
  document.querySelectorAll<HTMLButtonElement>('[data-mood]').forEach((button) => {
    const mood = button.dataset.mood as Mood
    const selected = state.mood === mood
    button.textContent = t(moodKeys[mood])
    button.classList.toggle('is-selected', selected)
    button.setAttribute('aria-pressed', String(selected))
  })
}

document.querySelectorAll<HTMLButtonElement>('[data-mood]').forEach((button) => {
  button.addEventListener('click', () => {
    const mood = button.dataset.mood as Mood
    state.mood = state.mood === mood ? null : mood
    promptError.hidden = true
    blurActiveEditor()
    clearResults()
    renderMoodChoices()
  })
})

wheelchairOnly.addEventListener('change', () => {
  state.wheelchairOnly = wheelchairOnly.checked
  renderSpecialSettings()
  clearResults()
  updateSettingsSummary()
})
shortLegs.addEventListener('change', () => {
  state.shortLegs = shortLegs.checked
  renderSpecialSettings()
  clearResults()
  updateSettingsSummary()
})
gentlePace.addEventListener('change', () => {
  state.gentlePace = gentlePace.checked
  renderSpecialSettings()
  clearResults()
  updateSettingsSummary()
})
microQuest.addEventListener('change', () => {
  state.microQuest = microQuest.checked
  renderSpecialSettings()
  clearResults()
  updateSettingsSummary()
})
includeEvents.addEventListener('change', () => {
  state.includeEvents = includeEvents.checked
  renderSpecialSettings()
  clearResults()
  updateSettingsSummary()
})

sheetHandle.addEventListener('click', () => { if (!routeDrawer?.active) returnFromMap() })
settingsToggle.addEventListener('click', openSettings)
returnToRouteButton.addEventListener('click', () => setSheetMode('results'))
keyboardDone.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  blurActiveEditor()
})
keyboardDone.addEventListener('click', blurActiveEditor)
document.addEventListener('focusin', (event) => {
  if (isTextEditor(event.target as Element) && routeSheet.contains(event.target as Node)) keyboardDone.hidden = false
})
document.addEventListener('focusout', () => {
  window.setTimeout(() => {
    if (!isTextEditor(document.activeElement)) keyboardDone.hidden = true
  }, 100)
})
document.addEventListener('pointerdown', (event) => {
  if (!isTextEditor(document.activeElement)) return
  const target = event.target
  if (target instanceof Element && !target.closest('input, textarea, select, [contenteditable="true"]')) blurActiveEditor()
}, { capture: true })
prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    blurActiveEditor()
  }
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!settingsDialog.open && !startDialog.open) goBack()
  }
})

document.documentElement.dataset.theme = 'light'
if (telegram?.isVersionAtLeast?.('7.0')) telegram.setHeaderColor?.('#f5f6f1')
if (telegram?.isVersionAtLeast?.('6.1')) telegram.setBackgroundColor?.('#f5f6f1')
if (telegram?.isVersionAtLeast?.('7.10')) telegram.setBottomBarColor?.('#f5f6f1')
if (telegram?.isVersionAtLeast?.('7.7')) telegram.disableVerticalSwipes?.()
telegram?.ready()
telegram?.expand()

languageSelect.addEventListener('change', () => {
  const next = matchLanguage(languageSelect.value)
  if (!next || next === language) return
  const hadRoute = currentRouteOrigin !== null || state.isLoading
  const regenerate = hadRoute && shell.dataset.screen !== 'request'
  const repeatSurprise = Boolean(lastRequest?.surprise)
  const prior = language
  const previousExample = (['quiet', 'coffee', 'friends'] as const).find((id) => prompt.value === redesignCopy[prior][`${id}Prompt`])
  language = next
  launchScreen.setLanguage(language)
  try { localStorage.setItem('ryadom-language', language) } catch { /* Ignore storage errors. */ }
  if (previousExample) prompt.value = redesignCopy[language][`${previousExample}Prompt`]
  if (state.isLoading || hadRoute && !regenerate) clearResults()
  promptError.hidden = true
  groupSizeError.hidden = true
  budget.setCustomValidity('')
  applyTranslations()
  if (regenerate) {
    const validated = validateForm(repeatSurprise)
    if (validated) void submitRecommendation(validated, repeatSurprise)
  }
  const notice = requiredElement<HTMLElement>('#languageNotice')
  notice.textContent = t('languageChange')
  notice.hidden = !hadRoute || regenerate
})

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
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} ${t('hoursShort')}`
  return `${minutes} ${t('minutesShort')}`
}

function formatKzt(amount: number): string {
  return `${new Intl.NumberFormat(language === 'kk' ? 'kk-KZ' : language === 'en' ? 'en-US' : 'ru-RU').format(amount)} ₸`
}

function stopCount(count: number): string {
  const form = new Intl.PluralRules(language === 'kk' ? 'kk-KZ' : language === 'en' ? 'en-US' : 'ru-RU').select(count)
  return `${count} ${form === 'one' ? t('stopsOne') : form === 'few' ? t('stopsFew') : t('stopsMany')}`
}

function travelModeLabel(mode: string | undefined): string {
  return mode === 'car' ? t('carLower') : mode === 'transit' ? t('transitLower') : t('walkLower')
}

function origin(): MapCoordinate {
  return state.coordinates ?? ASTANA_CENTER
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
  currentRoute = null
  currentResponse = null
  currentRouteIndex = 0
  lastRequest = null
  fitButton.hidden = true
  state.stops = []
  seenPlaceIds.clear()
  if (state.isLoading) setLoading(false)
  results.hidden = true
  results.replaceChildren()
  if (shell.dataset.sheet === 'results' || shell.dataset.sheet === 'peek-results' || shell.dataset.sheet === 'loading') setSheetMode('expanded')
}

function renderDurationSlider(): void {
  durationRange.value = String(state.minutes)
  durationRange.style.setProperty('--duration-progress', `${(state.minutes - 30) / 1410 * 100}%`)
  durationRange.setAttribute('aria-valuetext', formatMinutes(state.minutes))
  durationValue.value = formatMinutes(state.minutes)
  document.querySelectorAll<HTMLButtonElement>('[data-minutes]').forEach((button) => {
    const selected = Number(button.dataset.minutes) === state.minutes
    button.classList.toggle('is-selected', selected)
    button.setAttribute('aria-pressed', String(selected))
  })
  requiredElement('#requestDurationValue').textContent = [30, 45, 60, 120].includes(state.minutes) ? '' : ` · ${formatMinutes(state.minutes)}`
}

function selectDuration(minutes: number): void {
  durationChangedByUser = true
  if (state.minutes === minutes) return
  state.minutes = minutes
  if (currentRouteOrigin !== null || state.isLoading || !results.hidden) clearResults()
  renderDurationSlider()
  updateSettingsSummary()
}
durationRange.addEventListener('input', () => selectDuration(Number(durationRange.value)))
document.querySelectorAll<HTMLButtonElement>('[data-minutes]').forEach((button) => {
  button.addEventListener('click', () => selectDuration(Number(button.dataset.minutes)))
})
requiredElement('#customDuration').addEventListener('click', () => {
  openSettings()
  durationRange.focus()
  durationRange.scrollIntoView({ block: 'center' })
})
requiredElement('#startRow').addEventListener('click', () => {
  blurActiveEditor()
  openDialog(startDialog)
  updateBackButton()
})
for (const dialog of [settingsDialog, startDialog]) {
  dialog.addEventListener('close', () => {
    settingsToggle.setAttribute('aria-expanded', String(settingsDialog.open))
    updateBackButton()
  })
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(dialog) })
}
document.querySelectorAll<HTMLButtonElement>('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => closeDialog(requiredElement<HTMLDialogElement>('#' + button.dataset.closeDialog)))
})
requiredElement('#applySettings').addEventListener('click', () => {
  // Check settings without requiring a written request yet.
  if (!validateForm(true)) return
  closeDialog(settingsDialog)
})
for (const [id, delta] of [['peopleLess', -1], ['peopleMore', 1]] as const) {
  requiredElement('#' + id).addEventListener('click', () => {
    groupSize.value = String(Math.max(1, Math.min(12, (Number(groupSize.value) || 1) + delta)))
    groupSize.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
if (telegram?.isVersionAtLeast?.('6.1')) telegram.BackButton?.onClick(goBack)

function renderTransportChoices(): void {
  const options: Array<[Transport, string]> = state.scope === 'city'
    ? [['walk', t('walk')], ['transit', t('transit')], ['car', t('car')]]
    : [['car', t('car')]]
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
      renderSpecialSettings()
      clearResults()
      updateSettingsSummary()
    })
    row.appendChild(button)
  }
  updateTransportHint()
}

function updateTransportHint(): void {
  requiredElement<HTMLElement>('#transportHint').textContent = state.scope === 'day_trip'
    ? t('tripTransportHint')
    : state.transport === 'walk'
      ? t('walkTransportHint')
      : t('otherTransportHint')
}

function setScope(scope: Scope): void {
  if (scope === state.scope) return
  state.scope = scope
  if (scope === 'day_trip') state.mood = null
  targetStatusKey = null
  if (!durationChangedByUser) state.minutes = scope === 'city' ? 120 : 720
  state.transport = scope === 'city' ? 'walk' : 'car'
  if (scope === 'city' && state.targetArea && !insideAstana(state.targetArea)) {
    state.targetArea = null
    targetStatusKey = 'targetOutside'
    mapController?.setTargetArea(undefined)
  }
  document.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach((button) => {
    const selected = button.dataset.scope === scope
    button.classList.toggle('is-selected', selected)
    button.setAttribute('aria-pressed', String(selected))
  })
  renderDurationSlider()
  renderTransportChoices()
  renderSpecialSettings()
  renderMoodChoices()
  clearResults()
  renderTargetPicker()
  updateSettingsSummary()
}

document.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach((button) => {
  button.addEventListener('click', () => setScope(button.dataset.scope as Scope))
})
document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((button) => {
  button.addEventListener('click', () => {
    prompt.value = button.dataset.exampleText ?? ''
    promptError.hidden = true
    blurActiveEditor()
    state.mood = button.dataset.example === 'quiet' ? 'relax' : null
    if (button.dataset.example === 'friends' && Number(groupSize.value) === 1) groupSize.value = '3'
    clearResults()
    applyRedesignTranslations()
    updateSettingsSummary()
  })
})
prompt.addEventListener('input', () => {
  state.mood = null
  document.querySelectorAll('[data-example]').forEach((button) => button.setAttribute('aria-pressed', 'false'))
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

function startStatusForSource(): MessageKey {
  return state.startSource === 'device' ? 'startDeviceFound'
    : state.startSource === 'map' ? 'startMapFound' : 'startCenterStatus'
}

function setStartPoint(point: MapCoordinate | null, source: 'center' | 'device' | 'map'): void {
  locationAttemptId += 1
  const wasPicking = pickingStart
  pickingStart = false
  deviceButton.disabled = false
  mapController?.setStartPointSelectionMode(false)
  state.coordinates = point
  state.startSource = source
  startMessageKey = startStatusForSource()
  clearResults()
  mapController?.setStartPoint(origin())
  mapController?.focus(origin())
  renderStartPicker()
  renderTargetPicker()
  if (startDialog.open) closeDialog(startDialog)
  if (wasPicking) setSheetMode('peek')
}

function requestDeviceLocation(): void {
  const attemptId = ++locationAttemptId
  pickingStart = false
  mapController?.setStartPointSelectionMode(false)
  if (pickingTarget) {
    pickingTarget = false
    mapController?.setTargetAreaSelectionMode(false)
    renderTargetPicker()
  }
  deviceButton.disabled = true
  startMessageKey = 'startLoading'
  renderStartPicker()
  const finish = (point: MapCoordinate | null, errorKey: MessageKey = 'startUnavailable') => {
    if (attemptId !== locationAttemptId) return
    deviceButton.disabled = false
    if (!point) {
      startMessageKey = errorKey
      renderStartPicker()
      return
    }
    if (!insideAstana(point)) {
      startMessageKey = 'startOutside'
      renderStartPicker()
      return
    }
    setStartPoint(point, 'device')
  }
  const fallback = () => {
    if (!navigator.geolocation) {
      finish(null)
      return
    }
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => finish({ lat: position.coords.latitude, lon: position.coords.longitude }),
        (error) => finish(null, error.code === 1 ? 'startDenied' : 'startUnavailable'),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
      )
    } catch {
      finish(null)
    }
  }
  const manager = telegram?.LocationManager
  if (!telegram?.isVersionAtLeast?.('8.0') || !manager) {
    fallback()
    return
  }
  try {
    manager.init(() => {
      if (attemptId !== locationAttemptId) return
      if (!manager.isLocationAvailable) {
        fallback()
        return
      }
      manager.getLocation((location) => {
        if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
          finish(null, 'startDenied')
          return
        }
        finish({ lat: location.latitude, lon: location.longitude })
      })
    })
  } catch {
    fallback()
  }
}

deviceButton.addEventListener('click', requestDeviceLocation)
mapPickButton.addEventListener('click', () => {
  locationAttemptId += 1
  deviceButton.disabled = false
  if (pickingTarget) {
    pickingTarget = false
    mapController?.setTargetAreaSelectionMode(false)
    renderTargetPicker()
  }
  pickingStart = !pickingStart
  mapController?.setStartPointSelectionMode(pickingStart)
  startMessageKey = pickingStart ? 'startPickInstruction' : startStatusForSource()
  if (pickingStart) {
    mapReturn = 'request'
    closeDialog(startDialog)
    setSheetMode('map-only')
    mapController?.focus(origin())
  }
  renderStartPicker()
})
resetStartButton.addEventListener('click', () => setStartPoint(null, 'center'))

function setTargetArea(point: MapCoordinate | null): void {
  const wasPicking = pickingTarget
  pickingTarget = false
  mapController?.setTargetAreaSelectionMode(false)
  state.targetArea = point
  targetStatusKey = null
  mapController?.setTargetArea(point ?? undefined)
  clearResults()
  renderTargetPicker()
  updateSettingsSummary()
  if (wasPicking) { setSheetMode('peek'); openSettings() }
}

targetPickButton.addEventListener('click', () => {
  if (pickingStart) {
    pickingStart = false
    mapController?.setStartPointSelectionMode(false)
    startMessageKey = startStatusForSource()
    renderStartPicker()
  }
  pickingTarget = !pickingTarget
  targetStatusKey = null
  mapController?.setTargetAreaSelectionMode(pickingTarget)
  if (pickingTarget) {
    mapReturn = 'settings'
    closeDialog(settingsDialog)
    setSheetMode('map-only')
    mapController?.focus(state.targetArea ?? origin())
  }
  renderTargetPicker()
})
targetResetButton.addEventListener('click', () => setTargetArea(null))

type ValidatedForm = { text: string; group: number; budgetKzt?: number }

function validateForm(surprise = false): ValidatedForm | null {
  budget.setCustomValidity('')
  const text = prompt.value.trim()
  if (!surprise && text.length < 3 && !state.mood && !state.includeEvents) {
    promptError.textContent = t('promptError')
    promptError.hidden = false
    prompt.focus()
    return null
  }
  const group = Number(groupSize.value)
  if (!Number.isInteger(group) || group < 1 || group > 12) {
    groupSizeError.textContent = t('groupError')
    groupSizeError.hidden = false
    openSettings()
    groupSize.focus()
    return null
  }
  if (budget.value.trim() === '') return { text, group }
  const amount = Number(budget.value)
  if (!Number.isInteger(amount) || amount < 0 || amount > 10_000_000) {
    budget.setCustomValidity(t('budgetError'))
    openSettings()
    budget.reportValidity()
    budget.focus()
    return null
  }
  budget.setCustomValidity('')
  return { text, group, budgetKzt: amount }
}

function makeRequest(validated: ValidatedForm, excludePlaceIds: string[] = [], surprise = false): { initData: string; request: WalkRequest & { groupSize: number; mood?: Mood; surprise?: boolean; includeEvents?: boolean } } {
  const usefulText = validated.text.length >= 3 ? validated.text : ''
  const text = surprise
    ? ''
    : usefulText || (state.includeEvents ? eventSearchText[language] : moodSearchText[language][state.mood ?? 'unsure'])
  const request: WalkRequest & { groupSize: number; mood?: Mood; surprise?: boolean; includeEvents?: boolean } = {
    cityId: 'astana',
    scope: state.scope,
    transport: state.transport,
    minutes: state.minutes,
    intents: [],
    text,
    groupSize: validated.group,
    language,
  }
  if (validated.budgetKzt !== undefined) request.budgetKzt = validated.budgetKzt
  if (state.mood && state.scope === 'city') request.mood = state.mood
  if (surprise) request.surprise = true
  if (state.includeEvents && state.scope === 'city') request.includeEvents = true
  if (state.wheelchairOnly) request.accessibility = 'osm_wheelchair_yes'
  if (state.shortLegs && state.scope === 'city' && state.transport === 'walk') request.shortLegs = true
  if (state.gentlePace && state.scope === 'city') request.gentlePace = true
  if (state.microQuest && state.scope === 'city') request.microQuest = true
  if (excludePlaceIds.length) request.excludePlaceIds = excludePlaceIds
  if (state.targetArea && !surprise) request.targetArea = { ...state.targetArea }
  if (state.coordinates) {
    request.latitude = state.coordinates.lat
    request.longitude = state.coordinates.lon
  }
  return { initData: telegram?.initData ?? '', request }
}

function setLoading(value: boolean, loadingLabel = t('loadingRoute')): void {
  state.isLoading = value
  submitButton.disabled = value
  surpriseButton.disabled = value
  planner.setAttribute('aria-busy', String(value))
  submitLabel.textContent = value ? loadingLabel : t('submit')
}

function showLoading(): void {
  results.hidden = false
  results.innerHTML = `<div class="results-heading"><h2>${t('searchingPlaces')}</h2><p>${t('searchDescription')}</p></div><div class="loading-row" aria-hidden="true"><span></span><span></span><span></span></div>`
  const back = document.createElement('button')
  back.type = 'button'
  back.className = 'result-back'
  back.textContent = `← ${redesignCopy[language].back}`
  back.addEventListener('click', goBack)
  results.insertBefore(back, results.firstChild)
  setSheetMode('loading')
  scrollToResults()
}

function showError(message: string, note?: string): void {
  results.hidden = false
  results.replaceChildren()
  const panel = document.createElement('div')
  panel.className = 'message-state error-state'
  panel.setAttribute('role', 'alert')
  const heading = document.createElement('h2')
  heading.textContent = t('routeNotReady')
  const detail = document.createElement('p')
  detail.textContent = message
  appendNodes(panel, heading, detail)
  if (note) {
    const explanation = document.createElement('p')
    explanation.className = 'message-note'
    explanation.textContent = note
    panel.appendChild(explanation)
  }
  if (note && state.wheelchairOnly) {
    const accessibilityMap = createLink(t('accessibilityMap'), 'https://inva.gov.kz/ru#map-box', 'accessibility-map-link')
    if (accessibilityMap) panel.appendChild(accessibilityMap)
  }
  if (telegram?.initData) {
    const again = document.createElement('button')
    again.type = 'button'
    again.className = 'apply-settings'
    again.textContent = redesignCopy[language].retry
    again.addEventListener('click', () => {
      if (state.isLoading) return
      const surprise = Boolean(lastRequest?.surprise)
      const validated = validateForm(surprise)
      if (validated) void submitRecommendation(validated, surprise)
    })
    panel.appendChild(again)
  } else {
    const open = createLink(redesignCopy[language].telegramOpen, 'https://t.me/smart_city_ryadombot?startapp', 'route-link')
    if (open) panel.appendChild(open)
  }
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.className = 'edit-route-button'
  retry.textContent = t('edit')
  retry.addEventListener('click', () => {
    setSheetMode('expanded')
    prompt.focus()
  })
  panel.appendChild(retry)
  results.appendChild(panel)
  setSheetMode('results')
  scrollToResults()
}

function showNoResults(): void {
  results.hidden = false
  results.replaceChildren()
  const panel = document.createElement('div')
  panel.className = 'message-state no-results-state'
  panel.setAttribute('role', 'status')
  const heading = document.createElement('h2')
  heading.textContent = t('routeNotReady')
  const detail = document.createElement('p')
  detail.textContent = t('noRouteCoverage')
  const suggestion = document.createElement('p')
  suggestion.className = 'message-note'
  suggestion.textContent = t(state.targetArea ? 'noRouteTargetHint' : 'noRouteGeneralHint')
  appendNodes(panel, heading, detail, suggestion)
  if (state.wheelchairOnly) {
    const accessibilityNote = document.createElement('p')
    accessibilityNote.className = 'message-note'
    accessibilityNote.textContent = t('noRouteAccessibilityHint')
    panel.appendChild(accessibilityNote)
    const accessibilityMap = createLink(t('accessibilityMap'), 'https://inva.gov.kz/ru#map-box', 'accessibility-map-link')
    if (accessibilityMap) panel.appendChild(accessibilityMap)
  }
  const actions = document.createElement('div')
  actions.className = 'no-results-actions'
  if (state.targetArea) {
    const retryWithoutTarget = document.createElement('button')
    retryWithoutTarget.type = 'button'
    retryWithoutTarget.className = 'retry-without-target'
    retryWithoutTarget.textContent = t('retryWithoutTarget')
    retryWithoutTarget.addEventListener('click', () => {
      setTargetArea(null)
      planner.requestSubmit()
    })
    actions.appendChild(retryWithoutTarget)
  }
  const edit = document.createElement('button')
  edit.type = 'button'
  edit.className = 'edit-route-button'
  edit.textContent = t('edit')
  edit.addEventListener('click', () => setSheetMode('expanded'))
  actions.appendChild(edit)
  panel.appendChild(actions)
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
  return new Intl.DateTimeFormat(language === 'kk' ? 'kk-KZ' : language === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
}

type VenueDetailKind = 'hours' | 'menu' | 'feature' | 'accessibility' | 'booking'
type VisibleVenueDetail = { claim: string; sourceUrl: string; checkedAt?: string; kind?: VenueDetailKind }

const venueDetailCopy: Record<Language, {
  heading: string
  checked: string
  source: string
  kinds: Record<VenueDetailKind | 'other', string>
}> = {
  ru: {
    heading: 'Сведения о месте', checked: 'Источник проверен {date}', source: 'Источник: {host} ↗',
    kinds: { hours: 'Часы работы', menu: 'Меню', feature: 'Особенности', accessibility: 'Доступность', booking: 'Бронирование', other: 'Подробности' },
  },
  kk: {
    heading: 'Орын туралы мәлімет', checked: 'Дереккөз {date} тексерілді', source: 'Дереккөз: {host} ↗',
    kinds: { hours: 'Жұмыс уақыты', menu: 'Мәзір', feature: 'Ерекшеліктер', accessibility: 'Қолжетімділік', booking: 'Брондау', other: 'Толығырақ' },
  },
  en: {
    heading: 'About this place', checked: 'Source checked {date}', source: 'Source: {host} ↗',
    kinds: { hours: 'Opening hours', menu: 'Menu', feature: 'Features', accessibility: 'Accessibility', booking: 'Booking', other: 'Details' },
  },
}

function visibleVenueDetails(item: Recommendation): VisibleVenueDetail[] {
  if (!Array.isArray(item.evidence)) return []
  const details: VisibleVenueDetail[] = []
  const seen = new Set<string>()
  for (const entry of item.evidence) {
    if (!entry || typeof entry.claim !== 'string' || typeof entry.sourceUrl !== 'string') continue
    const claim = entry.claim.trim()
    const sourceUrl = safeUrl(entry.sourceUrl)
    if (!claim || !sourceUrl) continue
    const kind = ['hours', 'menu', 'feature', 'accessibility', 'booking'].includes(entry.kind ?? '')
      ? entry.kind : undefined
    const key = `${claim}\n${sourceUrl}`
    if (seen.has(key)) continue
    seen.add(key)
    details.push({ claim, sourceUrl, kind, checkedAt: entry.checkedAt })
    if (details.length === 4) break
  }
  return details
}

function createVenueDetailsBlock(details: VisibleVenueDetail[]): HTMLElement | null {
  if (!details.length) return null
  const copy = venueDetailCopy[language]
  const section = document.createElement('section')
  section.className = 'place-evidence'
  const heading = document.createElement('h4')
  heading.textContent = copy.heading
  const list = document.createElement('div')
  list.className = 'evidence-list'
  for (const detail of details) {
    const row = document.createElement('div')
    row.className = 'evidence-row'
    const kind = document.createElement('span')
    kind.className = 'evidence-kind'
    kind.textContent = copy.kinds[detail.kind ?? 'other']
    const claim = document.createElement('p')
    claim.className = 'evidence-claim'
    claim.textContent = detail.claim
    const meta = document.createElement('div')
    meta.className = 'evidence-meta'
    const checkedAt = typeof detail.checkedAt === 'string' ? formatPriceDate(detail.checkedAt) : null
    if (checkedAt) {
      const checked = document.createElement('span')
      checked.textContent = copy.checked.replace('{date}', checkedAt)
      meta.appendChild(checked)
    }
    const host = new URL(detail.sourceUrl).hostname.replace(/^www\./, '')
    const link = createLink(copy.source.replace('{host}', host), detail.sourceUrl, 'evidence-link')
    if (link) meta.appendChild(link)
    appendNodes(row, kind, claim, meta)
    list.appendChild(row)
  }
  appendNodes(section, heading, list)
  return section
}

function createPriceBlock(item: Recommendation): HTMLElement | null {
  const evidence = item.priceEvidence
  if (!evidence || !safeUrl(evidence.sourceUrl) || !Number.isFinite(evidence.minKzt) || evidence.minKzt < 0) return null
  const checkedAt = formatPriceDate(evidence.checkedAt)
  if (!checkedAt) return null
  if (evidence.qualifier === 'range' && (!Number.isFinite(evidence.maxKzt) || (evidence.maxKzt ?? 0) < evidence.minKzt)) return null

  const unit = evidence.unit === 'entry' ? t('entry') : evidence.unit === 'average_bill' ? t('averageBill') : t('oneItem')
  const amount = evidence.qualifier === 'range'
    ? `${formatKzt(evidence.minKzt)}–${formatKzt(evidence.maxKzt!)}`
    : evidence.qualifier === 'from' ? t('fromPrice', { amount: formatKzt(evidence.minKzt) }) : formatKzt(evidence.minKzt)
  const block = document.createElement('div')
  block.className = 'place-price'
  const value = document.createElement('strong')
  value.className = 'price-value'
  value.textContent = `${unit}: ${amount}`
  const meta = document.createElement('div')
  meta.className = 'price-meta'
  const date = document.createElement('span')
  date.textContent = t('checked', { date: checkedAt })
  const source = createLink(t('priceSource'), evidence.sourceUrl, 'price-source')
  appendNodes(meta, date)
  if (source) meta.appendChild(source)
  appendNodes(block, value, meta)
  if (evidence.unit === 'item') {
    const note = document.createElement('span')
    note.className = 'price-note'
    note.textContent = t('itemPriceNote')
    block.appendChild(note)
  }
  const plannedBudget = Number(budget.value)
  if (Number.isFinite(plannedBudget) && plannedBudget > 0 && evidence.minKzt > plannedBudget
    && evidence.unit !== 'item') {
    const note = document.createElement('span')
    note.className = 'price-note'
    note.textContent = evidence.unit === 'entry' ? t('entryOverBudget') : t('billOverBudget')
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
  meta.textContent = categoryLabel(item.category) || (item.kind === 'trip' ? t('trip') : t('stop'))
  const name = document.createElement('strong')
  name.textContent = item.name
  const text = document.createElement('div')
  appendNodes(text, meta, name)
  preview.appendChild(text)
  const source = createLink(t('source'), item.sourceUrl, 'preview-source')
  if (source) preview.appendChild(source)
  preview.hidden = false
  results.querySelectorAll<HTMLElement>('.place-card').forEach((card) => {
    card.classList.toggle('is-map-selected', card.dataset.id === item.id)
  })
  if (shell.dataset.sheet === 'peek-results' || shell.dataset.sheet === 'map-only') setSheetMode('results')
}

function createStopCard(item: Recommendation, index: number): HTMLElement {
  const venueDetails = visibleVenueDetails(item)
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
  category.textContent = categoryLabel(item.category) || (item.kind === 'trip' ? t('trip') : t('place'))
  const mapButton = document.createElement('button')
  mapButton.type = 'button'
  mapButton.className = 'place-map-button'
  mapButton.textContent = t('onMap')
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
  why.setAttribute('aria-label', redesignCopy[language].why)
  const facts = document.createElement('div')
  facts.className = 'place-facts'
  const priceBlock = createPriceBlock(item)
  if (typeof item.travelMinutesApprox === 'number') addFact(facts, t('travelApprox', { time: formatMinutes(item.travelMinutesApprox), mode: travelModeLabel(item.travelMode) }))
  else if (typeof item.walkMinutes === 'number') addFact(facts, `${redesignCopy[language][index === 0 ? 'fromStart' : 'fromPrevious']}: ${t('travelApprox', { time: formatMinutes(item.walkMinutes), mode: t('walkLower') })}`)
  else addFact(facts, t('unknownTravel'))
  if (typeof item.visitMinutes === 'number') addFact(facts, t('onSiteApprox', { time: formatMinutes(item.visitMinutes) }))
  if (item.estimatedCostKzt) {
    addFact(facts, t('roadCost', { min: formatKzt(item.estimatedCostKzt.min), max: formatKzt(item.estimatedCostKzt.max) }))
  }
  const unknowns = document.createElement('ul')
  unknowns.className = 'place-unknowns'
  const missing = [
    !item.openingHours && !venueDetails.some((detail) => detail.kind === 'hours') ? redesignCopy[language].hoursUnknown : '',
    !priceBlock ? redesignCopy[language].priceUnknown : '',
    !item.wheelchairTag && !venueDetails.some((detail) => detail.kind === 'accessibility') ? redesignCopy[language].accessUnknown : '',
  ].filter(Boolean)
  for (const text of missing) {
    const row = document.createElement('li')
    row.textContent = text
    unknowns.appendChild(row)
  }
  if (item.openingHours && item.hoursStatus) addFact(facts, item.hoursStatus)
  let accessibilityTag: HTMLAnchorElement | null = null
  if (item.wheelchairTag === 'yes' || item.wheelchairTag === 'limited' || item.wheelchairTag === 'no') {
    const label = item.wheelchairTag === 'yes' ? t('wheelchairBadgeYes')
      : item.wheelchairTag === 'limited' ? t('wheelchairBadgeLimited') : t('wheelchairBadgeNo')
    accessibilityTag = createLink(label, item.sourceUrl, 'accessibility-tag')
  }
  const action = document.createElement('div')
  action.className = 'place-action'
  const actionLabel = document.createElement('span')
  actionLabel.textContent = t('whatToDo')
  const actionText = document.createElement('p')
  actionText.textContent = item.action
  appendNodes(action, actionLabel, actionText)
  if (item.actionSource === 'ai') {
    const caveat = document.createElement('small')
    caveat.textContent = t('aiCaveat')
    action.appendChild(caveat)
  }
  const evidenceBlock = createVenueDetailsBlock(venueDetails)
  const links = document.createElement('div')
  links.className = 'place-links'
  const venueWebsiteLabel = item.sourceProvider === 'OpenStreetMap' ? t('osmWebsite')
    : language === 'kk' ? 'Орын сайты ↗' : language === 'en' ? 'Venue website ↗' : 'Сайт места ↗'
  for (const [label, value, className] of [
    [t('directions'), item.routeUrl, 'map-link'],
    [venueWebsiteLabel, item.venueWebsite, 'source-link'],
    [t('placeSource'), item.sourceUrl, 'source-link'],
    [t('timeSource'), item.travelSourceUrl, 'source-link'],
    [t('costSource'), item.costSourceUrl, 'source-link'],
  ] as const) {
    const link = createLink(label, value, className)
    if (link) links.appendChild(link)
  }
  if (item.sourceProvider === '2GIS') {
    const attribution = createLink('2ГИС', 'https://dev.2gis.ru', 'source-link')
    if (attribution) links.appendChild(attribution)
  }
  if (item.sourceProvider === 'Overture Maps') {
    const dataset = typeof item.sourceDataset === 'string' && /^[A-Za-z ]{2,32}$/.test(item.sourceDataset)
      ? ` · ${item.sourceDataset}` : ''
    const attribution = createLink(`Overture Maps${dataset}`,
      'https://docs.overturemaps.org/attribution/', 'source-link')
    if (attribution) links.appendChild(attribution)
  }
  appendNodes(card, top, name, why, facts)
  if (accessibilityTag) card.appendChild(accessibilityTag)
  if (priceBlock) card.appendChild(priceBlock)
  card.appendChild(action)
  if (unknowns.childElementCount) card.appendChild(unknowns)
  const details = document.createElement('details')
  details.className = 'place-details'
  const detailsTitle = document.createElement('summary')
  detailsTitle.textContent = redesignCopy[language].details
  details.appendChild(detailsTitle)
  const detailsBody = document.createElement('div')
  detailsBody.className = 'place-details-body'
  if (evidenceBlock) detailsBody.appendChild(evidenceBlock)
  if (item.hoursStatus && !venueDetails.some((detail) => detail.kind === 'hours')) {
    const note = document.createElement('p')
    note.textContent = item.hoursStatus
    detailsBody.appendChild(note)
  }
  detailsBody.appendChild(links)
  details.appendChild(detailsBody)
  mountDisclosure(details)
  card.appendChild(details)
  if (state.scope === 'city' && lastRequest && currentRoute) card.appendChild(createStopSwap(item, index))
  return card
}

function createStopSwap(item: Recommendation, index: number): HTMLElement {
  const container = document.createElement('div')
  container.className = 'stop-swap'
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'stop-swap-toggle'
  toggle.textContent = t('swap')
  toggle.setAttribute('aria-expanded', 'false')
  const optionId = `swap-options-${index}`
  toggle.setAttribute('aria-controls', optionId)
  const options = document.createElement('div')
  options.id = optionId
  options.className = 'stop-swap-options'
  options.hidden = true
  const heading = document.createElement('p')
  heading.textContent = t('swapReasons')
  options.appendChild(heading)
  const status = document.createElement('p')
  status.className = 'stop-swap-status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  for (const reason of ['far', 'expensive', 'visited', 'other'] as SwapReason[]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = t(swapReasonKeys[reason])
    button.addEventListener('click', () => { void replaceStop(item, index, reason, options, status) })
    options.appendChild(button)
  }
  toggle.addEventListener('click', () => {
    options.hidden = !options.hidden
    toggle.setAttribute('aria-expanded', String(!options.hidden))
    if (!options.hidden) options.querySelector('button')?.focus()
  })
  appendNodes(container, toggle, options, status)
  return container
}

async function replaceStop(item: Recommendation, index: number, reason: SwapReason, options: HTMLElement, status: HTMLElement): Promise<void> {
  if (state.isLoading || !currentRoute || !lastRequest) return
  const originalRoute = currentRoute
  const originalResponse = currentResponse
  const originalRouteIndex = currentRouteIndex
  const originalRequest = lastRequest
  if (originalRoute.stops[index]?.id !== item.id) return
  if (!telegram?.initData) {
    status.textContent = t('openInTelegram')
    return
  }
  setLoading(true, t('swapping'))
  options.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true })
  status.textContent = t('swapping')
  const controller = new AbortController()
  const version = ++requestVersion
  activeRecommendation = controller
  const timeout = window.setTimeout(() => controller.abort(), 45_000)
  try {
    const response = await fetch('/api/replace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
      body: JSON.stringify({
        initData: telegram.initData,
        request: originalRequest,
        route: {
          title: originalRoute.title,
          summary: originalRoute.summary,
          routeUrl: originalRoute.routeUrl,
          stops: originalRoute.stops.map((stop) => ({ id: stop.id })),
        },
        stopIndex: index,
        reason,
        excludePlaceIds: recentExcludedPlaceIds(),
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error(t('telegramExpired'))
      if (response.status === 429) throw new Error(t('rateLimit'))
      if (response.status === 404 || response.status === 409 || response.status === 422) {
        status.textContent = t('swapNoAlternative')
        return
      }
      throw new Error(t('swapError'))
    }
    const data: RouteResponse = await response.json()
    if (version !== requestVersion || currentRoute !== originalRoute) return
    if (data.replacementUnchanged) {
      status.textContent = t('swapNoAlternative')
      return
    }
    const updated = data.routes?.[0]
    if (!updated || updated.stops.length !== originalRoute.stops.length
      || updated.stops[index]?.id === item.id
      || originalRoute.stops.some((stop, stopIndex) => stopIndex !== index && updated.stops[stopIndex]?.id !== stop.id)) {
      status.textContent = t('swapNoAlternative')
      return
    }
    seenPlaceIds.add(item.id)
    const nextResponse: RouteResponse = originalResponse?.routes
      ? {
        ...originalResponse,
        summary: data.summary,
        note: data.note ?? originalResponse.note,
        headingAdjusted: data.headingAdjusted ?? originalResponse.headingAdjusted,
        routes: originalResponse.routes.map((candidate) => candidate === originalRoute ? updated : candidate),
      }
      : data
    showResults(nextResponse, originalRouteIndex)
    const changed = results.querySelectorAll<HTMLElement>('.place-card h3')[index]
    if (changed) {
      changed.tabIndex = -1
      changed.focus({ preventScroll: true })
      changed.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    }
    const announcement = document.createElement('p')
    announcement.className = 'swap-announcement'
    announcement.setAttribute('role', 'status')
    announcement.textContent = t('swapSuccess')
    results.querySelector('.results-heading')?.appendChild(announcement)
  } catch (error) {
    if (version !== requestVersion || currentRoute !== originalRoute) return
    status.textContent = error instanceof DOMException && error.name === 'AbortError'
      ? t('searchTimeoutShort') : error instanceof Error ? error.message : t('swapError')
  } finally {
    window.clearTimeout(timeout)
    if (version === requestVersion) {
      activeRecommendation = null
      setLoading(false)
      options.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = false })
    }
  }
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
    .filter((id) => /^(?:osm:(?:node|way|relation):[1-9]\d{0,12}|overture:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|2gis:[1-9]\d{0,20})$/.test(id))
    .slice(-36)
}

function createRouteDirection(from: MapCoordinate, to: MapCoordinate): HTMLElement {
  const distance = distanceKm(from, to)
  const bearing = bearingDegrees(from, to)
  const direction = compassNames[language][Math.round(bearing / 45) % 8]
  const card = document.createElement('div')
  card.className = 'route-direction'
  const arrow = document.createElement('span')
  arrow.className = 'route-direction-arrow'
  arrow.setAttribute('aria-hidden', 'true')
  arrow.style.setProperty('--bearing', `${bearing}deg`)
  arrow.textContent = '↑'
  const copy = document.createElement('div')
  copy.className = 'route-direction-copy'
  const label = document.createElement('span')
  label.textContent = t('routeDirectionTitle')
  const value = document.createElement('strong')
  value.textContent = distance < .4 ? t('targetNear') : t('targetToward', { direction })
  const detail = document.createElement('small')
  if (distance < .4) detail.textContent = t('routeDirectionNear')
  else {
    const rounded = distance < 10 ? Math.round(distance * 10) / 10 : Math.round(distance)
    const formatted = new Intl.NumberFormat(language === 'kk' ? 'kk-KZ' : language === 'en' ? 'en-US' : 'ru-RU',
      { maximumFractionDigits: 1 }).format(rounded)
    detail.textContent = `${t('targetDistance', { distance: formatted })}. ${t('routeDirectionHint')}`
  }
  appendNodes(copy, label, value, detail)
  appendNodes(card, arrow, copy)
  return card
}

type EventMoment = { date: Date; label: string; dateOnly: boolean }

function formatEventMoment(value: string): EventMoment | null {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null
  const date = new Date(dateOnly ? `${value}T12:00:00Z` : value)
  if (!Number.isFinite(date.getTime()) || dateOnly && date.toISOString().slice(0, 10) !== value) return null
  const locale = language === 'kk' ? 'kk-KZ' : language === 'en' ? 'en-US' : 'ru-RU'
  const label = new Intl.DateTimeFormat(locale, dateOnly
    ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
    : { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' }).format(date)
  return { date, label, dateOnly }
}

function createEventsSection(events: LiveEvent[] | undefined, requested: boolean,
  status?: RouteResponse['eventsStatus']): HTMLElement | null {
  const copy = eventCopy[language]
  const visible = (Array.isArray(events) ? events : []).filter((event) =>
    event && typeof event.title === 'string' && event.title.trim()
    && typeof event.sourceUrl === 'string' && safeUrl(event.sourceUrl)
    && typeof event.startsAt === 'string' && formatEventMoment(event.startsAt)
    && typeof event.checkedAt === 'string' && formatEventMoment(event.checkedAt))
  if (!visible.length && !requested) return null
  const section = document.createElement('section')
  section.className = 'live-events'
  section.setAttribute('aria-labelledby', 'liveEventsHeading')
  const heading = document.createElement('h3')
  heading.id = 'liveEventsHeading'
  heading.textContent = copy.heading
  const intro = document.createElement('p')
  intro.className = 'live-events-intro'
  intro.textContent = copy.intro
  appendNodes(section, heading, intro)
  if (!visible.length) {
    const empty = document.createElement('p')
    empty.className = 'live-events-empty'
    empty.textContent = status === 'unavailable' ? copy.unavailable
      : status === 'partial' ? copy.noEventsPartial
        : lastRequest?.accessibility === 'osm_wheelchair_yes' ? copy.noEventsAccessible
          : lastRequest?.budgetKzt === 0 ? copy.noEventsFree : copy.noEvents
    section.appendChild(empty)
    return section
  }
  if (status === 'partial') {
    const partial = document.createElement('p')
    partial.className = 'live-events-partial'
    partial.textContent = copy.partial
    section.appendChild(partial)
  }
  const list = document.createElement('div')
  list.className = 'live-event-list'
  for (const event of visible.slice(0, 6)) {
    const start = formatEventMoment(event.startsAt)!
    const end = typeof event.endsAt === 'string' ? formatEventMoment(event.endsAt) : null
    const checked = formatEventMoment(event.checkedAt)!
    const card = document.createElement('article')
    card.className = 'live-event-card'
    const category = document.createElement('span')
    category.className = 'live-event-category'
    category.textContent = copy.types[event.category] ?? copy.heading
    const title = document.createElement('h4')
    title.textContent = event.title.trim()
    const when = document.createElement('p')
    when.className = 'live-event-when'
    const time = document.createElement('time')
    time.dateTime = event.startsAt
    time.textContent = end && end.date.getTime() >= start.date.getTime()
      ? `${start.label} – ${end.label}` : start.label
    when.appendChild(time)
    if (!start.dateOnly) {
      const zone = document.createElement('span')
      zone.textContent = ` · ${copy.zone}`
      when.appendChild(zone)
    }
    const venue = document.createElement('p')
    venue.className = 'live-event-venue'
    venue.textContent = copy.venue.replace('{name}', typeof event.venueName === 'string' && event.venueName.trim()
      ? event.venueName.trim() : language === 'kk' ? 'дереккөзден қараңыз' : language === 'en' ? 'see source' : 'уточните в источнике')
    const price = document.createElement('p')
    price.className = 'live-event-price'
    price.textContent = typeof event.priceKzt === 'number' && Number.isFinite(event.priceKzt) && event.priceKzt >= 0
      ? copy.price.replace('{amount}', formatKzt(event.priceKzt)) : copy.priceUnknown
    const sourceName = typeof event.sourceName === 'string' && event.sourceName.trim()
      ? event.sourceName.trim() : new URL(event.sourceUrl).hostname.replace(/^www\./, '')
    const source = createLink(copy.source.replace('{name}', sourceName), event.sourceUrl, 'live-event-source')!
    const checkedLine = document.createElement('p')
    checkedLine.className = 'live-event-checked'
    const checkedTime = document.createElement('time')
    checkedTime.dateTime = event.checkedAt
    checkedTime.textContent = `${copy.checked.replace('{date}', checked.label)}${checked.dateOnly ? '' : ` · ${copy.zone}`}`
    checkedLine.appendChild(checkedTime)
    if (Date.now() - checked.date.getTime() > 24 * 60 * 60 * 1000) {
      const older = document.createElement('span')
      older.className = 'live-event-older'
      older.textContent = copy.older
      checkedLine.appendChild(older)
    }
    const caveat = document.createElement('p')
    caveat.className = 'live-event-caveat'
    caveat.textContent = `${start.dateOnly ? `${copy.noTime} ` : ''}${copy.availability}`
    appendNodes(card, category, title, when, venue, price, source, checkedLine, caveat)
    list.appendChild(card)
  }
  section.appendChild(list)
  return section
}

function showResults(response: RouteResponse, selectedRoute = 0, focusVariant = false): void {
  results.hidden = false
  results.replaceChildren()
  const routes = response.routes?.filter((candidate) => Array.isArray(candidate.stops) && candidate.stops.length > 0) ?? []
  const route = routes[selectedRoute] ?? routes[0]
  const eventsSection = createEventsSection(response.events,
    Boolean(lastRequest?.includeEvents || response.events !== undefined), response.eventsStatus)
  if (!route) {
    currentResponse = response
    currentRoute = null
    currentRouteOrigin = null
    state.stops = []
    mapController?.update([], origin())
    fitButton.hidden = true
    showNoResults()
    if (eventsSection) results.insertBefore(eventsSection, results.firstChild)
    return
  }
  currentResponse = response
  currentRoute = route
  currentRouteIndex = routes[selectedRoute] ? selectedRoute : 0
  rememberShownStops(routes)
  state.stops = route.stops.slice(0, 3)
  const routeOrigin = validPoint(route.origin) ? route.origin : origin()
  const lastStop = state.stops.filter((item): item is Recommendation & MapCoordinate => validPoint(item)).slice(-1)[0]

  const heading = document.createElement('div')
  heading.className = 'results-heading'
  const eyebrow = document.createElement('span')
  eyebrow.className = 'results-eyebrow'
  eyebrow.textContent = stopCount(state.stops.length)
  const title = document.createElement('h2')
  title.textContent = route.title || t('yourRoute')
  const summary = document.createElement('p')
  summary.textContent = route.summary || response.summary
  const back = document.createElement('button')
  back.type = 'button'
  back.className = 'result-back'
  back.textContent = `← ${redesignCopy[language].back}`
  back.addEventListener('click', () => setSheetMode('peek'))
  const context = document.createElement('p')
  context.className = 'result-context'
  context.textContent = `${route.origin?.name || startValue.textContent} · ${settingsSummary.textContent}`
  appendNodes(heading, back, eyebrow, title, context, summary)
  if (response.headingAdjusted) {
    const adjustment = document.createElement('p')
    adjustment.className = 'route-adjustment'
    adjustment.setAttribute('role', 'status')
    adjustment.textContent = t('routeAdjusted')
    heading.appendChild(adjustment)
  }
  if (lastStop && state.targetArea) heading.appendChild(createRouteDirection(routeOrigin, lastStop))
  const timing = document.createElement('div')
  timing.className = 'route-timing'
  const visits = state.stops.every((stop) => typeof stop.visitMinutes === 'number')
    ? state.stops.reduce((sum, stop) => sum + stop.visitMinutes!, 0) : undefined
  const travel = state.transport === 'walk' && state.stops.every((stop) => typeof stop.walkMinutes === 'number')
    ? state.stops.reduce((sum, stop) => sum + stop.walkMinutes!, 0) : undefined
  const total = typeof visits === 'number' && typeof travel === 'number' ? visits + travel : undefined
  for (const [label, minutes] of [[redesignCopy[language].total, total], [redesignCopy[language].travel, travel], [redesignCopy[language].visits, visits]] as const) {
    const metric = document.createElement('div')
    const value = document.createElement('strong')
    value.textContent = typeof minutes === 'number' ? `≈ ${formatMinutes(minutes)}` : redesignCopy[language].unknownTime
    const caption = document.createElement('span')
    caption.textContent = label
    appendNodes(metric, value, caption)
    timing.appendChild(metric)
  }
  heading.appendChild(timing)
  const fullMap = document.createElement('button')
  fullMap.className = 'result-map-button'
  fullMap.type = 'button'
  fullMap.textContent = t('showMap')
  fullMap.addEventListener('click', () => setSheetMode('map-only'))
  heading.appendChild(fullMap)
  const routeLink = createLink(redesignCopy[language].openRoute, route.routeUrl, 'route-link')
  const editButton = document.createElement('button')
  editButton.type = 'button'
  editButton.className = 'edit-route-button'
  editButton.textContent = redesignCopy[language].edit
  editButton.addEventListener('click', () => setSheetMode('expanded'))

  const preview = document.createElement('div')
  preview.id = 'mapPreview'
  preview.className = 'map-preview'
  preview.setAttribute('role', 'status')
  preview.hidden = true
  heading.appendChild(preview)
  results.appendChild(heading)

  if (state.wheelchairOnly) {
    const disclosure = document.createElement('aside')
    disclosure.className = 'accessibility-disclosure'
    const disclosureTitle = document.createElement('h3')
    disclosureTitle.textContent = t('accessibilityResultTitle')
    const disclosureText = document.createElement('p')
    disclosureText.textContent = t('accessibilityResultNote')
    appendNodes(disclosure, disclosureTitle, disclosureText)
    const accessibilityMap = createLink(t('accessibilityMap'), 'https://inva.gov.kz/ru#map-box', 'accessibility-map-link')
    if (accessibilityMap) disclosure.appendChild(accessibilityMap)
    results.appendChild(disclosure)
  }

  const completedMissions = new Set<number>()
  let missionProgress: HTMLElement | null = null
  if (state.microQuest && state.scope === 'city') {
    const missionIntro = document.createElement('section')
    missionIntro.className = 'mission-intro'
    const missionTitle = document.createElement('h3')
    missionTitle.textContent = t('questResultTitle')
    missionProgress = document.createElement('p')
    missionProgress.className = 'mission-progress'
    missionProgress.setAttribute('role', 'status')
    missionProgress.setAttribute('aria-live', 'polite')
    missionProgress.textContent = t('questProgress', { done: 0, total: state.stops.length })
    appendNodes(missionIntro, missionTitle, missionProgress)
    results.appendChild(missionIntro)
  }

  if (routes.length > 1) {
    const variantSection = document.createElement('section')
    variantSection.className = 'route-variants'
    const variantHeading = document.createElement('h3')
    variantHeading.textContent = state.scope === 'day_trip' ? t('tripVariants') : t('routeVariants')
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
      number.textContent = `${state.scope === 'day_trip' ? t('trip') : t('route')} ${index + 1}`
      const name = document.createElement('span')
      name.className = 'variant-name'
      name.textContent = state.scope === 'city'
        ? candidate.stops[0]?.name || `${t('variant')} ${index + 1}`
        : candidate.title || candidate.stops[0]?.name || `${t('variant')} ${index + 1}`
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
  mapNote.textContent = geometryIsRoad ? t('roadLine') : t('dottedLine')
  const stopPanel = document.createElement('section')
  stopPanel.className = 'route-stops'
  const stopTitle = document.createElement('h3')
  stopTitle.textContent = t('stopsOrder')
  const list = document.createElement('div')
  list.className = 'place-list'
  state.stops.forEach((item, index) => {
    const card = createStopCard(item, index)
    if (missionProgress) {
      const mission = document.createElement('div')
      mission.className = 'place-mission'
      const source = document.createElement('span')
      source.className = 'mission-source'
      source.textContent = t('questSource')
      const description = document.createElement('p')
      description.textContent = index === 0 ? t('questFirst')
        : index === state.stops.length - 1 ? t('questLast') : t('questMiddle')
      const mark = document.createElement('button')
      mark.type = 'button'
      mark.className = 'mission-mark'
      mark.textContent = t('questMark')
      mark.setAttribute('aria-pressed', 'false')
      mark.addEventListener('click', () => {
        if (completedMissions.has(index)) completedMissions.delete(index)
        else completedMissions.add(index)
        const done = completedMissions.has(index)
        mark.classList.toggle('is-done', done)
        mark.setAttribute('aria-pressed', String(done))
        mark.textContent = t(done ? 'questDone' : 'questMark')
        if (missionProgress) missionProgress.textContent = t('questProgress', { done: completedMissions.size, total: state.stops.length })
      })
      appendNodes(mission, source, description, mark)
      card.appendChild(mission)
    }
    list.appendChild(card)
  })
  appendNodes(stopPanel, stopTitle, list, mapNote)
  results.appendChild(stopPanel)
  if (eventsSection) results.appendChild(eventsSection)
  const resultActions = document.createElement('div')
  resultActions.className = 'result-actions'
  if (routeLink) resultActions.appendChild(routeLink)
  resultActions.appendChild(editButton)
  results.appendChild(resultActions)
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
    moreButton.textContent = t('moreIdeas')
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
  const surpriseRequest = lastRequest && 'surprise' in lastRequest && lastRequest.surprise
    ? { ...lastRequest, excludePlaceIds: recentExcludedPlaceIds() } : null
  const validated = surpriseRequest ? null : validateForm()
  if (!surpriseRequest && !validated) return
  if (!telegram?.initData) {
    status.textContent = t('openInTelegram')
    return
  }
  setLoading(true, t('loadingMore'))
  button.disabled = true
  button.textContent = t('searchingIdeas')
  status.textContent = t('otherPlaces')
  const controller = new AbortController()
  const version = ++requestVersion
  activeRecommendation = controller
  const timeout = window.setTimeout(() => controller.abort(), 45_000)
  let exhausted = false
  try {
    const payload = surpriseRequest
      ? { initData: telegram.initData, request: surpriseRequest }
      : makeRequest(validated!, recentExcludedPlaceIds())
    const response = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error(t('telegramExpired'))
      if (response.status === 429) throw new Error(t('rateLimit'))
      throw new Error(t('newIdeasError'))
    }
    const data: RouteResponse = await response.json()
    if (version !== requestVersion) return
    if (!data || !Array.isArray(data.routes)) throw new Error(t('incomplete'))
    const hasStops = data.routes.some((route) => Array.isArray(route.stops) && route.stops.length > 0)
    if (!hasStops) {
      exhausted = true
      status.textContent = t('noNewPlaces')
      return
    }
    lastRequest = payload.request
    showResults(data)
    const newHeading = results.querySelector<HTMLHeadingElement>('.results-heading h2')
    if (newHeading) {
      newHeading.tabIndex = -1
      newHeading.focus({ preventScroll: true })
    }
  } catch (error) {
    if (version !== requestVersion) return
    status.textContent = error instanceof DOMException && error.name === 'AbortError'
      ? t('searchTimeoutShort')
      : error instanceof Error ? error.message : t('newIdeasRetry')
  } finally {
    window.clearTimeout(timeout)
    if (version === requestVersion) {
      activeRecommendation = null
      setLoading(false)
      if (button.isConnected) {
        button.disabled = exhausted
        button.textContent = t('moreIdeas')
      }
    }
  }
}

async function submitRecommendation(validated: ValidatedForm, surprise = false): Promise<void> {
  requiredElement<HTMLElement>('#languageNotice').hidden = true
  if (state.isLoading) return
  if (!telegram?.initData) {
    showError(t('telegramRequired'))
    return
  }
  blurActiveEditor()
  clearResults()
  showLoading()
  setLoading(true)
  const controller = new AbortController()
  const version = ++requestVersion
  activeRecommendation = controller
  const timeout = window.setTimeout(() => controller.abort(), 45_000)
  try {
    const payload = makeRequest(validated, [], surprise)
    lastRequest = payload.request
    const response = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error(t('telegramInvalid'))
      if (response.status === 429) throw new Error(t('rateLimit'))
      throw new Error(t('serviceError'))
    }
    const data: RouteResponse = await response.json()
    if (version !== requestVersion) return
    if (!data || typeof data.summary !== 'string' || !Array.isArray(data.routes)) {
      throw new Error(t('incomplete'))
    }
    lastRequest = payload.request
    showResults(data)
  } catch (error) {
    if (version !== requestVersion) return
    showError(error instanceof DOMException && error.name === 'AbortError'
      ? t('searchTimeout')
      : error instanceof Error ? error.message : t('unknownError'))
  } finally {
    window.clearTimeout(timeout)
    if (version === requestVersion) {
      activeRecommendation = null
      setLoading(false)
    }
  }
}

planner.addEventListener('submit', (event) => {
  event.preventDefault()
  if (state.isLoading) return
  const validated = validateForm()
  if (validated) void submitRecommendation(validated)
})

surpriseButton.addEventListener('click', () => {
  if (state.isLoading) return
  if (state.scope !== 'city') setScope('city')
  const validated = validateForm(true)
  if (validated) void submitRecommendation(validated, true)
})

const mapStage = requiredElement<HTMLElement>('.map-stage')
const routeSheet = requiredElement<HTMLElement>('#routeSheet')
mapController = mountRecommendationsMap(requiredElement<HTMLElement>('#map'), {
  markers: [],
  center: ASTANA_CENTER,
  startPoint: origin(),
  language,
  onSelect: (id) => {
    const item = state.stops.find((stop) => stop.id === id)
    if (item) showMapPreview(item)
  },
  onStartPointSelect: (point) => {
    if (!pickingStart) return
    if (!insideAstana(point)) {
      startMessageKey = 'startOutside'
      renderStartPicker()
      return
    }
    setStartPoint(point, 'map')
  },
  onTargetAreaSelect: (point) => {
    if (!pickingTarget) return
    if (state.scope === 'city' && !insideAstana(point)) {
      targetStatusKey = 'targetOutside'
      renderTargetPicker()
      return
    }
    if (state.scope === 'day_trip' && !insideTripPlanningArea(point)) {
      targetStatusKey = 'targetFar'
      renderTargetPicker()
      return
    }
    setTargetArea(point)
  },
})
routeDrawer = mountRouteDrawer({
  shell, handle: sheetHandle, scroll: sheetScroll,
  onPosition: renderDrawerPosition,
  onSettled: () => syncMapInset(),
})
applyTranslations()

function syncMapInset(): void {
  if (shell.classList.contains('is-drawer-moving') || shell.classList.contains('is-drawer-dragging')) return
  const stage = mapStage.getBoundingClientRect()
  const sheet = routeSheet.getBoundingClientRect()
  const isBottomSheet = window.matchMedia('(max-width: 760px)').matches
  mapController?.setBottomInset(isBottomSheet ? Math.max(0, stage.bottom - sheet.top) : 0)
}
const sheetObserver = new ResizeObserver(syncMapInset)
sheetObserver.observe(routeSheet)
window.addEventListener('resize', syncMapInset)
requestAnimationFrame(syncMapInset)

let fullViewportHeight = telegram?.viewportStableHeight || window.visualViewport?.height || window.innerHeight
function syncVisualViewport(event?: { isStateStable?: boolean }): void {
  const visibleHeight = window.visualViewport?.height ?? telegram?.viewportHeight ?? window.innerHeight
  if (!Number.isFinite(visibleHeight) || visibleHeight <= 0) return
  const editing = isTextEditor(document.activeElement)
  const stable = telegram?.viewportStableHeight
  if (stable && stable > 0 && (!editing || stable > fullViewportHeight)) fullViewportHeight = stable
  else if (!editing && event?.isStateStable !== false) fullViewportHeight = visibleHeight
  const keyboardOpen = editing && fullViewportHeight - visibleHeight > 120
  const usableHeight = editing ? Math.min(visibleHeight, stable || fullViewportHeight) : fullViewportHeight
  shell.style.setProperty('--stable-height', `${fullViewportHeight}px`)
  shell.style.setProperty('--view-height', `${usableHeight}px`)
  for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
    const inset = Math.max(0, telegram?.safeAreaInset?.[edge] ?? 0) + Math.max(0, telegram?.contentSafeAreaInset?.[edge] ?? 0)
    shell.style.setProperty(`--app-safe-${edge}`, `${keyboardOpen && edge === 'bottom' ? 0 : inset}px`)
  }
  shell.classList.toggle('is-keyboard-open', editing)
  routeDrawer?.refresh()
  if (currentRoute && !pickingStart && !pickingTarget && shell.dataset.sheet === 'map-only') {
    shell.dataset.screen = routeDrawer?.active ? 'result' : 'map'
    results.hidden = !routeDrawer?.active
  }
  syncMapInset()
  if (keyboardOpen && isTextEditor(document.activeElement)) {
    document.activeElement.scrollIntoView({ block: 'nearest' })
  }
}
window.visualViewport?.addEventListener('resize', () => syncVisualViewport())
window.addEventListener('resize', () => syncVisualViewport())
document.addEventListener('focusin', () => syncVisualViewport())
document.addEventListener('focusout', () => window.setTimeout(() => syncVisualViewport(), 120))
telegram?.onEvent?.('viewportChanged', syncVisualViewport)
if (telegram?.isVersionAtLeast?.('8.0')) {
  telegram.onEvent?.('safeAreaChanged', () => syncVisualViewport())
  telegram.onEvent?.('contentSafeAreaChanged', () => syncVisualViewport())
}
syncVisualViewport()
launchScreen.dismiss()

recenterButton.addEventListener('click', () => mapController?.focus(currentRouteOrigin ?? origin()))
fitButton.addEventListener('click', () => mapController?.fit())
