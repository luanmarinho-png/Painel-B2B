/**
 * Envio simples HTML via SendGrid API v3 (reutilizável por reset de senha, etc.).
 */

const DEFAULT_FROM = 'Nao-responda@grupomedcof.com.br';

/**
 * @param {object} params
 * @param {string} params.to
 * @param {string} params.subject
 * @param {string} params.html
 * @param {string} [params.fromEmail]
 * @param {string} [params.fromName]
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function sendSendgridHtml({ to, subject, html, fromEmail, fromName }) {
  const sgKey = (process.env.SENDGRID_API_KEY || process.env.sendgrid_key || '').trim();
  if (!sgKey) {
    return { ok: false, error: 'SENDGRID_API_KEY não configurada' };
  }
  const from = (fromEmail || process.env.SENDGRID_FROM_EMAIL || process.env.sendgrid_from_email || DEFAULT_FROM).trim();

  const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sgKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: String(to).trim() }] }],
      from: { email: from, name: fromName || 'Grupo MedCof' },
      subject: String(subject),
      content: [{ type: 'text/html', value: html }]
    })
  });

  if (!resp.ok) {
    const txt = await resp.text();
    return { ok: false, error: txt || `HTTP ${resp.status}` };
  }
  return { ok: true };
}

module.exports = { sendSendgridHtml, DEFAULT_FROM };
