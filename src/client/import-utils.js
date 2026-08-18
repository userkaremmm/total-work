export const normalizeMatricule = (value) => String(value ?? '').trim().toUpperCase().replace(/\s+/g, '')

export const recordKey = (row) => normalizeMatricule(row.matricule)

export function assertUniqueMatricules(records) {
  const seen = new Set()
  for (const record of records) {
    const key = recordKey(record)
    if (!key || seen.has(key)) throw new Error('Ce matricule existe déjà dans le système.')
    seen.add(key)
  }
  return records
}
