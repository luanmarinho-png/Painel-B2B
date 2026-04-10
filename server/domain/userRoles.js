/**
 * Regras de papel de usuário no painel (metadata Supabase Auth).
 */

/**
 * @param {string | undefined} role
 * @returns {boolean}
 */
function isPrivilegedAdmin(role) {
  return role === 'admin' || role === 'superadmin';
}

/**
 * @param {string | undefined} role
 * @returns {boolean}
 */
function isSuperadmin(role) {
  return role === 'superadmin';
}

module.exports = { isPrivilegedAdmin, isSuperadmin };
