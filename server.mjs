import express from 'express'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data')
fs.mkdirSync(dataDir, { recursive: true })
const dbPath = path.join(dataDir, 'total-work.db'), firstRun = !fs.existsSync(dbPath)
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;')
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, full_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('Founder','RH','Superviseur','Directeur')),
 status TEXT NOT NULL DEFAULT 'Actif' CHECK(status IN ('Actif','Désactivé','En attente','Refusé')),
 created_at TEXT NOT NULL, last_login TEXT, profile_json TEXT NOT NULL DEFAULT '{}', is_owner INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS one_owner ON users(is_owner) WHERE is_owner=1;
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS housing (
 matricule_key TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS import_history (
 id TEXT PRIMARY KEY, file_name TEXT NOT NULL, mode TEXT NOT NULL, added INTEGER NOT NULL,
 updated INTEGER NOT NULL, errors INTEGER NOT NULL, total INTEGER NOT NULL, created_at TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name)
if (!userColumns.includes('password_reset_required')) db.exec('ALTER TABLE users ADD COLUMN password_reset_required INTEGER NOT NULL DEFAULT 0')

const now = () => new Date().toISOString()
const normalizeEmail = (value) => String(value || '').trim().toLowerCase()
const normalizeMatricule = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '')
const hashPassword = (password) => { const salt = randomBytes(16); const hash = scryptSync(password, salt, 64); return `${salt.toString('hex')}:${hash.toString('hex')}` }
const verifyPassword = (password, stored) => { try { const [salt, expected] = stored.split(':'); const actual = scryptSync(password, Buffer.from(salt, 'hex'), 64); return timingSafeEqual(actual, Buffer.from(expected, 'hex')) } catch { return false } }
const hashToken = (token) => scryptSync(token, 'total-work-session-v1', 32).toString('hex')
const publicUser = (user) => user && ({ id: user.id, name: user.full_name, email: user.email, role: user.role, status: user.status, createdAt: user.created_at, lastLogin: user.last_login, profile: JSON.parse(user.profile_json || '{}'), owner: Boolean(user.is_owner), passwordResetRequired: Boolean(user.password_reset_required) })
const permissions = {
 Founder: ['view','housing:write','import','reset','settings','users:manage'],
 RH: ['view','housing:write','import','reset','settings'],
 Superviseur: ['view'], Directeur: ['view'],
}
const can = (user, permission) => permissions[user.role]?.includes(permission)
const transaction = (work) => {
  db.exec('BEGIN IMMEDIATE')
  try { const result = work(); db.exec('COMMIT'); return result }
  catch (error) { db.exec('ROLLBACK'); throw error }
}

const founderCount = db.prepare('SELECT COUNT(*) count FROM users WHERE is_owner=1').get().count
if (!founderCount) {
  const password = process.env.FOUNDER_PASSWORD || randomBytes(12).toString('base64url')
  const email = normalizeEmail(process.env.FOUNDER_EMAIL || 'founder@totalwork.ma')
  db.prepare('INSERT INTO users (id,full_name,email,password_hash,role,status,created_at,last_login,profile_json,is_owner,password_reset_required) VALUES (?,?,?,?,?,?,?,?,?,1,1)').run(randomUUID(), process.env.FOUNDER_NAME || 'Founder TOTAL WORK', email, hashPassword(password), 'Founder', 'Actif', now(), null, '{}')
  console.log(`\nCompte Founder créé\nEmail: ${email}\nMot de passe temporaire: ${password}\nChangez ce mot de passe après la première connexion.\n`)
}
if (firstRun && !db.prepare("SELECT 1 FROM system_config WHERE key='seeded'").get()) {
  const seedPath = path.join(__dirname, '../src/data/housing.json')
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'))
  const insert = db.prepare('INSERT OR IGNORE INTO housing VALUES (?,?,?,?)')
  for (const row of seed) insert.run(normalizeMatricule(row.matricule), JSON.stringify({ ...row, matricule: normalizeMatricule(row.matricule) }), now(), null)
  db.prepare('INSERT INTO system_config VALUES (?,?)').run('seeded', now())
}

