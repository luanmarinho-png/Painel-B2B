/**
 * Netlify Function: envia e-mail de boletim individual via SendGrid.
 * Variáveis no Netlify: SENDGRID_API_KEY ou sendgrid_key; opcional SENDGRID_FROM_EMAIL (padrão Nao-responda@grupomedcof.com.br).
 * Template canônico: templates/email-boletim-individual.html (manter placeholders alinhados ao HTML embutido abaixo).
 */

const SUPABASE_URL = 'https://cvwwucxjrpsfoxarsipr.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDIxMzgsImV4cCI6MjA5MDg3ODEzOH0.GdpReqo9giSC607JQge8HA9CmZWi-2TcVggU4jCwZhI';

const DEFAULT_FROM_EMAIL = 'Nao-responda@grupomedcof.com.br';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

/** Corpo HTML — espelha templates/email-boletim-individual.html */
const BOLETIM_EMAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f6f4;font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f6f4;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dce8dd;box-shadow:0 8px 24px rgba(17,54,20,0.08);">
        <tr><td style="background:linear-gradient(135deg,#166534,#22c55e);padding:28px 24px;text-align:center;">
          <p style="margin:0;font-size:13px;letter-spacing:0.06em;color:rgba(255,255,255,0.9);text-transform:uppercase;">MedCof × IES</p>
          <h1 style="margin:10px 0 0;font-size:22px;font-weight:800;color:#ffffff;line-height:1.25;">Seu boletim individual</h1>
        </td></tr>
        <tr><td style="padding:28px 24px;text-align:left;color:#455245;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 16px;">Olá, <strong>{{NOME_ALUNO}}</strong>,</p>
          <p style="margin:0 0 16px;">Segue o resultado individual referente ao simulado <strong>{{TITULO_SIMULADO}}</strong> na <strong>{{NOME_IES}}</strong>.</p>
          <p style="margin:0 0 20px;">O documento em PDF está anexado a este e-mail. Caso não visualize o anexo, verifique a pasta de spam ou entre em contato com a coordenação do seu curso.</p>
          {{TEXTO_EXTRA}}
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0;"><tr><td align="center">
            <a href="{{LINK_BOLETIM}}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#1B6D85,#22c55e);color:#ffffff !important;text-decoration:none;font-weight:700;font-size:14px;border-radius:10px;">Abrir material complementar</a>
          </td></tr></table>
          <p style="margin:0;font-size:13px;color:#6c7b6c;">Este é um envio automático. Em caso de dúvida, responda ao canal oficial indicado pela sua instituição.</p>
        </td></tr>
        <tr><td style="padding:16px 24px;background:#f8faf8;border-top:1px solid #e9f1ea;text-align:center;font-size:12px;color:#6c7b6c;">
          <p style="margin:0;">Grupo MedCof · Apoio ao desempenho em medicina</p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#94a394;">Se você não esperava este e-mail, pode ignorá-lo com segurança.</p>
    </td></tr>
  </table>
