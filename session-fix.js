/**
 * session-fix.js — Normaliza a sessão para a IES da URL atual.
 * DEVE ser carregado ANTES de shared.js para evitar flash de outra IES.
 */
(function () {
  var parts = location.pathname.split('/').filter(Boolean);
  var slug = parts[0];
  if (!slug) return;

  var INST_KEY = 'medcof_panel_institution';
  var ACCESS_KEY = 'medcof_panel_access';

  // Se a IES armazenada na sessão difere do slug da URL, normalizar
  var stored = sessionStorage.getItem(INST_KEY);
  if (stored !== slug) {
    sessionStorage.setItem(INST_KEY, slug);
  }
  // Manter o acesso se autenticado (admin bypass via localStorage/sessionStorage, ou sessão já válida)
  if (sessionStorage.getItem(ACCESS_KEY) !== 'granted') {
    if (sessionStorage.getItem('medcof_admin_bypass') === 'true' || localStorage.getItem('medcof_admin_bypass') === 'true') {
      sessionStorage.setItem(ACCESS_KEY, 'granted');
      sessionStorage.setItem('medcof_admin_bypass', 'true');
    }
  }
})();
