const request = async (url, options = {}) => {
  const response = await fetch(url, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || 'Une erreur est survenue.')
  return body
}
let csrf = ''
export const api = {
  session: async () => { const result = await request('/api/auth/session'); csrf = result.csrf; return result },
  login: async (email, password) => { const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); csrf = result.csrf; return result },
  logout: () => request('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf } }),
  completePasswordReset: (password, confirmation) => request('/api/auth/complete-password-reset', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify({ password, confirmation }) }),
  housing: () => request('/api/housing'),
  createHousing: (record) => request('/api/housing', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify(record) }),
  updateHousing: (key, record) => request(`/api/housing/${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify(record) }),
  deleteHousing: (key) => request(`/api/housing/${encodeURIComponent(key)}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrf } }),
  syncHousing: (records, mode, file) => request('/api/housing/sync', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify({ records, mode, file }) }),
  resetHousing: () => request('/api/housing', { method: 'DELETE', headers: { 'X-CSRF-Token': csrf } }),
  users: () => request('/api/users'),
  createUser: (data) => request('/api/users', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/api/users/${id}`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify(data) }),
  resetPassword: (id, temporaryPassword) => request(`/api/users/${id}/reset-password`, { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify({ temporaryPassword }) }),
  deleteUser: (id) => request(`/api/users/${id}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrf } }),
  updateProfile: (name) => request('/api/profile', { method: 'PATCH', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify({ name }) }),
  changePassword: (currentPassword, newPassword) => request('/api/profile/password', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify({ currentPassword, newPassword }) }),
  history: () => request('/api/import-history'),
  health: () => request('/api/health'),
}
