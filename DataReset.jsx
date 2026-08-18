import { useState } from 'react'
import { AlertTriangle, Check, Database, FileSpreadsheet, ShieldAlert, Trash2, X } from 'lucide-react'
import './DataReset.css'

const RESET_ROLES = new Set(['Founder', 'RH'])

export default function DataReset({ currentUser, recordCount, onReset }) {
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [status, setStatus] = useState('idle')
  const authorized = RESET_ROLES.has(currentUser.role)

  if (!authorized) return null

  const close = () => {
    if (status === 'working') return
    setOpen(false)
    setConfirmation('')
    setStatus('idle')
  }

  const execute = async () => {
    if (!authorized || confirmation !== 'RESET' || status === 'working') return
    setStatus('working')
    try {
      await onReset()
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  return <section className="data-reset panel" id="reinitialisation-donnees">
    <header>
      <span><Database size={20} /></span>
      <div><h2>Réinitialisation des données</h2><p>Supprimez uniquement les données de gestion pour repartir d’un tableau de bord vide.</p></div>
      <span className="reset-permission"><ShieldAlert size={14} />Accès protégé</span>
    </header>
    <div className="reset-content">
      <div><h3>Réinitialiser les données</h3><p>Cette opération supprimera les logements, paiements, matricules, localisations, entreprises et toutes les données issues des imports Excel.</p><small>L’application, les utilisateurs, les rôles, les permissions, le thème et la configuration seront conservés.</small></div>
      <div className="reset-count"><b>{recordCount}</b><span>enregistrement(s) de gestion</span></div>
      <button className="reset-button" disabled={!recordCount} onClick={() => setOpen(true)}><Trash2 size={17} />Réinitialiser les données</button>
    </div>
    {open && <div className="reset-modal" role="dialog" aria-modal="true" aria-labelledby="reset-title">
      <button className="backdrop" onClick={close} aria-label="Fermer" />
      <div>
        {status === 'success' ? <ResetSuccess importExcel={() => { close(); requestAnimationFrame(() => document.getElementById('importation-excel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }} /> : <>
          <header><span><AlertTriangle size={25} /></span><button className="icon" onClick={close} aria-label="Fermer"><X size={18} /></button></header>
          <h2 id="reset-title">Attention</h2>
          <p><b>Cette action supprimera définitivement toutes les données de gestion actuellement enregistrées dans le système.</b></p>
          <p>Les logements, paiements, matricules, montants, dates et autres données importées seront supprimés.</p>
          <p>L’application elle-même, les utilisateurs et les paramètres ne seront pas supprimés.</p>
          <label><span>Tapez <b>RESET</b> pour confirmer</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck="false" placeholder="RESET" disabled={status === 'working'} /></label>
          {status === 'error' && <div className="reset-error"><AlertTriangle size={15} /><span><b>La réinitialisation a échoué</b>Aucune modification supplémentaire n’a été effectuée.</span></div>}
          <footer><button className="secondary" onClick={close} disabled={status === 'working'}>Annuler</button><button className="reset-confirm" onClick={execute} disabled={confirmation !== 'RESET' || status === 'working'}>{status === 'working' ? 'Réinitialisation...' : 'Réinitialiser définitivement'}</button></footer>
        </>}
      </div>
    </div>}
  </section>
}

function ResetSuccess({ importExcel }) {
  return <div className="reset-success"><span><Check size={26} /></span><h2>Réinitialisation terminée</h2><p>Toutes les données de gestion ont été supprimées.</p><p>Le dashboard est maintenant prêt pour une nouvelle importation Excel.</p><button className="primary" onClick={importExcel}><FileSpreadsheet size={17} />Importer un fichier Excel</button></div>
}
