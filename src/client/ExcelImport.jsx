import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Download, FileSpreadsheet, History, LoaderCircle, UploadCloud, X } from 'lucide-react'
import './ExcelImport.css'
import { assertUniqueMatricules, normalizeMatricule, recordKey } from './import-utils.js'

const FIELDS = [
  ['matricule', 'Matricule', true], ['location', 'Localisation'], ['company', 'Entreprise'],
  ['payDate', 'Date de paiement', true], ['price', 'Montant'], ['capacity', 'Capacité'],
  ['people', 'Personnes'], ['chantier', 'Chantier'], ['responsible', 'Responsable'],
  ['startMonth', 'Date de début'], ['remark', 'Remarque'],
]
const SYNONYMS = {
  matricule: ['matricule', 'mat', 'matr', 'identifiant', 'id logement'],
  location: ['location', 'localisation', 'lieu', 'ville', 'site'],
  company: ['entreprise', 'societe', 'société', 'company', 'e'],
  payDate: ['pay date', 'date de pay', 'date paiement', 'date de paiement', 'jour paiement', 'echeance', 'échéance'],
  price: ['montant', 'prix', 'price', 'loyer', 'cout', 'coût'],
  capacity: ['capacite', 'capacité', 'capacity', 'places'],
  people: ['personnes', 'nombre personnes', 'n.p', 'np', 'people', 'effectif'],
  chantier: ['chantier', 'chanter', 'projet'], responsible: ['responsable', 'respo', 'superviseur'],
  startMonth: ['date de debut', 'date début', 'mois de debut', 'mois début', 'start date'],
  remark: ['remarque', 'remark', 'observation', 'commentaire'],
}
const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')
const normalized = (value) => clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const numberValue = (value) => { if (typeof value === 'number') return Number.isFinite(value) ? value : null; const normalizedNumber = clean(value).replace(/[^0-9,.-]/g, '').replace(',', '.'); if (!normalizedNumber) return null; const parsed = Number(normalizedNumber); return Number.isFinite(parsed) ? parsed : null }
const isMissingValue = (value) => ['', '*', '-', '—', 'N/A', 'NA'].includes(clean(value).toUpperCase())
function paymentDate(value, XLSX) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return { date: value.toISOString().slice(0, 10), day: value.getDate() }
  if (typeof value === 'number' && value > 31) { const date = XLSX.SSF.parse_date_code(value); if (date) return { date: `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`, day: date.d } }
  const text = clean(value), parts = text.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)
  if (parts) { const year = parts[3].length === 2 ? `20${parts[3]}` : parts[3]; return { date: `${year}-${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}`, day: Number(parts[1]) } }
  const day = Number(text.match(/\d{1,2}/)?.[0]); return day >= 1 && day <= 31 ? { date: '', day } : null
}
function detect(headers, saved = {}) {
  const used = new Set()
  return Object.fromEntries(FIELDS.map(([field]) => {
    if (saved[field] && headers.includes(saved[field])) { used.add(saved[field]); return [field, saved[field]] }
    let best = '', score = 0
    headers.forEach((header) => { if (used.has(header)) return; const source = normalized(header); SYNONYMS[field].forEach((alias) => { const target = normalized(alias); const next = source === target ? 1 : source.includes(target) || target.includes(source) ? .72 : 0; if (next > score) { score = next; best = header } }) })
    if (score >= .7) used.add(best); else best = ''
    return [field, best]
  }))
}
function analyze(rows, mapping, existing, XLSX) {
  const accepted = [], errors = [], duplicates = [], seen = new Set(), existingMap = new Map(existing.map((row) => [recordKey(row), row]))
  rows.forEach((source, index) => {
    const get = (field) => mapping[field] ? source[mapping[field]] : ''
    const pay = paymentDate(get('payDate'), XLSX), matricule = normalizeMatricule(get('matricule')), price = numberValue(get('price')), people = numberValue(get('people')), capacity = numberValue(get('capacity'))
    const rowErrors = []
    if (!matricule) rowErrors.push('Matricule manquant')
    if (!pay) rowErrors.push('Date de paiement invalide')
    if (mapping.price && price == null) rowErrors.push('Montant invalide')
    if (mapping.people && !isMissingValue(get('people')) && people == null) rowErrors.push('Nombre de personnes invalide')
    if (mapping.capacity && !isMissingValue(get('capacity')) && capacity == null) rowErrors.push('Capacité invalide')
    const record = { matricule, people, capacity, payDay: pay?.day ?? null, payDate: pay?.date || '', price, remark: clean(get('remark')), responsible: clean(get('responsible')), startMonth: clean(get('startMonth')), company: clean(get('company')), chantier: clean(get('chantier')), location: clean(get('location')) }
    if (rowErrors.length) { errors.push({ line: index + 2, messages: rowErrors, source }); return }
    const key = recordKey(record)
    if (seen.has(key)) { duplicates.push({ line: index + 2, record, key }); return }
    seen.add(key)
    const previous = existingMap.get(key), changes = previous ? Object.keys(record).filter((field) => String(previous[field] ?? '') !== String(record[field] ?? '')).map((field) => ({ field, before: previous[field], after: record[field] })) : []
    accepted.push({ record, key, previous, changes })
  })
  return { accepted, errors, duplicates }
}

