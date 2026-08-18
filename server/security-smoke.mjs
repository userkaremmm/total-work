import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'total-work-auth-'))
const port = 3200 + Math.floor(Math.random() * 500)
const server = spawn(process.execPath, ['server/server.mjs'], {
  cwd: path.resolve('.'), env: { ...process.env, DATA_DIR: dir, PORT: String(port), FOUNDER_EMAIL: 'owner@test.local', FOUNDER_PASSWORD: 'Owner-Test-2026!' }, stdio: ['ignore', 'pipe', 'pipe'],
})
let serverError = ''
server.stderr.on('data', (chunk) => { serverError += String(chunk) })
const wait = async () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fetch(`http://127.0.0.1:${port}/api/auth/session`); return } catch { await new Promise((resolve) => setTimeout(resolve, 200)) }
  }
  throw new Error(`Server timeout: ${serverError || `exit=${server.exitCode}`}`)
}
const call = async (url, options = {}, cookie = '') => {
  const response = await fetch(`http://127.0.0.1:${port}${url}`, { ...options, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) } })
  return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] || '', body: await response.json().catch(() => ({})) }
}
try {
  await wait()
  const anonymous = await call('/api/housing')
  const anonymousHealth = await call('/api/health')
  const founder = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'owner@test.local', password: 'Owner-Test-2026!' }) })
  await call('/api/auth/complete-password-reset', { method: 'POST', headers: { 'X-CSRF-Token': founder.body.csrf }, body: JSON.stringify({ password: 'Owner-Permanent-2026!', confirmation: 'Owner-Permanent-2026!' }) }, founder.cookie)
  const temporaryPassword = 'Reader-Test-2026!'
  const created = await call('/api/users', { method: 'POST', headers: { 'X-CSRF-Token': founder.body.csrf }, body: JSON.stringify({ name: 'Lecture Test', email: 'reader@test.local', role: 'Superviseur', temporaryPassword }) }, founder.cookie)
  const reader = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'reader@test.local', password: temporaryPassword }) })
  const read = await call('/api/housing', {}, reader.cookie)
  const reset = await call('/api/housing', { method: 'DELETE', headers: { 'X-CSRF-Token': reader.body.csrf } }, reader.cookie)
  const changed = await call('/api/auth/complete-password-reset', { method: 'POST', headers: { 'X-CSRF-Token': reader.body.csrf }, body: JSON.stringify({ password: 'Reader-Permanent-2026!', confirmation: 'Reader-Permanent-2026!' }) }, reader.cookie)
  const readAfterChange = await call('/api/housing', {}, reader.cookie)
  const health = await call('/api/health', {}, reader.cookie)
  const ownerDelete = await call(`/api/users/${founder.body.user.id}`, { method: 'DELETE', headers: { 'X-CSRF-Token': founder.body.csrf } }, founder.cookie)
  const results = { anonymous: anonymous.status, anonymousHealth: anonymousHealth.status, founder: founder.status, created: created.status, reader: reader.status, forcedReset: reader.body.user.passwordResetRequired, readBeforeChange: read.status, passwordChanged: changed.status, readAfterChange: readAfterChange.status, health: health.status, database: health.body.database?.type, healthRecords: health.body.database?.records, rbac: health.body.authentication?.rbac, forbiddenReset: reset.status, protectedOwner: ownerDelete.status }
  console.log(JSON.stringify(results))
  if (JSON.stringify(results) !== JSON.stringify({ anonymous: 401, anonymousHealth: 401, founder: 200, created: 201, reader: 200, forcedReset: true, readBeforeChange: 403, passwordChanged: 200, readAfterChange: 200, health: 200, database: 'SQLite', healthRecords: 92, rbac: 'Actif', forbiddenReset: 403, protectedOwner: 403 })) process.exitCode = 1
} finally {
  server.kill(); setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 200)
}
