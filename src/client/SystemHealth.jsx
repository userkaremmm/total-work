import { useEffect, useState } from 'react'
import { Activity, Database, FileSpreadsheet, Gauge, HardDrive, RefreshCw, ShieldCheck, Server, UsersRound } from 'lucide-react'
import { api } from './api.js'
import './SystemHealth.css'

const formatDate = (value) => value ? new Date(value).toLocaleString('fr-FR') : 'Information non disponible'
const statusTone = (status) => status === 'Opérationnelle' || status === 'Actif' || status === 'Active' || status === 'À jour' ? 'healthy' : status === 'Avertissement' ? 'warning' : status === 'Non configurée' ? 'neutral' : 'error'

export default function SystemHealth() {
  const [health, setHealth] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [responseTime, setResponseTime] = useState(null)
  const refresh = async () => {
    setLoading(true); setError('')
    const started = performance.now()
    try { const result = await api.health(); setHealth(result); setResponseTime(Math.round(performance.now() - started)) }
    catch (reason) { setError(reason.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])

  return <section className="system-health" id="etat-systeme">
    <header className="health-heading"><div><span>SURVEILLANCE DE LA PLATEFORME</span><h2>État du système</h2><p>Surveillance et état actuel de la plateforme TOTAL WORK</p></div><button className="secondary" onClick={refresh} disabled={loading}><RefreshCw size={16} className={loading ? 'spinning' : ''} />{loading ? 'Vérification...' : "Actualiser l'état"}</button></header>
    {error && <div className="health-error">{error}</div>}
    {!health && loading ? <HealthSkeleton /> : health && <>
      <div className="health-grid">
        <HealthCard icon={Activity} title="Application" status={health.application.status} rows={[["Version", health.application.version || 'Information non disponible'], ['Environnement', health.application.environment || 'Information non disponible'], ['Dernier démarrage', formatDate(health.application.startedAt)]]} />
        <HealthCard icon={Database} title="Base de données" status={health.database.status} rows={[["Type", health.database.type], ['Enregistrements', health.database.records], ['Dernière opération', formatDate(health.database.lastOperation)]]} />
        <HealthCard icon={FileSpreadsheet} title="Données Excel" status={health.data.status} rows={[["Dernière synchronisation", formatDate(health.data.lastImport?.date)], ['Fichier', health.data.lastImport?.file || 'Information non disponible'], ['Dernière mise à jour', formatDate(health.data.lastUpdate)]]} />
        <HealthCard icon={UsersRound} title="Authentification" status={health.authentication.status} rows={[["RBAC", health.authentication.rbac], ['Sessions actives', health.authentication.activeSessions], ['Dernière connexion', formatDate(health.authentication.lastLogin?.date)]]} />
        <HealthCard icon={Server} title="API / Services" status={health.api.status} rows={[["Service", health.api.type], ['Temps de réponse mesuré', responseTime === null ? 'Information non disponible' : `${responseTime} ms`]]} />
        <HealthCard icon={HardDrive} title="Stockage" status="Information non disponible" rows={[["Utilisation", 'Information non disponible'], ['Espace disponible', 'Information non disponible']]} unavailable />
      </div>
      <div className="health-lower">
        <section className="panel validation-card"><header><Gauge size={19} /><div><h3>Validation des données</h3><p>Contrôles calculés sur les enregistrements actuellement stockés.</p></div></header><div><Metric tone="healthy" label="Enregistrements valides" value={health.data.validRecords} /><Metric tone="warning" label="Matricules en double" value={health.data.duplicateMatricules} /><Metric tone="error" label="Dates invalides" value={health.data.invalidDates} /><Metric tone="error" label="Montants manquants" value={health.data.missingAmounts} /><Metric tone="error" label="Enregistrements invalides" value={health.data.invalidRecords} /></div></section>
        <section className="panel security-card"><header><ShieldCheck size={19} /><div><h3>Sécurité</h3><p>Informations générales, sans données sensibles.</p></div></header><dl><div><dt>Authentification</dt><dd>{health.security.authentication}</dd></div><div><dt>RBAC</dt><dd>{health.security.rbac}</dd></div><div><dt>Sessions actives</dt><dd>{health.security.activeSessions}</dd></div><div><dt>Tentatives échouées suivies en mémoire</dt><dd>{health.security.recentFailedAttempts}</dd></div><div><dt>Dernière connexion enregistrée</dt><dd>{formatDate(health.security.lastEvent)}</dd></div></dl></section>
      </div>
      <footer className="health-checked">Dernière vérification : <b>{formatDate(health.checkedAt)}</b></footer>
    </>}
  </section>
}

function HealthCard({ icon: Icon, title, status, rows, unavailable }) { return <article className="panel health-card"><header><span><Icon size={19} /></span><div><h3>{title}</h3><Status value={status} unavailable={unavailable} /></div></header><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? 'Information non disponible'}</dd></div>)}</dl></article> }
function Status({ value, unavailable }) { return <span className={`health-status ${unavailable ? 'neutral' : statusTone(value)}`}><i />{value}</span> }
function Metric({ label, value, tone }) { return <article><span className={tone}>{value}</span><small>{label}</small></article> }
function HealthSkeleton() { return <div className="health-grid skeleton-grid">{Array.from({ length: 6 }, (_, index) => <div className="panel health-skeleton" key={index}><i /><i /><i /></div>)}</div> }
