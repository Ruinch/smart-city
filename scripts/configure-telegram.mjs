import { readFile } from 'node:fs/promises'

function parseVars(contents) {
  const vars = {}
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const equals = trimmed.indexOf('=')
    if (equals < 1) continue
    const name = trimmed.slice(0, equals).trim()
    let value = trimmed.slice(equals + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    vars[name] = value
  }
  return vars
}

const vars = parseVars(await readFile(new URL('../.dev.vars', import.meta.url), 'utf8'))
const token = vars.TELEGRAM_BOT_TOKEN
const secret = vars.TELEGRAM_WEBHOOK_SECRET
const appUrl = process.argv[2] || vars.MINI_APP_URL

if (!token || token.startsWith('replace-')) throw new Error('Add TELEGRAM_BOT_TOKEN to .dev.vars')
if (!secret || secret.startsWith('replace-')) throw new Error('Add TELEGRAM_WEBHOOK_SECRET to .dev.vars')
if (!appUrl || !/^https:\/\//.test(appUrl)) throw new Error('Pass the deployed HTTPS Mini App URL')

const origin = new URL(appUrl).origin

async function call(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram ${method} failed: ${result.description || response.status}`)
  }
  return result.result
}

const bot = await call('getMe', {})
await call('setWebhook', {
  url: `${origin}/telegram/webhook`,
  secret_token: secret,
  allowed_updates: ['message'],
})
await call('setChatMenuButton', {
  menu_button: {
    type: 'web_app',
    text: 'Подобрать прогулку',
    web_app: { url: origin },
  },
})
await call('setMyCommands', {
  commands: [
    { command: 'start', description: 'Открыть подбор прогулки' },
    { command: 'help', description: 'Как пользоваться' },
  ],
})

process.stdout.write(`Настроен @${bot.username}: ${origin}\n`)