</body>
</html>`;

/** Aviso à coordenação com anexos: relatório PDF, planilha Excel e ZIP de boletins individuais. */
const COORD_BOLETINS_AVISO_TEMPLATE = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f6f4;font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f6f4;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dce8dd;box-shadow:0 8px 24px rgba(17,54,20,0.08);">
        <tr><td style="background:linear-gradient(135deg,#166534,#22c55e);padding:28px 24px;text-align:center;">
          <p style="margin:0;font-size:13px;letter-spacing:0.06em;color:rgba(255,255,255,0.9);text-transform:uppercase;">MedCof × IES</p>
          <h1 style="margin:10px 0 0;font-size:22px;font-weight:800;color:#ffffff;line-height:1.25;">Pacote do simulado</h1>
        </td></tr>
        <tr><td style="padding:28px 24px;text-align:left;color:#455245;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 16px;">Olá, <strong>{{NOME_DESTINATARIO}}</strong>,</p>
          <p style="margin:0 0 16px;">Segue o pacote referente ao simulado <strong>{{TITULO_SIMULADO}}</strong> na <strong>{{NOME_IES}}</strong>.</p>
          <p style="margin:0 0 12px;font-weight:700;color:#455245;">Anexos deste e-mail</p>
          <ul style="margin:0 0 18px;padding-left:20px;line-height:1.55;">
            <li><strong>Relatório em PDF</strong> — visão executiva da turma (ranking, distribuição, áreas e recomendações).</li>
            <li><strong>Planilha Excel (.xlsx)</strong> — análise estatística: resumo, ranking, questões, matriz de respostas e pivôs.</li>
            <li><strong>Arquivo ZIP</strong> — boletins individuais em PDF (um arquivo por aluno).</li>
          </ul>
          <p style="margin:0 0 20px;font-size:14px;color:#5c6b5c;">Para encaminhar cada boletim aos alunos por e-mail, use a seção <strong>Alunos cadastrados</strong> no painel administrativo (escolha o simulado e confirme antes do envio).</p>
          {{TEXTO_EXTRA}}
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0;"><tr><td align="center">
            <a href="{{LINK_PAINEL}}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#1B6D85,#22c55e);color:#ffffff !important;text-decoration:none;font-weight:700;font-size:14px;border-radius:10px;">Abrir painel administrativo</a>
          </td></tr></table>
          <p style="margin:0;font-size:13px;color:#6c7b6c;">Se não visualizar os anexos, verifique o tamanho da caixa de entrada e a pasta de spam. Envio automático — Grupo MedCof.</p>
        </td></tr>
        <tr><td style="padding:16px 24px;background:#f8faf8;border-top:1px solid #e9f1ea;text-align:center;font-size:12px;color:#6c7b6c;">
          <p style="margin:0;">Grupo MedCof · Apoio ao desempenho em medicina</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

/**
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
function fillTemplate(template, vars) {
  let out = template;
  Object.keys(vars).forEach((k) => {
    const val = vars[k] == null ? '' : String(vars[k]);
    out = out.split(`{{${k}}}`).join(val);
  });
  return out;
}

/**
 * @param {string} name
 * @returns {string}
 */
function safeFilename(name) {
  return String(name || 'arquivo')
    .replace(/[^\w.\-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 180) || 'arquivo';
}

/**
 * Monta lista de anexos SendGrid a partir do body (legado + array).
 * @param {Record<string, unknown>} body
 * @returns {{ content: string, filename: string, type: string, disposition: string }[]}
 */
function collectAttachments(body) {
  const out = [];
  if (body.pdf_base64 && body.pdf_filename) {
    let leg = String(body.pdf_filename).trim().replace(/[^\w.\-]/g, '_') || 'boletim';
    if (!leg.toLowerCase().endsWith('.pdf')) leg += '.pdf';
    out.push({
      content: String(body.pdf_base64).replace(/\s/g, ''),
      filename: leg,
      type: 'application/pdf',
      disposition: 'attachment'
    });
  }
  const extra = body.attachments;
  if (Array.isArray(extra)) {
    extra.forEach((a) => {
      if (!a || !a.content_base64 || !a.filename) return;
      const fn = safeFilename(a.filename);
      const lower = fn.toLowerCase();
      let type = String(a.type || '').trim();
      if (!type) {
        if (lower.endsWith('.xlsx')) type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        else if (lower.endsWith('.zip')) type = 'application/zip';
        else if (lower.endsWith('.pdf')) type = 'application/pdf';
        else type = 'application/octet-stream';
      }
      out.push({
        content: String(a.content_base64).replace(/\s/g, ''),
        filename: fn,
        type,
        disposition: 'attachment'
      });
    });
  }
  return out;
}

/**
 * @param {string} token
 * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
 */
async function validateStaffAccess(token) {
  if (!token) return { ok: false, status: 401, error: 'supabase_access_token obrigatório' };
  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!userResp.ok) return { ok: false, status: 401, error: 'Sessão inválida ou expirada' };
  const user = await userResp.json();
  const role = (user.user_metadata || {}).role;
  if (role === 'admin' || role === 'superadmin' || role === 'coordenador') return { ok: true };
  return { ok: false, status: 403, error: 'Acesso negado — apenas admin ou coordenador' };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const sgKey = process.env.SENDGRID_API_KEY || process.env.sendgrid_key;
  const fromEmail = (
    process.env.SENDGRID_FROM_EMAIL ||
    process.env.sendgrid_from_email ||
    DEFAULT_FROM_EMAIL
  ).trim();

  if (!sgKey) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({
        error:
          'Configure SENDGRID_API_KEY (ou sendgrid_key) no Netlify → Environment variables → escopo Functions, depois redeploy.'
      })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const access = await validateStaffAccess(body.supabase_access_token);
  if (!access.ok) {
    return { statusCode: access.status || 403, headers: CORS, body: JSON.stringify({ error: access.error }) };
  }

  const to = (body.to || '').trim();
  const nomeAluno = (body.nome_aluno || '').trim();
  const tituloSimulado = (body.titulo_simulado || '').trim();
  const nomeIes = (body.nome_ies || '').trim();
  if (!to || !nomeAluno || !tituloSimulado || !nomeIes) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Campos obrigatórios: to, nome_aluno, titulo_simulado, nome_ies' })
    };
  }

  const linkBoletim = (body.link_boletim || '#').trim() || '#';
  const textoExtra = (body.texto_extra_html || '').trim();
  const notificacaoCoord = body.notificacao_coordenador === true;

  const subject =
    (body.subject || '').trim() ||
    (notificacaoCoord
      ? `Pacote do simulado (PDF + Excel + boletins) — ${tituloSimulado} · ${nomeIes}`
      : `Boletim individual — ${tituloSimulado} · ${nomeIes}`);

  const html = notificacaoCoord
    ? fillTemplate(COORD_BOLETINS_AVISO_TEMPLATE, {
        NOME_DESTINATARIO: nomeAluno,
        TITULO_SIMULADO: tituloSimulado,
        NOME_IES: nomeIes,
        LINK_PAINEL: linkBoletim,
        TEXTO_EXTRA: textoExtra
      })
    : fillTemplate(BOLETIM_EMAIL_TEMPLATE, {
        NOME_ALUNO: nomeAluno,
        TITULO_SIMULADO: tituloSimulado,
        NOME_IES: nomeIes,
        LINK_BOLETIM: linkBoletim,
        TEXTO_EXTRA: textoExtra
      });

  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: fromEmail, name: body.from_name || 'Grupo MedCof' },
    subject,
    content: [{ type: 'text/html', value: html }]
  };

  const att = collectAttachments(body);
  if (att.length) {
    payload.attachments = att;
  }

  const sgResp = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sgKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!sgResp.ok) {
    const errTxt = await sgResp.text();
    let errObj = errTxt;
    try {
      errObj = JSON.parse(errTxt);
    } catch (_) {}
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ error: 'SendGrid rejeitou o envio', details: errObj })
    };
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
};
