/**
 * Cofbot no painel admin B2B — chama a mesma Netlify Function do coordenador (coordenador-chat).
 * Requer window._getAdminToken e select #updateInst populado (ou vazio até carregar IES).
 */
(function () {
  'use strict';

  var CHAT_URL = (typeof location !== 'undefined' && location.origin
    ? location.origin + '/.netlify/functions/coordenador-chat'
    : '/.netlify/functions/coordenador-chat');

  /** @type {{ tab: string, label: string }[]} */
  var ADMIN_TAB_NAV = [
    { tab: 'institutions', label: 'Instituições' },
    { tab: 'update', label: 'Atualizar dados' },
    { tab: 'simulados', label: 'Gestão simulados' },
    { tab: 'cadastro-sim', label: 'Cadastro simulados' },
    { tab: 'users', label: 'Usuários' }
  ];

  function getAdminSuggestions() {
    return [
      'O que conferir antes de subir uma planilha de engajamento?',
      'Como explicar para a coordenação o banner de dados desatualizados?',
      'Qual a diferença de papel entre admin e coordenador no MedCof?'
    ];
  }

  /**
   * Copia opções do select de upload para o select do Cofbot.
   * @param {HTMLSelectElement | null} target
   */
  function refreshIesOptions(target) {
    var src = document.getElementById('updateInst');
    if (!src || !target) return;
    var cur = target.value;
    target.innerHTML = src.innerHTML;
    if (cur) {
      for (var i = 0; i < target.options.length; i++) {
        if (target.options[i].value === cur) {
          target.value = cur;
          break;
        }
      }
    }
  }

  /**
   * Monta contexto JSON para o modelo (sem PII além do que a UI já mostra).
   * @returns {Record<string, unknown>}
   */
  function buildAdminCofbotContext() {
    var tabEl = document.querySelector('.dash-tab.active');
    var activeTab = tabEl && tabEl.getAttribute('data-tab') ? tabEl.getAttribute('data-tab') : '';
    var sel = document.getElementById('medcofAdminCofbotIes');
    var slug = sel && sel.value ? String(sel.value).trim() : '';
    var name = '';
    if (sel && sel.selectedOptions && sel.selectedOptions[0]) {
      name = String(sel.selectedOptions[0].textContent || '').trim();
    }
    var staleEl = document.getElementById('staleUpdateBanner');
    var staleVisible = false;
    if (staleEl) {
      var sd = staleEl.style.display;
      staleVisible = sd === 'block' || (sd === '' && staleEl.getBoundingClientRect().height > 0);
    }
    return {
      adminPanel: true,
      activeTab: activeTab,
      institution: { slug: slug, name: name },
      path: typeof location !== 'undefined' ? location.pathname : '',
      generatedAt: new Date().toISOString(),
      staleDataBannerVisible: staleVisible,
      orientacaoMedCof: {
        metaQuestoesPorDia: 20,
        focoProva: 'ENAMED',
        nota: 'Assistente para gestores MedCof; não inventar números nem comparar IES sem dados no contexto.'
      }
    };
  }

  /**
   * Ativa aba do dashboard admin (mesmo comportamento do clique em .dash-tab).
   * @param {string} tab
   */
  function activateAdminTab(tab) {
    if (!tab) return;
    var btn = document.querySelector('.dash-tab[data-tab="' + tab + '"]');
    if (btn) btn.click();
  }

  /**
   * Injeta FAB + painel (idempotente).
   */
  function mountAdminCofbot() {
    if (document.getElementById('medcof-admin-cofbot-root')) return;

    var root = document.createElement('div');
    root.id = 'medcof-admin-cofbot-root';
    root.className = 'medcof-admin-cofbot-root--br';
    var nudgeTri =
      '<svg class="medcof-admin-cofbot-nudge-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5 L20 19 H4 Z"/></svg>';
    root.innerHTML =
      '<div class="medcof-admin-cofbot-fab-cluster">' +
      '<button type="button" class="medcof-admin-cofbot-nudge medcof-admin-cofbot-nudge--tl" data-cofbot-corner="tl" aria-label="Cofbot no canto superior esquerdo">' +
      nudgeTri +
      '</button>' +
      '<button type="button" class="medcof-admin-cofbot-nudge medcof-admin-cofbot-nudge--tr" data-cofbot-corner="tr" aria-label="Cofbot no canto superior direito">' +
      nudgeTri +
      '</button>' +
      '<button type="button" class="medcof-admin-cofbot-nudge medcof-admin-cofbot-nudge--bl" data-cofbot-corner="bl" aria-label="Cofbot no canto inferior esquerdo">' +
      nudgeTri +
      '</button>' +
      '<button type="button" class="medcof-coord-chat-fab" id="medcofAdminCofbotFab" aria-label="Abrir Cofbot — assistente no painel admin" aria-expanded="false">' +
      '<img class="medcof-coord-chat-fab-icon" src="/assets/coordenador-chat-fab.png" alt="" width="50" height="58" decoding="async" draggable="false" />' +
      '</button>' +
      '</div>' +
      '<div class="medcof-coord-chat-panel" id="medcofAdminCofbotPanel" hidden>' +
      '<div class="medcof-coord-chat-head medcof-admin-cofbot-head">' +
      '<div class="medcof-admin-cofbot-head-main">' +
      '<div class="medcof-admin-cofbot-avatar" aria-hidden="true"><img src="/assets/coordenador-chat-fab.png" alt="" width="36" height="42" decoding="async" draggable="false" /></div>' +
      '<div>' +
      '<div class="medcof-coord-chat-title">Cofbot</div>' +
      '<div class="medcof-coord-chat-sub">Apoio à gestão MedCof — escolha a IES em foco para cruzar com os dados da base</div>' +
      '</div>' +
      '</div>' +
      '<div class="medcof-admin-cofbot-head-actions">' +
      '<button type="button" class="medcof-admin-cofbot-icon-btn" id="medcofAdminCofbotExpand" aria-label="Expandir painel" title="Expandir">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>' +
      '</button>' +
      '<button type="button" class="medcof-admin-cofbot-icon-btn" id="medcofAdminCofbotDock" aria-label="Mudar posição do Cofbot na página" title="Posição na tela">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="12" height="12" rx="2"/><path d="M14 10h6v6a2 2 0 0 1-2 2h-6"/></svg>' +
      '</button>' +
      '<button type="button" class="medcof-admin-cofbot-icon-btn" id="medcofAdminCofbotClear" aria-label="Limpar histórico do chat" title="Limpar histórico">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>' +
      '</button>' +
      '<button type="button" class="medcof-coord-chat-close" id="medcofAdminCofbotClose" aria-label="Fechar">×</button>' +
      '</div>' +
      '</div>' +
      '<div class="medcof-admin-cofbot-ies-wrap">' +
      '<label for="medcofAdminCofbotIes">IES em foco</label>' +
      '<select id="medcofAdminCofbotIes"><option value="">Selecione uma instituição…</option></select>' +
      '</div>' +
      '<div class="medcof-admin-cofbot-nav" id="medcofAdminCofbotNav" aria-label="Atalhos do painel"></div>' +
      '<div class="medcof-coord-chat-suggestions" id="medcofAdminCofbotSuggestions">' +
      '<div class="medcof-coord-chat-insight" id="medcofAdminCofbotInsight" hidden></div>' +
      '<div class="medcof-coord-chat-chips" id="medcofAdminCofbotChips"></div>' +
      '</div>' +
      '<div class="medcof-coord-chat-messages" id="medcofAdminCofbotMessages"></div>' +
      '<div class="medcof-coord-chat-error" id="medcofAdminCofbotError" hidden></div>' +
      '<form class="medcof-coord-chat-form" id="medcofAdminCofbotForm">' +
      '<input type="text" class="medcof-coord-chat-input" id="medcofAdminCofbotInput" placeholder="Ex.: como orientar a coordenação sobre o upload?" autocomplete="off" maxlength="2000" />' +
      '<button type="submit" class="medcof-coord-chat-send" id="medcofAdminCofbotSend">Enviar</button>' +
      '</form>' +
      '<div class="medcof-admin-cofbot-resize-grip" aria-hidden="true"></div>' +
      '</div>';
    document.body.appendChild(root);

    var panel = document.getElementById('medcofAdminCofbotPanel');
    var fab = document.getElementById('medcofAdminCofbotFab');
    var closeBtn = document.getElementById('medcofAdminCofbotClose');
    var insightEl = document.getElementById('medcofAdminCofbotInsight');
    var chipsEl = document.getElementById('medcofAdminCofbotChips');
    var messagesEl = document.getElementById('medcofAdminCofbotMessages');
    var errorEl = document.getElementById('medcofAdminCofbotError');
    var form = document.getElementById('medcofAdminCofbotForm');
    var input = document.getElementById('medcofAdminCofbotInput');
    var sendBtn = document.getElementById('medcofAdminCofbotSend');
    var iesSel = document.getElementById('medcofAdminCofbotIes');
    var navEl = document.getElementById('medcofAdminCofbotNav');

    var COF_CORNER_KEY = 'medcofAdminCofbotCorner';
    var CORNERS = ['br', 'bl', 'tr', 'tl'];

    /**
     * Fixa o widget Cofbot em um canto da viewport e persiste a escolha.
     * @param {string} pos
     */
    function applyCofbotCorner(pos) {
      if (CORNERS.indexOf(pos) < 0) pos = 'br';
      root.className = 'medcof-admin-cofbot-root--' + pos;
      try {
        localStorage.setItem(COF_CORNER_KEY, pos);
      } catch (err) {}
    }

    function loadCofbotCorner() {
      var pos = 'br';
      try {
        pos = localStorage.getItem(COF_CORNER_KEY) || 'br';
      } catch (e) {}
      applyCofbotCorner(pos);
    }

    loadCofbotCorner();

    root.querySelectorAll('[data-cofbot-corner]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        var pos = btn.getAttribute('data-cofbot-corner');
        applyCofbotCorner(pos || 'br');
      });
    });

    var expandBtn = document.getElementById('medcofAdminCofbotExpand');
    var dockBtn = document.getElementById('medcofAdminCofbotDock');
    if (expandBtn && panel) {
      expandBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var fs = panel.classList.toggle('medcof-admin-cofbot-panel--fullscreen');
        expandBtn.setAttribute('aria-pressed', fs ? 'true' : 'false');
      });
    }
    if (dockBtn) {
      dockBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var cur = 'br';
        try {
          cur = localStorage.getItem(COF_CORNER_KEY) || 'br';
        } catch (e2) {}
        var idx = CORNERS.indexOf(cur);
        var next = CORNERS[(idx < 0 ? 0 : idx + 1) % CORNERS.length];
        applyCofbotCorner(next);
      });
    }

    var panelOpen = false;
    /** @type {{ role: string, content: string }[]} */
    var thread = [];
    /** Persistência do histórico entre páginas do painel (mesma aba). */
    var SESSION_KEY = 'medcofAdminCofbotSession';
    var lastInsight = '';
    /** @type {string[]} */
    var lastFollowUps = [];

    /**
     * Grava thread + sugestões no sessionStorage (não sobrevive ao fechar a aba).
     */
    function persistAdminCofbotSession() {
      try {
        sessionStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            v: 1,
            thread: thread,
            insight: lastInsight,
            followUps: lastFollowUps,
            ies: iesSel && iesSel.value ? String(iesSel.value) : ''
          })
        );
      } catch (err) {}
    }

    /**
     * Restaura mensagens e IES após navegação; retorna true se havia histórico.
     * @returns {boolean}
     */
    function restoreAdminCofbotSession() {
      try {
        var raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return false;
        var data = JSON.parse(raw);
        if (!data || data.v !== 1 || !Array.isArray(data.thread) || data.thread.length === 0) {
          return false;
        }
        thread = data.thread;
        lastInsight = typeof data.insight === 'string' ? data.insight : '';
        lastFollowUps = Array.isArray(data.followUps) ? data.followUps : [];
        if (iesSel && data.ies) {
          refreshIesOptions(iesSel);
          iesSel.value = data.ies;
        }
        thread.forEach(function (m) {
          if (m && (m.role === 'user' || m.role === 'assistant') && m.content != null) {
            appendMessage(m.role, m.content);
          }
        });
        if (lastInsight || (lastFollowUps && lastFollowUps.length)) {
          applyFollowUps(lastInsight, lastFollowUps);
        } else {
          renderSuggestions();
        }
        return true;
      } catch (e) {
        return false;
      }
    }

    if (navEl) {
      ADMIN_TAB_NAV.forEach(function (item) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'medcof-admin-cofbot-nav-btn';
        b.textContent = item.label;
        b.addEventListener('click', function () {
          activateAdminTab(item.tab);
        });
        navEl.appendChild(b);
      });
    }

    /**
     * Escapa HTML e aplica negrito Markdown (`**texto**`) nas mensagens do assistente.
     * @param {string} text
     * @returns {string}
     */
    function renderCofbotAssistantHtml(text) {
      return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    }

    function setInsight(text) {
      var t = String(text || '').trim();
      if (!t || !insightEl) {
        if (insightEl) {
          insightEl.hidden = true;
          insightEl.textContent = '';
        }
        return;
      }
      insightEl.hidden = false;
      insightEl.innerHTML = renderCofbotAssistantHtml(t);
    }

    function bindChips(chips) {
      if (!chipsEl) return;
      chipsEl.innerHTML = chips
        .map(function (text) {
          var safe = document.createElement('span');
          safe.textContent = text;
          return '<button type="button" class="medcof-coord-chat-chip">' + safe.innerHTML + '</button>';
        })
        .join('');
      chipsEl.querySelectorAll('.medcof-coord-chat-chip').forEach(function (btn, i) {
        btn.addEventListener('click', function () {
          if (input) input.value = chips[i];
          if (form) form.requestSubmit();
        });
      });
    }

    function renderSuggestions() {
      lastInsight = '';
      lastFollowUps = [];
      setInsight('');
      bindChips(getAdminSuggestions());
    }

    function applyFollowUps(insight, followUps) {
      var list = Array.isArray(followUps) ? followUps.filter(function (s) { return String(s || '').trim(); }) : [];
      lastInsight = String(insight || '').trim();
      lastFollowUps = list.slice();
      setInsight(insight || '');
      bindChips(list.length ? list : getAdminSuggestions());
    }

    function appendMessage(role, text) {
      var div = document.createElement('div');
      div.className = 'medcof-coord-chat-msg medcof-coord-chat-msg--' + role;
      if (role === 'assistant') {
        div.innerHTML = renderCofbotAssistantHtml(text);
      } else {
        div.textContent = text;
      }
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function setPanel(v) {
      panelOpen = v;
      if (panel) panel.hidden = !v;
      if (fab) fab.setAttribute('aria-expanded', v ? 'true' : 'false');
      if (v && iesSel) refreshIesOptions(iesSel);
    }

    if (fab) {
      fab.addEventListener('click', function (e) {
        e.stopPropagation();
        setPanel(!panelOpen);
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        setPanel(false);
      });
    }

    document.addEventListener(
      'pointerdown',
      function (ev) {
        if (!panelOpen) return;
        if (root.contains(ev.target)) return;
        setPanel(false);
      },
      true
    );

    var clearBtn = document.getElementById('medcofAdminCofbotClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        thread = [];
        lastInsight = '';
        lastFollowUps = [];
        try {
          sessionStorage.removeItem(SESSION_KEY);
        } catch (e1) {}
        if (messagesEl) messagesEl.innerHTML = '';
        if (errorEl) {
          errorEl.hidden = true;
          errorEl.textContent = '';
        }
        renderSuggestions();
      });
    }

    if (iesSel) {
      iesSel.addEventListener('change', function () {
        persistAdminCofbotSession();
      });
    }

    if (!restoreAdminCofbotSession()) {
      renderSuggestions();
    }

    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var text = (input && input.value ? input.value : '').trim();
        if (!text) return;
        if (!iesSel || !iesSel.value) {
          if (errorEl) {
            errorEl.textContent = 'Selecione uma IES em foco para o Cofbot usar os dados dessa instituição.';
            errorEl.hidden = false;
          }
          return;
        }
        errorEl.hidden = true;
        appendMessage('user', text);
        input.value = '';
        thread.push({ role: 'user', content: text });
        persistAdminCofbotSession();
        sendBtn.disabled = true;
        var loading = document.createElement('div');
        loading.className = 'medcof-coord-chat-msg medcof-coord-chat-msg--assistant medcof-coord-chat-loading';
        loading.textContent = '…';
        messagesEl.appendChild(loading);

        try {
          var token = '';
          if (typeof window._getAdminToken === 'function') {
            token = await window._getAdminToken();
          }
          if (!token) {
            throw new Error('Sessão expirada — faça login novamente no painel admin.');
          }
          var iesSlug = String(iesSel.value).trim();
          var context = buildAdminCofbotContext();
          var res = await fetch(CHAT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: thread,
              context: context,
              ies_slug: iesSlug,
              supabase_access_token: token
            })
          });
          var body = await res.json().catch(function () {
            return {};
          });
          loading.remove();
          if (!res.ok) {
            var msg =
              body.error ||
              'Não conseguimos resposta do Cofbot agora. Tente de novo em instantes.';
            if (res.status === 404) {
              msg = 'Cofbot não está disponível neste endereço — verifique o deploy.';
            } else if (res.status === 502 && !body.error) {
              msg = 'Cofbot não respondeu a tempo. Tente de novo.';
            } else if (res.status === 504 && !body.error) {
              msg = 'A leitura levou mais tempo que o esperado. Tente uma pergunta mais curta.';
            }
            throw new Error(msg);
          }
          var reply = body.reply || '';
          appendMessage('assistant', reply);
          thread.push({ role: 'assistant', content: reply });
          applyFollowUps(body.insight, body.follow_up_questions);
          persistAdminCofbotSession();
        } catch (err) {
          loading.remove();
          errorEl.textContent = err.message || 'Não foi possível enviar agora. Tente de novo.';
          errorEl.hidden = false;
          persistAdminCofbotSession();
        } finally {
          sendBtn.disabled = false;
        }
      });
    }

    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || !panelOpen) return;
      if (panel && panel.classList.contains('medcof-admin-cofbot-panel--fullscreen')) {
        panel.classList.remove('medcof-admin-cofbot-panel--fullscreen');
        if (expandBtn) expandBtn.setAttribute('aria-pressed', 'false');
        return;
      }
      setPanel(false);
    });
  }

  window.mountAdminCofbot = mountAdminCofbot;

  function tryMountWhenDashboardVisible() {
    var dash = document.getElementById('dashboard');
    if (dash && dash.classList.contains('visible')) {
      mountAdminCofbot();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryMountWhenDashboardVisible);
  } else {
    tryMountWhenDashboardVisible();
  }
})();
