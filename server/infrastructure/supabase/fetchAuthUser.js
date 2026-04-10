/**
 * Valida JWT do usuário final contra Auth API (anon key).
 */

/**
 * @param {string} supabaseUrl
 * @param {string} anonKey
 * @param {string} bearerToken
 * @param {string} [invalidTokenMessage]
 * @returns {Promise<{ ok: true, user: object } | { ok: false, status: number, error: string }>}
 */
async function fetchAuthUser(supabaseUrl, anonKey, bearerToken, invalidTokenMessage = 'Token inválido') {
  const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${bearerToken}`
    }
  });

  if (!userResp.ok) {
    return { ok: false, status: 401, error: invalidTokenMessage };
  }

  const user = await userResp.json();
  return { ok: true, user };
}

module.exports = { fetchAuthUser };
