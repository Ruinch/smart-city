import type { Recommendation, WalkRequest } from '../shared/types'
import { ASTANA_CENTER, insideAstana } from '../shared/astana'
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

const telegram = window.Telegram?.WebApp
const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing application root')

type Language = 'ru' | 'kk' | 'en'
const languageNames: Record<Language, string> = { ru: 'Русский', kk: 'Қазақша', en: 'English' }
const ruMessages = {
  skip: 'К содержимому', mapRegion: 'Карта Астаны и маршрута', map: 'Карта Астаны', brand: 'Рядом — маршруты из Астаны', astana: 'Астана', mapActions: 'Управление картой', recenter: 'Показать начало маршрута', fit: 'Показать весь маршрут', osm: '© участники OpenStreetMap', license: 'Лицензия', data: 'О данных', planner: 'Планировщик маршрута', expandPanel: 'Развернуть панель', collapsePanel: 'Свернуть панель', expandRoute: 'Развернуть маршрут', collapseRoute: 'Свернуть маршрут', heading: 'Куда хочется?', subtitle: 'Расскажите, какой вечер или прогулку вы задумали.', backRoute: '← К маршруту', interest: 'Что вам интересно', promptHint: 'Опишите настроение, места и детали своими словами.', promptPlaceholder: 'Например, тихое кафе с книгой или танцы до ночи', examples: 'Примеры запросов', exampleClub: 'Клуб и танцы', exampleClubPrompt: 'Хочу в клуб: музыка, танцы и движная ночь', exampleCoffee: 'Кофе и книга', exampleCoffeePrompt: 'Тихое кафе, где можно попить кофе и почитать книгу', exampleFriends: 'С друзьями', exampleFriendsPrompt: 'Прогулка с друзьями по интересным местам Астаны', where: 'Где искать', whereRoute: 'Где искать маршрут', inAstana: 'В Астане', fromCity: 'Поездка из города', duration: 'Сколько времени есть', durationAria: 'Время вместе с дорогой', transport: 'Как доберётесь', transportAria: 'Способ передвижения', budget: 'Бюджет на человека, ₸', noLimit: 'Без ограничения', budgetHint: 'Цены многих мест неизвестны. 0 ₸ уберёт кафе, клубы и магазины, но бесплатность оставшихся мест не проверена.', group: 'Сколько вас будет', groupHint: 'От 1 до 12 человек.', locationButton: 'Взять мою геопозицию', locationDefault: 'Без геопозиции начнём от центра Астаны.', submit: 'Составить маршрут', readyRoute: 'Готовый маршрут', language: 'Язык интерфейса', fromAstana: 'Из Астаны', allDay: 'Весь день', walk: 'Пешком', transit: 'Транспорт', car: 'На машине', walkLower: 'пешком', transitLower: 'на транспорте', carLower: 'на машине', perPerson: 'на чел.', personOne: 'человек', personMany: 'чел.', stopsOne: 'остановка', stopsFew: 'остановки', stopsMany: 'остановок', hoursShort: 'ч', minutesShort: 'мин', tripTransportHint: 'Для поездок из Астаны пока доступна машина. Время дороги, расходы и часы работы проверьте перед выездом.', walkTransportHint: 'Время пешком ориентировочное. Часы работы и условия места проверьте перед выходом.', otherTransportHint: 'Время на выбранном транспорте может быть неизвестно. Проверьте дорогу во внешней карте.', locationLoading: 'Запрашиваем геопозицию…', locationUnavailable: 'Геопозиция недоступна. Начнём от центра Астаны.', locationDenied: 'Доступ к геопозиции не получен. Начнём от центра Астаны.', locationFar: 'Вы далеко от Астаны. Начнём маршрут от центра города.', locationFound: 'Начнём маршрут от вашей геопозиции.', promptError: 'Опишите, какой маршрут вам нужен, хотя бы в нескольких словах.', groupError: 'Укажите число от 1 до 12.', budgetError: 'Укажите сумму от 0 до 10 000 000 ₸ или оставьте поле пустым.', loadingRoute: 'Ищем маршрут…', searchingPlaces: 'Ищем подходящие места', searchDescription: 'Проверяем реальные места и собираем маршрут. Это может занять до минуты.', routeNotReady: 'Маршрут пока не готов', edit: 'Изменить запрос', entry: 'Вход', averageBill: 'Средний чек', oneItem: 'Одна позиция', fromPrice: 'от {amount}', checked: 'Проверено {date}', priceSource: 'Источник цены ↗', itemPriceNote: 'Цена одной позиции, не всего посещения.', entryOverBudget: 'Указанная цена билета выше вашего бюджета на человека.', billOverBudget: 'Опубликованный средний чек выше вашего бюджета на человека.', trip: 'Поездка', stop: 'Остановка', place: 'Место', source: 'Источник ↗', onMap: 'На карте ↗', travelApprox: '≈ {time} {mode}', onSiteApprox: '≈ {time} на месте', unknownTravel: 'Время дороги неизвестно', roadCost: 'Расходы на дорогу ≈ {min}–{max}', unknownCost: 'Стоимость посещения неизвестна', whatToDo: 'Что здесь сделать', aiCaveat: 'Идея создана ИИ; детали места проверьте перед выходом.', evidence: 'Подробности в источниках', directions: 'Маршрут до места ↗', osmWebsite: 'Сайт из OSM ↗', placeSource: 'Источник места ↗', timeSource: 'Источник времени ↗', costSource: 'Источник стоимости ↗', noPlaces: 'По вашему запросу пока не нашлось подтверждённых мест. Попробуйте описать интересы иначе или выделить больше времени.', cityRoute: 'Маршрут по Астане', astanaTrip: 'Поездка из Астаны', yourRoute: 'Ваш маршрут', walkAndStops: '≈ {time} пешком и на местах', openRoute: 'Открыть весь маршрут ↗', tripVariants: 'Варианты поездки', routeVariants: 'Варианты маршрута', route: 'Маршрут', variant: 'Вариант', roadLine: 'Линия показывает рассчитанный путь. Перед дорогой проверьте его во внешней карте.', dottedLine: 'Пунктир показывает порядок остановок, а не дорогу по улицам. Точный путь откройте во внешней карте.', stopsOrder: 'Остановки по порядку', moreIdeas: 'Ещё идеи →', openInTelegram: 'Откройте приложение через бота в Telegram и попробуйте снова.', loadingMore: 'Ищем ещё…', searchingIdeas: 'Ищем идеи…', otherPlaces: 'Ищем другие места по тем же условиям.', telegramExpired: 'Сессия Telegram устарела. Откройте приложение через бота заново.', rateLimit: 'Слишком много запросов. Подождите немного и попробуйте снова.', newIdeasError: 'Не удалось найти новые идеи. Попробуйте чуть позже.', incomplete: 'Ответ сервера неполный. Попробуйте ещё раз.', noNewPlaces: 'Новых мест пока не нашлось. Попробуйте изменить запрос или параметры.', searchTimeoutShort: 'Поиск занял слишком много времени. Попробуйте ещё раз.', newIdeasRetry: 'Не удалось найти новые идеи. Попробуйте ещё раз.', telegramRequired: 'Для составления маршрута откройте приложение через бота в Telegram. Так мы сможем безопасно обработать ваш запрос.', telegramInvalid: 'Не удалось подтвердить запуск в Telegram. Полностью закройте окно приложения и откройте его снова через @smart_city_ryadombot.', serviceError: 'Сервис временно недоступен. Попробуйте ещё раз через несколько секунд.', searchTimeout: 'Поиск занял слишком много времени. Проверьте соединение и попробуйте ещё раз.', unknownError: 'Произошла ошибка. Попробуйте ещё раз.', languageChange: 'Язык изменён. Составьте маршрут заново, чтобы описание тоже было на новом языке.',
  startTitle: 'Откуда начнём?',
  startCenter: 'Центр Астаны',
  startDevice: 'Моя геопозиция',
  startMap: 'Указать на карте',
  startMapSelected: 'Точка на карте',
  startCancel: 'Отменить выбор',
  startReset: 'Сбросить',
  startCenterStatus: 'По умолчанию — центр Астаны.',
  startDeviceFound: 'Стартуем от вашей геопозиции.',
  startMapFound: 'Стартуем от выбранной точки.',
  startPickInstruction: 'Коснитесь карты, чтобы выбрать старт. Карту можно двигать.',
  startOutside: 'Точка за пределами Астаны. Выберите место в городе.',
  startUnavailable: 'Геопозиция недоступна. Выберите точку на карте.',
  startDenied: 'Доступ к геопозиции не получен. Выберите точку на карте.',
  startLoading: 'Определяем геопозицию…',
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
    startCancel: 'Таңдауды тоқтату',
    startReset: 'Қалпына келтіру',
    startCenterStatus: 'Әдепкі бойынша Астана орталығынан бастаймыз.',
    startDeviceFound: 'Сіз тұрған жерден бастаймыз.',
    startMapFound: 'Картадан таңдалған жерден бастаймыз.',
    startPickInstruction: 'Бастау нүктесін таңдау үшін картаны түртіңіз. Картаны жылжытуға болады.',
    startOutside: 'Нүкте Астанадан тыс жерде. Қала ішіндегі орынды таңдаңыз.',
    startUnavailable: 'Геолокация қолжетімсіз. Картадан нүктені таңдаңыз.',
    startDenied: 'Геолокацияға рұқсат берілмеді. Картадан нүктені таңдаңыз.',
    startLoading: 'Геолокация анықталуда…',
  },
  en: {
    skip: 'Skip to content', mapRegion: 'Astana map and route', map: 'Map of Astana', brand: 'Ryadom — routes from Astana', astana: 'Astana', mapActions: 'Map controls', recenter: 'Show route starting point', fit: 'Show full route', osm: '© OpenStreetMap contributors', license: 'License', data: 'About the data', planner: 'Route planner', expandPanel: 'Expand panel', collapsePanel: 'Collapse panel', expandRoute: 'Expand route', collapseRoute: 'Collapse route', heading: 'Where to?', subtitle: 'Tell us what kind of outing or evening you have in mind.', backRoute: '← Back to route', interest: 'What interests you?', promptHint: 'Describe the mood, places and details that matter to you.', promptPlaceholder: 'For example, a quiet café for reading or dancing all night', examples: 'Example requests', exampleClub: 'Clubs and dancing', exampleClubPrompt: 'I want a club with music, dancing and a lively night', exampleCoffee: 'Coffee and a book', exampleCoffeePrompt: 'A quiet café where I can drink coffee and read a book', exampleFriends: 'With friends', exampleFriendsPrompt: 'A walk with friends around interesting places in Astana', where: 'Search area', whereRoute: 'Where to look for a route', inAstana: 'In Astana', fromCity: 'Trip from the city', duration: 'Time available', durationAria: 'Time including travel', transport: 'How will you travel?', transportAria: 'Transport mode', budget: 'Budget per person, ₸', noLimit: 'No limit', budgetHint: 'Prices are unknown for many places. 0 ₸ excludes cafés, clubs and shops, but the remaining places have not been confirmed free.', group: 'How many people?', groupHint: 'Between 1 and 12 people.', locationButton: 'Use my location', locationDefault: 'Without your location, we start from central Astana.', submit: 'Build a route', readyRoute: 'Your route', language: 'Interface language', fromAstana: 'From Astana', allDay: 'All day', walk: 'Walk', transit: 'Public transport', car: 'Car', walkLower: 'on foot', transitLower: 'by public transport', carLower: 'by car', perPerson: 'per person', personOne: 'person', personMany: 'people', stopsOne: 'stop', stopsFew: 'stops', stopsMany: 'stops', hoursShort: 'h', minutesShort: 'min', tripTransportHint: 'Trips from Astana currently require a car. Check travel time, costs and opening hours before you leave.', walkTransportHint: 'Walking times are approximate. Check opening hours and venue conditions before leaving.', otherTransportHint: 'Travel time by your chosen transport may be unknown. Check directions in an external map.', locationLoading: 'Requesting location…', locationUnavailable: 'Location unavailable. We will start from central Astana.', locationDenied: 'Location access was not granted. We will start from central Astana.', locationFar: 'You are far from Astana. We will start from the city center.', locationFound: 'We will start from your location.', promptError: 'Describe the route you want in at least a few words.', groupError: 'Enter a number from 1 to 12.', budgetError: 'Enter an amount from 0 to 10,000,000 ₸ or leave the field empty.', loadingRoute: 'Finding a route…', searchingPlaces: 'Finding places that fit', searchDescription: 'We are checking real places and planning a route. This may take up to a minute.', routeNotReady: 'Route is not ready yet', edit: 'Edit request', entry: 'Admission', averageBill: 'Average bill', oneItem: 'One item', fromPrice: 'from {amount}', checked: 'Checked {date}', priceSource: 'Price source ↗', itemPriceNote: 'This is the price of one item, not the full visit.', entryOverBudget: 'The listed ticket price exceeds your budget per person.', billOverBudget: 'The published average bill exceeds your budget per person.', trip: 'Trip', stop: 'Stop', place: 'Place', source: 'Source ↗', onMap: 'On map ↗', travelApprox: '≈ {time} {mode}', onSiteApprox: '≈ {time} at this stop', unknownTravel: 'Travel time unknown', roadCost: 'Travel cost ≈ {min}–{max}', unknownCost: 'Visit cost unknown', whatToDo: 'What to do here', aiCaveat: 'This idea was generated by AI; check venue details before leaving.', evidence: 'Details in sources', directions: 'Directions to place ↗', osmWebsite: 'Website from OSM ↗', placeSource: 'Place source ↗', timeSource: 'Time source ↗', costSource: 'Cost source ↗', noPlaces: 'No verified places matched your request yet. Try describing your interests differently or allowing more time.', cityRoute: 'Route in Astana', astanaTrip: 'Trip from Astana', yourRoute: 'Your route', walkAndStops: '≈ {time} walking and at stops', openRoute: 'Open full route ↗', tripVariants: 'Trip options', routeVariants: 'Route options', route: 'Route', variant: 'Option', roadLine: 'The line shows a calculated route. Check it in an external map before traveling.', dottedLine: 'The dotted line shows stop order, not a street route. Open precise directions in an external map.', stopsOrder: 'Stops in order', moreIdeas: 'More ideas →', openInTelegram: 'Open this app through the Telegram bot and try again.', loadingMore: 'Finding more…', searchingIdeas: 'Finding ideas…', otherPlaces: 'Looking for different places with the same settings.', telegramExpired: 'Your Telegram session has expired. Reopen the app through the bot.', rateLimit: 'Too many requests. Wait a moment and try again.', newIdeasError: 'Could not find new ideas. Please try again later.', incomplete: 'The server response was incomplete. Please try again.', noNewPlaces: 'No new places found yet. Try changing your request or settings.', searchTimeoutShort: 'The search took too long. Please try again.', newIdeasRetry: 'Could not find new ideas. Please try again.', telegramRequired: 'To build a route, open the app through the Telegram bot. This lets us process your request securely.', telegramInvalid: 'Could not verify the Telegram launch. Close the app completely and reopen it through @smart_city_ryadombot.', serviceError: 'The service is temporarily unavailable. Please try again in a few seconds.', searchTimeout: 'The search took too long. Check your connection and try again.', unknownError: 'Something went wrong. Please try again.', languageChange: 'Language changed. Build the route again so its description uses the new language.',
    startTitle: 'Where do we start?',
    startCenter: 'Central Astana',
    startDevice: 'My location',
    startMap: 'Pick on map',
    startMapSelected: 'Map point',
    startCancel: 'Cancel selection',
    startReset: 'Reset',
    startCenterStatus: 'Starting from central Astana by default.',
    startDeviceFound: 'Starting from your location.',
    startMapFound: 'Starting from the selected map point.',
    startPickInstruction: 'Tap the map to choose a start. You can move the map first.',
    startOutside: 'This point is outside Astana. Choose a place in the city.',
    startUnavailable: 'Location unavailable. Pick a point on the map.',
    startDenied: 'Location access was not granted. Pick a point on the map.',
    startLoading: 'Finding your location…',
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
document.documentElement.lang = language
function t(key: MessageKey, values: Record<string, string | number> = {}): string {
  return messages[language][key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] === undefined ? match : String(values[name]))
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
  <div class="app-shell" data-sheet="peek">
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
      </button>
      <div id="sheetBody" class="sheet-scroll">
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
        <textarea id="prompt" name="prompt" rows="2" maxlength="300" aria-describedby="promptHint promptError" placeholder="Например, тихое кафе с книгой или танцы до ночи"></textarea>
        <p id="promptError" class="field-error" role="alert" hidden></p>
        <div class="example-row" role="group" aria-label="Примеры запросов">
          <button type="button" data-example="club">Клуб и танцы</button>
          <button type="button" data-example="coffee">Кофе и книга</button>
          <button type="button" data-example="friends">С друзьями</button>
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
const startValue = requiredElement<HTMLElement>('#startValue')
const deviceButton = requiredElement<HTMLButtonElement>('#deviceButton')
const mapPickButton = requiredElement<HTMLButtonElement>('#mapPickButton')
const resetStartButton = requiredElement<HTMLButtonElement>('#resetStartButton')
const mapPickHint = requiredElement<HTMLElement>('#mapPickHint')
const shell = requiredElement<HTMLElement>('.app-shell')
const sheetHandle = requiredElement<HTMLButtonElement>('#sheetHandle')
const sheetScroll = requiredElement<HTMLElement>('#sheetBody')
const settingsToggle = requiredElement<HTMLButtonElement>('#settingsToggle')
const settingsSummary = requiredElement<HTMLElement>('#settingsSummary')
const recenterButton = requiredElement<HTMLButtonElement>('#recenterButton')
const fitButton = requiredElement<HTMLButtonElement>('#fitButton')
const returnToRouteButton = requiredElement<HTMLButtonElement>('#returnToRouteButton')
const languageSelect = document.getElementById('languageSelect') as unknown as HTMLSelectElement
if (!languageSelect) throw new Error('Missing language selector')
languageSelect.value = language

type SheetMode = 'peek' | 'expanded' | 'loading' | 'results' | 'peek-results'

const state: {
  scope: Scope
  transport: Transport
  minutes: number
  coordinates: MapCoordinate | null
  startSource: 'center' | 'device' | 'map'
  isLoading: boolean
  stops: Recommendation[]
} = {
  scope: 'city',
  transport: 'walk',
  minutes: 120,
  coordinates: null,
  startSource: 'center',
  isLoading: false,
  stops: [],
}

let requestVersion = 0
let activeRecommendation: AbortController | null = null
let mapController: RecommendationsMapController | null = null
let currentRouteOrigin: MapCoordinate | null = null
const seenPlaceIds = new Set<string>()
let startMessageKey: MessageKey = 'startCenterStatus'
let pickingStart = false
let locationAttemptId = 0

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
  mapPickHint.textContent = t('startPickInstruction')
  mapPickHint.hidden = !pickingStart
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
    ['#returnToRouteButton', 'backRoute'], ['.planner-lead label', 'interest'],
    ['#promptHint', 'promptHint'], ['.example-row [data-example="club"]', 'exampleClub'],
    ['.example-row [data-example="coffee"]', 'exampleCoffee'],
    ['.example-row [data-example="friends"]', 'exampleFriends'],
    ['.scope-row .field-label', 'where'], ['[data-scope="city"]', 'inAstana'],
    ['[data-scope="day_trip"]', 'fromCity'], ['.settings-grid .field-group:first-child legend', 'duration'],
    ['.settings-grid .field-group:nth-child(2) legend', 'transport'], ['.budget-group label', 'budget'],
    ['#budgetHint', 'budgetHint'], ['.group-size-group label', 'group'],
    ['#groupSizeHint', 'groupHint'],
    ['.submit-label', 'submit'], ['.language-picker span', 'language'],
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
    ['.scope-switch', 'aria-label', 'whereRoute'], ['#durationChoices', 'aria-label', 'durationAria'],
    ['#transportChoices', 'aria-label', 'transportAria'], ['#results', 'aria-label', 'readyRoute'],
    ['#languageSelect', 'aria-label', 'language'],
  ]
  for (const [selector, attribute, key] of ariaTargets) document.querySelector(selector)?.setAttribute(attribute, t(key))
  prompt.placeholder = t('promptPlaceholder')
  budget.placeholder = t('noLimit')
  const exampleKeys: Array<[string, MessageKey]> = [['club', 'exampleClubPrompt'], ['coffee', 'exampleCoffeePrompt'], ['friends', 'exampleFriendsPrompt']]
  for (const [id, key] of exampleKeys) document.querySelector(`[data-example="${id}"]`)?.setAttribute('data-example-text', t(key))
  renderStartPicker()
  requiredElement<HTMLAnchorElement>('#privacyLink').href = `/privacy.html?lang=${language}`
  mapController?.setLanguage(language)
  renderDurationChoices()
  renderTransportChoices()
  updateSettingsSummary()
  setSheetMode(shell.dataset.sheet as SheetMode)
}