const app = express()
const applicationStartedAt = now()
const packageInfo = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'))
app.use(express.json({ limit: '20mb' }))
const attempts = new Map()
const cookieValue = (request, name) => request.headers.cookie?.split(';').map((v) => v.trim().split('=')).find(([key]) => key === name)?.[1]
app.use((request, response, next) => {
  const token = cookieValue(request, 'tw_session')
  if (token) {
    const session = db.prepare(`SELECT s.csrf_token,s.expires_at,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(hashToken(token))
    if (session && session.expires_at > now() && session.status === 'Actif') { request.user = session; request.csrf = session.csrf_token }
    else db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token))
  }
  next()
})
const requireAuth = (request, response, next) => request.user ? next() : response.status(401).json({ error: 'Authentification requise.' })
const requirePermission = (permission) => (request, response, next) => {
  if (!request.user) return response.status(401).json({ error: 'Authentification requise.' })
  if (!can(request.user, permission)) return response.status(403).json({ error: "Accès refusé. Vous n'avez pas les autorisations nécessaires pour accéder à cette fonctionnalité." })
  if (request.user.password_reset_required) return response.status(403).json({ error: 'Vous devez créer un nouveau mot de passe avant de continuer.', passwordResetRequired: true })
  if (!['GET','HEAD'].includes(request.method) && request.headers['x-csrf-token'] !== request.csrf) return response.status(403).json({ error: 'Jeton de sécurité invalide.' })
  next()
}

app.post('/api/auth/login', (request, response) => {
  const key = request.ip, entry = attempts.get(key) || { count: 0, until: 0 }
  if (entry.until > Date.now()) return response.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' })
  const email = normalizeEmail(request.body.email), user = db.prepare('SELECT * FROM users WHERE email=?').get(email)
  if (!user || !verifyPassword(String(request.body.password || ''), user.password_hash)) { entry.count++; if (entry.count >= 5) { entry.until = Date.now() + 5 * 60_000; entry.count = 0 } attempts.set(key, entry); return response.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' }) }
  if (user.status !== 'Actif') return response.status(403).json({ error: user.status === 'Désactivé' ? 'Compte désactivé. Votre compte est actuellement désactivé. Veuillez contacter l’administrateur.' : "Votre compte n'est pas actif." })
  attempts.delete(key); const token = randomBytes(32).toString('base64url'), csrf = randomBytes(24).toString('base64url'), expires = new Date(Date.now() + 8 * 60 * 60_000).toISOString()
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run(hashToken(token), user.id, csrf, expires, now()); db.prepare('UPDATE users SET last_login=? WHERE id=?').run(now(), user.id)
  response.setHeader('Set-Cookie', `tw_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`)
  response.json({ user: publicUser({ ...user, last_login: now() }), permissions: permissions[user.role], csrf })
})
app.get('/api/auth/session', requireAuth, (request, response) => response.json({ user: publicUser(request.user), permissions: permissions[request.user.role], csrf: request.csrf }))
app.post('/api/auth/logout', requireAuth, (request, response) => { const token = cookieValue(request, 'tw_session'); db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token)); response.setHeader('Set-Cookie', 'tw_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); response.json({ ok: true }) })
app.post('/api/auth/complete-password-reset', requireAuth, (request,response)=>{ if(request.headers['x-csrf-token']!==request.csrf) return response.status(403).json({error:'Jeton de sécurité invalide.'}); const password=String(request.body.password||''),confirmation=String(request.body.confirmation||''); if(password!==confirmation) return response.status(400).json({error:'Les mots de passe ne correspondent pas.'}); if(password.length<12) return response.status(400).json({error:'Le mot de passe doit contenir au moins 12 caractères.'}); db.prepare('UPDATE users SET password_hash=?,password_reset_required=0 WHERE id=?').run(hashPassword(password),request.user.id); response.json({user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(request.user.id))}) })
app.patch('/api/profile', requirePermission('view'), (request, response) => { const name = String(request.body.name || '').trim(); if (!name) return response.status(400).json({ error: 'Le nom est obligatoire.' }); db.prepare('UPDATE users SET full_name=? WHERE id=?').run(name, request.user.id); response.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(request.user.id)) }) })
app.post('/api/profile/password', requirePermission('view'), (request, response) => { const current=String(request.body.currentPassword||''), next=String(request.body.newPassword||''); const user=db.prepare('SELECT * FROM users WHERE id=?').get(request.user.id); if(!verifyPassword(current,user.password_hash)) return response.status(400).json({error:'Le mot de passe actuel est incorrect.'}); if(next.length<12) return response.status(400).json({error:'Le nouveau mot de passe doit contenir au moins 12 caractères.'}); db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(next),user.id); const token=cookieValue(request,'tw_session'); db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(user.id,hashToken(token)); response.json({ok:true}) })

app.get('/api/housing', requirePermission('view'), (_request, response) => response.json(db.prepare('SELECT data_json FROM housing ORDER BY matricule_key').all().map((row) => JSON.parse(row.data_json))))
app.post('/api/housing', requirePermission('housing:write'), (request, response) => { const row = request.body, key = normalizeMatricule(row.matricule); if (!key) return response.status(400).json({ error: 'Le matricule est obligatoire.' }); try { const normalized = { ...row, matricule: key }; db.prepare('INSERT INTO housing VALUES (?,?,?,?)').run(key, JSON.stringify(normalized), now(), request.user.id); response.status(201).json(normalized) } catch { response.status(409).json({ error: 'Ce matricule existe déjà dans le système.' }) } })
app.put('/api/housing/:key', requirePermission('housing:write'), (request, response) => { const oldKey = normalizeMatricule(request.params.key), newKey = normalizeMatricule(request.body.matricule); try { response.json(transaction(() => { if (oldKey !== newKey && db.prepare('SELECT 1 FROM housing WHERE matricule_key=?').get(newKey)) throw new Error('duplicate'); db.prepare('DELETE FROM housing WHERE matricule_key=?').run(oldKey); const normalized = { ...request.body, matricule: newKey }; db.prepare('INSERT INTO housing VALUES (?,?,?,?)').run(newKey, JSON.stringify(normalized), now(), request.user.id); return normalized })) } catch { response.status(409).json({ error: 'Ce matricule existe déjà dans le système.' }) } })
app.delete('/api/housing/:key', requirePermission('housing:write'), (request, response) => { db.prepare('DELETE FROM housing WHERE matricule_key=?').run(normalizeMatricule(request.params.key)); response.json({ ok: true }) })
app.post('/api/housing/sync', requirePermission('import'), (request, response) => { const rows = request.body.records || [], mode = request.body.mode, keys = new Set(); for (const row of rows) { const key = normalizeMatricule(row.matricule); if (!key || keys.has(key)) return response.status(409).json({ error: `Doublon détecté : ${key || 'Matricule manquant'}` }); keys.add(key) } response.json(transaction(() => { if (mode === 'replace') db.exec('DELETE FROM housing'); let added=0, updated=0; const select=db.prepare('SELECT 1 FROM housing WHERE matricule_key=?'), insert=db.prepare('INSERT INTO housing VALUES (?,?,?,?)'), update=db.prepare('UPDATE housing SET data_json=?,updated_at=?,updated_by=? WHERE matricule_key=?'); for (const source of rows) { const key=normalizeMatricule(source.matricule), row={...source,matricule:key}, exists=select.get(key); if (exists && mode==='add') continue; if (exists) { update.run(JSON.stringify(row),now(),request.user.id,key); updated++ } else { insert.run(key,JSON.stringify(row),now(),request.user.id); added++ } } const id=randomUUID(); db.prepare('INSERT INTO import_history VALUES (?,?,?,?,?,?,?,?,?)').run(id,request.body.file||'Import Excel',mode,added,updated,0,rows.length,now(),request.user.id); return {added,updated,total:rows.length,id} })) })
app.delete('/api/housing', requirePermission('reset'), (_request, response) => { transaction(()=>db.exec('DELETE FROM housing; DELETE FROM import_history;')); response.json({ok:true}) })
app.get('/api/import-history', requirePermission('view'), (_request,response)=>response.json(db.prepare(`SELECT h.id,h.file_name file,h.mode,h.added,h.updated,h.errors,h.total,h.created_at date,u.full_name user FROM import_history h JOIN users u ON u.id=h.user_id ORDER BY h.created_at DESC LIMIT 20`).all()))
app.get('/api/health', requirePermission('view'), (request, response) => {
  const checkedAt = now()
  let databaseStatus = 'Erreur', databaseError = null, records = [], activeSessions = 0
  try {
    db.prepare('SELECT 1 value').get()
    records = db.prepare('SELECT data_json,updated_at FROM housing ORDER BY updated_at DESC').all()
    activeSessions = db.prepare('SELECT COUNT(*) count FROM sessions WHERE expires_at>?').get(checkedAt).count
    databaseStatus = 'Opérationnelle'
  } catch (error) {
    databaseError = error.message
  }
  const parsed = [], matricules = new Set(), duplicates = new Set()
  let invalidRecords = 0, invalidDates = 0, missingAmounts = 0, latestDataUpdate = null
  for (const row of records) {
    try {
      const record = JSON.parse(row.data_json)
      parsed.push(record)
      const matricule = normalizeMatricule(record.matricule)
      if (!matricule) invalidRecords++
      else if (matricules.has(matricule)) duplicates.add(matricule)
      else matricules.add(matricule)
      const day = Number(record.payDay)
      if (!Number.isFinite(day) || day < 1 || day > 31) invalidDates++
      const amount = Number(record.price)
      if (!Number.isFinite(amount)) missingAmounts++
      if (!latestDataUpdate || row.updated_at > latestDataUpdate) latestDataUpdate = row.updated_at
    } catch { invalidRecords++ }
  }
  const lastImport = db.prepare('SELECT file_name file,created_at date,total,errors FROM import_history ORDER BY created_at DESC LIMIT 1').get() || null
  const lastLogin = db.prepare('SELECT full_name user,last_login date FROM users WHERE last_login IS NOT NULL ORDER BY last_login DESC LIMIT 1').get() || null
  const failedAttempts = [...attempts.values()].reduce((total, entry) => total + entry.count, 0)
  response.json({
    checkedAt,
    application: { status: 'Opérationnelle', version: packageInfo.version, environment: process.env.NODE_ENV || 'development', startedAt: applicationStartedAt },
    database: { type: 'SQLite', status: databaseStatus, records: parsed.length, lastOperation: latestDataUpdate, error: databaseError },
    data: { status: invalidRecords || invalidDates || missingAmounts || duplicates.size ? 'Avertissement' : 'À jour', lastImport, lastUpdate: latestDataUpdate, validRecords: Math.max(parsed.length - invalidRecords, 0), invalidRecords, duplicateMatricules: duplicates.size, invalidDates, missingAmounts },
    authentication: { status: 'Opérationnelle', rbac: 'Actif', activeSessions, lastLogin },
    api: { status: 'Opérationnelle', type: 'Express local' },
    security: { authentication: 'Active', rbac: 'Actif', activeSessions, recentFailedAttempts: failedAttempts, lastEvent: lastLogin?.date || null },
    storage: { available: false },
  })
})

app.get('/api/users', requirePermission('users:manage'), (_request,response)=>response.json(db.prepare('SELECT * FROM users ORDER BY is_owner DESC,created_at').all().map(publicUser)))
app.post('/api/users', requirePermission('users:manage'), (request,response)=>{ const {name,email,role}=request.body,password=String(request.body.temporaryPassword||''); if (!['RH','Superviseur','Directeur'].includes(role)) return response.status(400).json({error:'Rôle invalide.'}); if(password.length<12) return response.status(400).json({error:'Le mot de passe temporaire doit contenir au moins 12 caractères.'}); try { const id=randomUUID(); db.prepare('INSERT INTO users (id,full_name,email,password_hash,role,status,created_at,last_login,profile_json,is_owner,password_reset_required) VALUES (?,?,?,?,?,?,?,?,?,0,1)').run(id,String(name).trim(),normalizeEmail(email),hashPassword(password),role,'Actif',now(),null,'{}'); response.status(201).json({user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id))}) } catch { response.status(409).json({error:'Cette adresse email existe déjà.'}) }})
app.patch('/api/users/:id', requirePermission('users:manage'), (request,response)=>{ const target=db.prepare('SELECT * FROM users WHERE id=?').get(request.params.id); if (!target) return response.status(404).json({error:'Utilisateur introuvable.'}); if (target.is_owner) return response.status(403).json({error:'Le compte Founder est protégé.'}); const role=request.body.role||target.role,status=request.body.status||target.status,name=String(request.body.name||target.full_name).trim(); if (!['RH','Superviseur','Directeur'].includes(role)||!['Actif','Désactivé','En attente','Refusé'].includes(status)) return response.status(400).json({error:'Valeur invalide.'}); db.prepare('UPDATE users SET full_name=?,role=?,status=? WHERE id=?').run(name,role,status,target.id); if(status!=='Actif') db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id); response.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(target.id))) })
app.post('/api/users/:id/reset-password', requirePermission('users:manage'), (request,response)=>{ const target=db.prepare('SELECT * FROM users WHERE id=?').get(request.params.id),password=String(request.body.temporaryPassword||''); if (!target) return response.status(404).json({error:'Utilisateur introuvable.'}); if(target.is_owner) return response.status(403).json({error:'Le compte Founder est protégé.'}); if(password.length<12) return response.status(400).json({error:'Le mot de passe temporaire doit contenir au moins 12 caractères.'}); db.prepare('UPDATE users SET password_hash=?,password_reset_required=1 WHERE id=?').run(hashPassword(password),target.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id); response.json({ok:true}) })
app.delete('/api/users/:id', requirePermission('users:manage'), (request,response)=>{ const target=db.prepare('SELECT * FROM users WHERE id=?').get(request.params.id); if(!target) return response.status(404).json({error:'Utilisateur introuvable.'}); if(target.is_owner||target.id===request.user.id) return response.status(403).json({error:'Le compte Founder est protégé et ne peut pas être supprimé.'}); db.prepare('DELETE FROM users WHERE id=?').run(target.id); response.json({ok:true}) })

const dist=path.resolve(__dirname,'../dist')
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.use((request,response,next)=>request.path.startsWith('/api/')?next():response.sendFile(path.join(dist,'index.html'))) }
const port=Number(process.env.PORT||3001)
app.listen(port,()=>console.log(`API TOTAL WORK: http://127.0.0.1:${port}`))