export default function ExcelImport({ records, onCommit, currentUser }) {
  const input = useRef(null), parser = useRef(null), [stage, setStage] = useState('idle'), [dragging, setDragging] = useState(false), [file, setFile] = useState(null), [book, setBook] = useState(null), [sheet, setSheet] = useState(''), [mapping, setMapping] = useState({}), [mode, setMode] = useState('merge'), [confirming, setConfirming] = useState(false), [progress, setProgress] = useState(0)
  const authorized = ['RH', 'Founder'].includes(currentUser.role)
  const sheetData = useMemo(() => book?.sheets[sheet] || { headers: [], rows: [] }, [book, sheet])
  const analysis = useMemo(() => book ? analyze(sheetData.rows, mapping, records, parser.current) : null, [book, sheetData, mapping, records])
  const summary = useMemo(() => { if (!analysis) return null; const added = analysis.accepted.filter((item) => !item.previous), updated = analysis.accepted.filter((item) => item.previous && item.changes.length), unchanged = analysis.accepted.filter((item) => item.previous && !item.changes.length); return { added, updated, unchanged, errors: analysis.errors, duplicates: analysis.duplicates } }, [analysis])
  const reset = () => { setStage('idle'); setFile(null); setBook(null); setSheet(''); setMapping({}); setConfirming(false); setProgress(0); if (input.current) input.current.value = '' }
  const load = async (selected) => {
    if (!authorized) return
    if (!selected || !/\.xlsx?$/i.test(selected.name)) { setStage('invalid'); return }
    setFile(selected); setStage('reading'); setProgress(18)
    try {
      const XLSX = (await import('@e965/xlsx')).default; parser.current = XLSX
      const workbook = XLSX.read(await selected.arrayBuffer(), { type: 'array', cellDates: true }); setProgress(50)
      const sheets = Object.fromEntries(workbook.SheetNames.map((name) => { const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: true }); const headerIndex = matrix.findIndex((row) => row.filter((cell) => clean(cell)).length >= 2); const headerRow = matrix[headerIndex] || [], lastColumn = headerRow.reduce((last, value, index) => clean(value) ? index : last, -1); const headers = headerRow.slice(0, lastColumn + 1).map((header, index) => clean(header) || `Colonne ${index + 1}`); const rows = matrix.slice(headerIndex + 1).filter((row) => row.slice(0, headers.length).some((cell) => clean(cell))).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]]))); return [name, { headers, rows, columns: headers.length }] }))
      const first = workbook.SheetNames[0], saved = JSON.parse(localStorage.getItem('tw-excel-mapping') || '{}'); setBook({ names: workbook.SheetNames, sheets }); setSheet(first); setMapping(detect(sheets[first].headers, saved)); setProgress(100); setStage('preview')
    } catch { setStage('invalid') }
  }
  const selectSheet = (name) => { setSheet(name); const saved = JSON.parse(localStorage.getItem('tw-excel-mapping') || '{}'); setMapping(detect(book.sheets[name].headers, saved)) }
  const execute = () => {
    if (!authorized || !summary || summary.errors.length || summary.duplicates.length) return
    setConfirming(false); setStage('importing'); setProgress(15)
    setTimeout(() => setProgress(45), 180); setTimeout(() => setProgress(75), 360)
    setTimeout(async () => {
      const imported = analysis.accepted.map((item) => item.record), existing = new Map(records.map((row) => [recordKey(row), row])); let next
      if (mode === 'replace') next = imported
      else if (mode === 'add') next = [...records, ...summary.added.map((item) => item.record)]
      else { imported.forEach((row) => existing.set(recordKey(row), row)); next = [...existing.values()] }
      try { assertUniqueMatricules(next); localStorage.setItem('tw-excel-mapping', JSON.stringify(mapping)); await onCommit(next, { file: file.name, mode, added: mode === 'replace' ? imported.length : summary.added.length, updated: mode === 'merge' ? summary.updated.length : 0, errors: 0, total: imported.length }); setProgress(100); setStage('success') } catch { setStage('invalid') }
    }, 620)
  }
  if (!authorized) return null
  return <section className="excel-module panel"><header className="excel-title"><span><FileSpreadsheet size={20} /></span><div><h2>Importation Excel</h2><p>Analysez et synchronisez les données de logements en toute sécurité.</p></div>{stage !== 'idle' && <button className="icon" onClick={reset} title="Fermer l’importation"><X size={17} /></button>}</header>
    {stage === 'idle' || stage === 'invalid' ? <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); load(e.dataTransfer.files[0]) }}><UploadCloud size={28} /><h3>Glissez-déposez votre fichier Excel ici</h3><p>Formats acceptés : .xlsx et .xls</p><button className="primary" onClick={() => input.current.click()}>Sélectionner un fichier</button><input ref={input} type="file" accept=".xlsx,.xls" hidden onChange={(e) => load(e.target.files[0])} />{stage === 'invalid' && <span className="upload-error"><AlertTriangle size={14} />Le fichier ne peut pas être lu ou son format n’est pas pris en charge.</span>}</div> : null}
    {stage === 'reading' && <ImportProgress progress={progress} label="Analyse du fichier Excel..." />}
    {stage === 'preview' && <><FileSummary file={file} book={book} sheet={sheet} setSheet={selectSheet} data={sheetData} analysis={analysis} /><Mapping headers={sheetData.headers} mapping={mapping} setMapping={setMapping} /><ImportPreview summary={summary} mode={mode} setMode={setMode} /><div className="import-actions"><span>{summary.errors.length || summary.duplicates.length ? 'Corrigez les erreurs et doublons avant de poursuivre.' : mode === 'add' && summary.updated.length + summary.unchanged.length ? 'Les Matricules existants seront ignorés, sans création de doublons.' : 'Aucune donnée ne sera modifiée avant votre confirmation.'}</span><button className="primary" disabled={summary.errors.length > 0 || summary.duplicates.length > 0} onClick={() => setConfirming(true)}>Préparer l’importation</button></div></>}
    {stage === 'importing' && <ImportProgress progress={progress} label={progress < 45 ? 'Validation des données...' : progress < 75 ? 'Comparaison avec les données existantes...' : 'Actualisation du tableau de bord...'} />}
    {stage === 'success' && <div className="import-success"><span><Check size={25} /></span><h3>Importation terminée avec succès</h3><p>{summary.accepted?.length || analysis.accepted.length} enregistrement(s) traité(s), {mode === 'merge' ? summary.updated.length : 0} mis à jour.</p><button className="secondary" onClick={reset}>Importer un autre fichier</button></div>}
    {confirming && <Confirm mode={mode} summary={summary} close={() => setConfirming(false)} confirm={execute} />}
  </section>
}