function setSheetMode(mode: SheetMode): void {
  shell.dataset.sheet = mode
  const expanded = mode === 'expanded' || mode === 'results'
  sheetHandle.setAttribute('aria-expanded', String(expanded))
  sheetHandle.setAttribute('aria-label', mode === 'results' ? t('collapseRoute') : mode === 'peek-results' ? t('expandRoute') : expanded ? t('collapsePanel') : t('expandPanel'))
  sheetHandle.disabled = mode === 'loading'
  settingsToggle.setAttribute('aria-expanded', String(mode === 'expanded'))
  planner.hidden = mode === 'loading' || mode === 'results' || mode === 'peek-results'
  if (mode !== 'results' && mode !== 'loading' && mode !== 'peek-results') results.hidden = true
  returnToRouteButton.hidden = !currentRouteOrigin || (mode !== 'peek' && mode !== 'expanded')
  sheetScroll.scrollTop = 0
}

function updateSettingsSummary(): void {
  const travel = travelModeLabel(state.transport)
  const count = Number(groupSize.value) || 1
  const people = `${count} ${count === 1 ? t('personOne') : t('personMany')}`
  const money = budget.value.trim() === '' ? '' : ` · ${formatKzt(Number(budget.value))} ${t('perPerson')}`
  settingsSummary.textContent = `${state.scope === 'city' ? t('astana') : t('fromAstana')} · ${state.minutes === 1440 ? t('allDay') : formatMinutes(state.minutes)} · ${travel} · ${people}${money}`
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

document.documentElement.dataset.theme = 'light'
if (telegram?.isVersionAtLeast?.('7.0')) telegram.setHeaderColor?.('#ffffff')
if (telegram?.isVersionAtLeast?.('6.1')) telegram.setBackgroundColor?.('#e6ece8')
if (telegram?.isVersionAtLeast?.('7.10')) telegram.setBottomBarColor?.('#ffffff')
if (telegram?.isVersionAtLeast?.('7.7')) telegram.disableVerticalSwipes?.()
telegram?.ready()
telegram?.expand()

languageSelect.addEventListener('change', () => {
  const next = matchLanguage(languageSelect.value)
  if (!next || next === language) return
  const hadRoute = currentRouteOrigin !== null || state.isLoading
  const prior = language
  const previousExample = (['club', 'coffee', 'friends'] as const).find((id) => prompt.value === messages[prior][({ club: 'exampleClubPrompt', coffee: 'exampleCoffeePrompt', friends: 'exampleFriendsPrompt' } as const)[id]])
  language = next
  try { localStorage.setItem('ryadom-language', language) } catch { /* Ignore storage errors. */ }
  if (previousExample) prompt.value = messages[language][({ club: 'exampleClubPrompt', coffee: 'exampleCoffeePrompt', friends: 'exampleFriendsPrompt' } as const)[previousExample]]
  clearResults()
  promptError.hidden = true
  groupSizeError.hidden = true
  budget.setCustomValidity('')
  applyTranslations()
  const notice = requiredElement<HTMLElement>('#languageNotice')
  notice.textContent = t('languageChange')
  notice.hidden = !hadRoute
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
    button.textContent = minutes === 1440 ? t('allDay') : formatMinutes(minutes)
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
    prompt.value = button.dataset.exampleText ?? ''
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

function startStatusForSource(): MessageKey {
  return state.startSource === 'device' ? 'startDeviceFound'
    : state.startSource === 'map' ? 'startMapFound' : 'startCenterStatus'
}

function setStartPoint(point: MapCoordinate | null, source: 'center' | 'device' | 'map'): void {
  locationAttemptId += 1
  pickingStart = false
  mapController?.setStartPointSelectionMode(false)
  state.coordinates = point
  state.startSource = source
  startMessageKey = startStatusForSource()
  clearResults()
  mapController?.setStartPoint(origin())
  mapController?.focus(origin())
  renderStartPicker()
}

function requestDeviceLocation(): void {
  const attemptId = ++locationAttemptId
  pickingStart = false
  mapController?.setStartPointSelectionMode(false)
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
  pickingStart = !pickingStart
  mapController?.setStartPointSelectionMode(pickingStart)
  startMessageKey = pickingStart ? 'startPickInstruction' : startStatusForSource()
  if (pickingStart) setSheetMode('peek')
  renderStartPicker()
})
resetStartButton.addEventListener('click', () => setStartPoint(null, 'center'))

function validateForm(): { text: string; group: number; budgetKzt?: number } | null {
  budget.setCustomValidity('')
  const text = prompt.value.trim()
  if (text.length < 3) {
    promptError.textContent = t('promptError')
    promptError.hidden = false
    prompt.focus()
    return null
  }
  const group = Number(groupSize.value)
  if (!Number.isInteger(group) || group < 1 || group > 12) {
    groupSizeError.textContent = t('groupError')
    groupSizeError.hidden = false
    groupSize.focus()
    return null
  }
  if (budget.value.trim() === '') return { text, group }
  const amount = Number(budget.value)
  if (!Number.isInteger(amount) || amount < 0 || amount > 10_000_000) {
    budget.setCustomValidity(t('budgetError'))
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
    language,
  }
  if (validated.budgetKzt !== undefined) request.budgetKzt = validated.budgetKzt
  if (excludePlaceIds.length) request.excludePlaceIds = excludePlaceIds
  if (state.coordinates) {
    request.latitude = state.coordinates.lat
    request.longitude = state.coordinates.lon
  }
  return { initData: telegram?.initData ?? '', request }
}

function setLoading(value: boolean, loadingLabel = t('loadingRoute')): void {
  state.isLoading = value
  submitButton.disabled = value
  planner.setAttribute('aria-busy', String(value))
  submitLabel.textContent = value ? loadingLabel : t('submit')
}

function showLoading(): void {
  results.hidden = false
  results.innerHTML = `<div class="results-heading"><h2>${t('searchingPlaces')}</h2><p>${t('searchDescription')}</p></div><div class="loading-row" aria-hidden="true"><span></span><span></span><span></span></div>`
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
  heading.textContent = t('routeNotReady')
  const detail = document.createElement('p')
  detail.textContent = message
  appendNodes(panel, heading, detail)
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
  const facts = document.createElement('div')
  facts.className = 'place-facts'
  const priceBlock = createPriceBlock(item)
  if (typeof item.travelMinutesApprox === 'number') addFact(facts, t('travelApprox', { time: formatMinutes(item.travelMinutesApprox), mode: travelModeLabel(item.travelMode) }))
  else if (typeof item.walkMinutes === 'number') addFact(facts, t('travelApprox', { time: formatMinutes(item.walkMinutes), mode: t('walkLower') }))
  else addFact(facts, t('unknownTravel'))
  if (typeof item.visitMinutes === 'number') addFact(facts, t('onSiteApprox', { time: formatMinutes(item.visitMinutes) }))
  if (item.estimatedCostKzt) {
    addFact(facts, t('roadCost', { min: formatKzt(item.estimatedCostKzt.min), max: formatKzt(item.estimatedCostKzt.max) }))
  } else if (!priceBlock) addFact(facts, t('unknownCost'))
  if (item.hoursStatus) addFact(facts, item.hoursStatus)
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
    evidenceLabel.textContent = t('evidence')
    evidenceBlock.insertBefore(evidenceLabel, evidenceBlock.firstChild)
  }
  const links = document.createElement('div')
  links.className = 'place-links'
  for (const [label, value, className] of [
    [t('directions'), item.routeUrl, 'map-link'],
    [t('osmWebsite'), item.venueWebsite, 'source-link'],
    [t('placeSource'), item.sourceUrl, 'source-link'],
    [t('timeSource'), item.travelSourceUrl, 'source-link'],
    [t('costSource'), item.costSourceUrl, 'source-link'],
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
    showError(response.summary || t('noPlaces'))
    return
  }
  rememberShownStops(routes)
  state.stops = route.stops.slice(0, 3)

  const heading = document.createElement('div')
  heading.className = 'results-heading'
  const eyebrow = document.createElement('span')
  eyebrow.className = 'results-eyebrow'
  eyebrow.textContent = state.scope === 'day_trip' ? t('astanaTrip') : t('cityRoute')
  const title = document.createElement('h2')
  title.textContent = route.title || t('yourRoute')
  const summary = document.createElement('p')
  summary.textContent = route.summary || response.summary
  const meta = document.createElement('div')
  meta.className = 'route-meta'
  addFact(meta, stopCount(state.stops.length))
  addFact(meta, `${groupSize.value} ${Number(groupSize.value) === 1 ? t('personOne') : t('personMany')}`)
  if (typeof route.totalMinutesApprox === 'number' && state.transport === 'walk') {
    addFact(meta, t('walkAndStops', { time: formatMinutes(route.totalMinutesApprox) }))
  }
  appendNodes(heading, eyebrow, title, summary, meta)
  const routeLink = createLink(t('openRoute'), route.routeUrl, 'route-link')
  if (routeLink) heading.appendChild(routeLink)
  const editButton = document.createElement('button')
  editButton.type = 'button'
  editButton.className = 'edit-route-button'
  editButton.textContent = t('edit')
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
    const response = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
      body: JSON.stringify(makeRequest(validated, recentExcludedPlaceIds())),
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

planner.addEventListener('submit', async (event) => {
  event.preventDefault()
  requiredElement<HTMLElement>('#languageNotice').hidden = true
  if (state.isLoading) return
  const validated = validateForm()
  if (!validated) return
  if (!telegram?.initData) {
    showError(t('telegramRequired'))
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
      headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
      body: JSON.stringify(makeRequest(validated)),
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
})
applyTranslations()

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
