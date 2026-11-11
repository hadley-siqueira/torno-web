// Administração do sistema: só para usuários em ADMIN_USERNAMES.
import { api, ApiError } from './api.js';
import { applyI18n, guessLang } from './i18n-dom.js';
import { t, apiErrorText } from '/shared/i18n.js';

const $ = (id) => document.getElementById(id);
let lang = guessLang();
let me;
const tr = (k, p) => t(lang, k, p);

async function load() {
  const users = await api('GET', '/api/admin/users');
  const body = $('usersBody');
  body.replaceChildren();
  for (const u of users) {
    const row = document.createElement('tr');
    if (!u.active) row.className = 'inactive';
    for (const v of [u.name, u.username, u.email || '', u.programs, u.turmas, u.created_at]) {
      const td = document.createElement('td');
      td.textContent = v;
      row.append(td);
    }
    const td = document.createElement('td');
    if (u.id !== me.id) {
      const b = document.createElement('button');
      b.className = 'btn sm';
      b.textContent = u.active ? tr('deactivate') : tr('activate');
      b.onclick = async () => {
        try {
          await api('PATCH', `/api/admin/users/${u.id}`, { active: !u.active });
          await load();
        } catch (e) {
          alert(apiErrorText(lang, e instanceof ApiError ? e.code : e.message));
        }
      };
      td.append(b);
    }
    row.append(td);
    body.append(row);
  }
}

(async function init() {
  applyI18n(lang);
  me = (await api('GET', '/api/auth/me')).user;
  if (!me.isAdmin) return location.replace('/');
  const s = await api('GET', '/api/settings').catch(() => ({}));
  if (s.lang) lang = s.lang;
  applyI18n(lang);
  await load();
})();
