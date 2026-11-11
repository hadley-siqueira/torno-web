import { api, ApiError } from './api.js';
import { applyI18n, guessLang, rememberLang } from './i18n-dom.js';
import { t } from '/shared/i18n.js';

let lang = guessLang();
applyI18n(lang);

document.querySelectorAll('[data-lang]').forEach((b) => {
  b.onclick = () => {
    lang = b.dataset.lang;
    rememberLang(lang);
    applyI18n(lang);
  };
});

// Só aceita redirecionar para caminhos locais
const next = new URLSearchParams(location.search).get('next');
const target = next && /^\/(?!\/)/.test(next) ? next : '/';
if (next) document.getElementById('toSignup').href = `/signup.html?next=${encodeURIComponent(target)}`;

// já logado? (fetch direto: api() redirecionaria para cá de novo em caso de 401)
fetch('/api/auth/me', { credentials: 'same-origin' })
  .then((r) => r.ok && location.replace(target))
  .catch(() => {});

document.getElementById('form').onsubmit = async (e) => {
  e.preventDefault();
  const err = document.getElementById('error');
  err.textContent = '';
  try {
    await api('POST', '/api/auth/login', {
      username: document.getElementById('username').value.trim(),
      password: document.getElementById('password').value,
    });
    location.replace(target);
  } catch (ex) {
    err.textContent = t(lang, ex instanceof ApiError && ex.code === 'login_locked' ? 'login_locked' : 'login_failed');
  }
};