function FileSummary({ file, book, sheet, setSheet, data, analysis }) { return <div className="file-summary"><div className="file-name"><FileSpreadsheet size={24} /><section><b>{file.name}</b><span>{(file.size / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko</span></section></div><div className="file-stats"><span><b>{book.names.length}</b> feuille(s)</span><span><b>{data.rows.length}</b> ligne(s)</span><span><b>{data.columns}</b> colonne(s)</span><span><b>{analysis.accepted.length}</b> valide(s)</span><span className={analysis.errors.length ? 'danger-text' : ''}><b>{analysis.errors.length}</b> erreur(s)</span></div><label><span>Feuille sélectionnée</span><div><select value={sheet} onChange={(e) => setSheet(e.target.value)}>{book.names.map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={14} /></div></label></div> }
function Mapping({ headers, mapping, setMapping }) { return <section className="mapping"><header><div><h3>Correspondance des colonnes</h3><p>Vérifiez les champs détectés automatiquement avant l’importation.</p></div><span>{Object.values(mapping).filter(Boolean).length}/{FIELDS.length} détectés</span></header><div>{FIELDS.map(([field, label, required]) => <label key={field}><span>{label}{required && ' *'}</span><select value={mapping[field] || ''} onChange={(e) => setMapping((current) => ({ ...current, [field]: e.target.value }))}><option value="">Non associé</option>{headers.map((header) => <option key={header}>{header}</option>)}</select></label>)}</div></section> }
function ImportPreview({ summary, mode, setMode }) { const visibleUpdated = summary.updated.slice(0, 4), existing = [...summary.updated, ...summary.unchanged]; return <section className="import-preview"><header><h3>Résumé de l’importation</h3><p>Contrôle d’unicité basé exclusivement sur le Matricule.</p></header><div className="summary-cards"><span className="new"><b>{summary.added.length}</b> nouveaux</span><span className="update"><b>{existing.length}</b> existants</span><span className="duplicate"><b>{summary.duplicates.length}</b> doublons</span><span className="error"><b>{summary.errors.length}</b> erreurs</span></div><div className="import-modes">{[['add', 'Ajouter', 'Ajouter uniquement des Matricules absents du système.'], ['merge', 'Mettre à jour', 'Mettre à jour le logement portant ce Matricule ou ajouter un nouveau.'], ['replace', 'Remplacer', 'Remplacer entièrement les données actuelles.']].map(([id, title, text]) => <button className={mode === id ? 'active' : ''} key={id} onClick={() => setMode(id)}><i>{mode === id && <Check size={13} />}</i><span><b>{title}</b><small>{text}</small></span></button>)}</div>{mode === 'add' && existing.length > 0 && <div className="issues existing-conflicts"><header><h4>Matricules déjà existants — ignorés</h4></header>{existing.slice(0, 8).map((item) => <p key={item.key}>{item.record.matricule} — Matricule déjà existant</p>)}</div>}{visibleUpdated.length > 0 && mode === 'merge' && <div className="changes"><h4>Aperçu des modifications</h4>{visibleUpdated.map((item) => <article key={item.key}><b>{item.record.matricule}</b>{item.changes.slice(0, 3).map((change) => <span key={change.field}>{change.field} : <del>{String(change.before ?? '—')}</del> → <strong>{String(change.after ?? '—')}</strong></span>)}</article>)}</div>}{(summary.errors.length > 0 || summary.duplicates.length > 0) && <Issues summary={summary} />}</section> }
function Issues({ summary }) { const download = () => { const lines = ['Ligne;Type;Détail', ...summary.errors.map((item) => `${item.line};Erreur;${item.messages.join(', ')}`), ...summary.duplicates.map((item) => `${item.line};Doublon;${item.key}`)]; const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv' })); link.download = 'erreurs-importation.csv'; link.click(); URL.revokeObjectURL(link.href) }; return <div className="issues"><header><h4>Erreurs détectées</h4><button onClick={download}><Download size={14} />Télécharger la liste</button></header>{summary.errors.slice(0, 5).map((item) => <p key={item.line}>Ligne {item.line} — {item.messages.join(', ')}</p>)}{summary.duplicates.slice(0, 5).map((item) => <p key={item.line}>Ligne {item.line} — Doublon détecté : {item.record.matricule}</p>)}</div> }
function ImportProgress({ progress, label }) { return <div className="import-progress"><LoaderCircle size={27} /><h3>{label}</h3><div><i style={{ width: `${progress}%` }} /></div><span>{progress}%</span></div> }
function Confirm({ mode, summary, close, confirm }) { const replace = mode === 'replace'; return <div className="import-confirm"><button className="backdrop" onClick={close} /><div><span className={replace ? 'warning' : ''}>{replace ? <AlertTriangle size={25} /> : <FileSpreadsheet size={25} />}</span><h3>{replace ? 'Attention' : 'Confirmer l’importation'}</h3><p>{replace ? 'Cette action remplacera les données actuellement présentes dans le système. Cette opération peut entraîner une perte de données.' : `${summary.added.length} nouveau(x) et ${summary.updated.length} enregistrement(s) à mettre à jour ont été identifiés.`}</p><footer><button className="secondary" onClick={close}>Annuler</button><button className={`primary ${replace ? 'replace' : ''}`} onClick={confirm}>{replace ? 'Confirmer le remplacement' : 'Confirmer l’importation'}</button></footer></div></div> }

export function ImportHistory({ history }) { if (!history.length) return null; const labels = { add: 'Ajout', merge: 'Mise à jour', replace: 'Remplacement' }; return <section className="import-history panel"><header><History size={19} /><div><h2>Historique des importations</h2><p>Dernières synchronisations réalisées sur cet appareil.</p></div></header><div className="history-table"><table><thead><tr><th>Fichier</th><th>Date</th><th>Utilisateur</th><th>Mode</th><th>Nouveaux</th><th>Mises à jour</th><th>Statut</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td><FileSpreadsheet size={14} />{item.file}</td><td>{new Date(item.date).toLocaleString('fr-FR')}</td><td>{item.user}</td><td>{labels[item.mode]}</td><td>{item.added}</td><td>{item.updated}</td><td><span><Check size={12} />Réussi</span></td></tr>)}</tbody></table></div></section> }
