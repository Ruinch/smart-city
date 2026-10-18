import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const contents = await readFile(resolve(root, '.dev.vars'), 'utf8')
const vars = Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
  const trimmed = line.trim()
  const equals = trimmed.indexOf('=')
  if (!trimmed || trimmed.startsWith('#') || equals < 1) return []
  const name = trimmed.slice(0, equals).trim()
  let value = trimmed.slice(equals + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return [[name, value]]
}))

const appUrl = process.argv[2] || vars.MINI_APP_URL
if (!appUrl || !/^https:\/\//.test(appUrl)) throw new Error('Pass deployed HTTPS URL')
const secrets = {
  OPENAI_API_KEY: vars.OPENAI_API_KEY,
  TELEGRAM_BOT_TOKEN: vars.TELEGRAM_BOT_TOKEN,
  TELEGRAM_WEBHOOK_SECRET: vars.TELEGRAM_WEBHOOK_SECRET,
  MINI_APP_URL: new URL(appUrl).origin,
}
for (const [name, value] of Object.entries(secrets)) {
  if (!value || value.startsWith('replace-')) throw new Error(`Add ${name} to .dev.vars first`)
}

const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js')
for (const [name, value] of Object.entries(secrets)) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [wrangler, 'secret', 'put', name], {
      cwd: root,
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    child.on('error', rejectRun)
    child.on('exit', (code) => code === 0 ? resolveRun() : rejectRun(new Error(`Could not publish ${name}; verify Cloudflare login and Worker deployment`)))
    child.stdin.end(`${value}\n`)
  })
  process.stdout.write(`Published ${name}\n`)
}
