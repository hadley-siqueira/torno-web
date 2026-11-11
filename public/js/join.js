import { api, ApiError } from './api.js';
import { applyI18n, guessLang } from './i18n-dom.js';
import { t, apiErrorText } from '/shared/i18n.js';

const $ = (id) => document.getElementById(id);
const code = (new URLSearchParams(location.search).get('code') || '').trim();
let lang = guessLang();

(async function init() {
  applyI18n(lang);
  await api('GET', '/api/auth/me'); // sem login: vai para o login e volta para cá
  const s = await api('GET', '/api/settings').catch(() => ({}));
  if (s.lang) lang = s.lang;
  applyI18n(lang);
  try {
    const inv = await api('GET', `/api/turmas/invite/${encodeURIComponent(code)}`);
    $('text').textContent = t(lang, 'join_preview', { name: inv.name, owner: inv.owner_name });
    if (inv.isOwner) $('error').textContent = t(lang, 'err_own_turma');
    else if (inv.isMember) $('error').textContent = t(lang, 'already_member');
    else $('btnJoin').classList.remove('hidden');
  } catch (e) {
    $('error').textContent = apiErrorText(lang, e instanceof ApiError ? e.code : e.message);
  }
})();

$('btnJoin').onclick = async () => {
  try {
    const r = await api('POST', '/api/turmas/join', { code });
    $('btnJoin').classList.add('hidden');
    $('error').className = 'ok-msg';
    $('error').textContent = t(lang, 'joined_ok', { name: r.name });
  } catch (e) {
    $('error').textContent = apiErrorText(lang, e instanceof ApiError ? e.code : e.message);
  }
};
