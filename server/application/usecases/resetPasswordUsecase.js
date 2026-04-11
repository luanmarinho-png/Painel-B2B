/**
 * Gera link de recuperação (Supabase generate_link) e envia por e-mail via SendGrid quando configurado.
 */

const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');
const { isMongoDataBackend } = require('../../infrastructure/mongo/isMongoData');
const { executePostgrestMongo } = require('../../infrastructure/mongo/postgrestMongoAdapter');
const { sendSendgridHtml } = require('../../infrastructure/email/sendgridSend');

const REDIRECT_TO = process.env.PASSWORD_RESET_REDIRECT_URL || 'https://grupomedcof.org/nova-senha.html';

/**
 * @param {string} actionLink
 * @returns {string}
 */
function escapeHtmlAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * @param {string} actionLink
 * @returns {string}
 */
function passwordResetEmailHtml(actionLink) {
  const href = escapeHtmlAttr(actionLink);
  const plain = String(actionLink);
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f6f4;font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f6f4;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="background:linear-gradient(135deg,#991b1b,#dc2626);padding:28px 24px;text-align:center;">
          <p style="margin:0;font-size:13px;letter-spacing:0.06em;color:rgba(255,255,255,0.9);text-transform:uppercase;">MedCof B2B</p>
          <h1 style="margin:10px 0 0;font-size:22px;font-weight:800;color:#fff;">Redefinir sua senha</h1>
        </td></tr>
        <tr><td style="padding:28px 24px;color:#374151;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 16px;">Recebemos um pedido para redefinir a senha da sua conta (admin ou coordenação).</p>
          <p style="margin:0 0 20px;">Clique no botão abaixo. O link expira em poucos minutos por segurança.</p>
          <table role="presentation" width="100%"><tr><td align="center">
            <a href="${href}" style="display:inline-block;padding:14px 28px;background:#dc2626;color:#fff !important;text-decoration:none;font-weight:700;font-size:15px;border-radius:10px;">Criar nova senha</a>
          </td></tr></table>
          <p style="margin:20px 0 0;font-size:12px;color:#6b7280;word-break:break-all;">Se o botão não funcionar, copie e cole no navegador:<br/>${plain}</p>
          <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">Se você não solicitou, ignore este e-mail.</p>
        </td></tr>
        <tr><td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;font-size:12px;color:#9ca3af;">
          Grupo MedCof — uso interno
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const NOT_FOUND_BODY = JSON.stringify({
  ok: true,
  message: 'Se este e-mail estiver cadastrado no sistema, o link será gerado.'
});

/**
 * @param {object} params
 * @param {string} params.email
 * @param {Record<string, string>} params.corsHeaders
 * @returns {Promise<{ statusCode: number, headers: Record<string, string>, body: string }>}
 */
async function executeResetPassword({ email, corsHeaders }) {
  const env = getSupabaseEnv();
  const { url: SUPABASE_URL, serviceRoleKey: SERVICE_KEY } = env;

  const notFoundResponse = {
    statusCode: 200,
    headers: corsHeaders,
    body: NOT_FOUND_BODY
  };

  try {
    const authResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const authData = await authResp.json();
    const authUser = (authData.users || []).find((u) => u.email === email);

    if (!authUser) return notFoundResponse;

    const role = authUser.user_metadata?.role || '';
    const isAdmin = role === 'superadmin' || role === 'admin';

    if (!isAdmin) {
      let wlData = [];
      if (isMongoDataBackend()) {
        const mr = await executePostgrestMongo({
          table: 'usuarios_autorizados',
          query: `select=email&email=eq.${encodeURIComponent(email)}&ativo=eq.true`,
          method: 'GET',
          body: null,
          prefer: null,
          range: null,
          maskSensitive: false
        });
        if (mr.statusCode !== 200) {
          return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Erro interno ao verificar cadastro.' })
          };
        }
        try {
          wlData = JSON.parse(mr.body || '[]');
        } catch {
          wlData = [];
        }
      } else {
        const wlResp = await fetch(
          `${SUPABASE_URL}/rest/v1/usuarios_autorizados?email=eq.${encodeURIComponent(email)}&ativo=eq.true&select=email`,
          { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
        );
        if (!wlResp.ok) {
          return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Erro interno ao verificar cadastro.' })
          };
        }
        wlData = await wlResp.json();
      }
      if (!Array.isArray(wlData) || wlData.length === 0) return notFoundResponse;
    }

    const linkResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'recovery',
        email,
        options: { redirect_to: REDIRECT_TO }
      })
    });

    if (!linkResp.ok) {
      const err = await linkResp.json();
      console.error('Erro generate_link:', err);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Erro ao gerar link de recuperação.' })
      };
    }

    const { action_link } = await linkResp.json();

    const hasSendgrid = !!(process.env.SENDGRID_API_KEY || process.env.sendgrid_key);

    if (hasSendgrid) {
      const sg = await sendSendgridHtml({
        to: email,
        subject: 'MedCof B2B — Redefinir senha',
        html: passwordResetEmailHtml(action_link)
      });
      if (!sg.ok) {
        console.error('SendGrid reset-password:', sg.error);
        return {
          statusCode: 502,
          headers: corsHeaders,
          body: JSON.stringify({
            error: 'Não foi possível enviar o e-mail. Tente novamente ou contate o suporte.'
          })
        };
      }
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: true,
          sent: true,
          message: 'Se este e-mail estiver cadastrado, você receberá o link em instantes.'
        })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, link: action_link })
    };
  } catch (err) {
    console.error('reset-password error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Erro interno: ' + err.message })
    };
  }
}

module.exports = { executeResetPassword };
