import { api, ApiError } from './api.js';
import { applyI18n, guessLang, rememberLang } from './i18n-dom.js';
import { t, apiErrorText } from '/shared/i18n.js';

const $ = (id) => document.getElementById(id);
let lang = guessLang();
applyI18n(lang);
document.querySelectorAll('[data-lang]').forEach((b) => {
  b.onclick = () => {
    lang = b.dataset.lang;
    rememberLang(lang);
    applyI18n(lang);
  };
});

const next = new URLSearchParams(location.search).get('next');
const target = next && /^\/(?!\/)/.test(next) ? next : '/';
if (next) $('toLogin').href = `/login.html?next=${encodeURIComponent(target)}`;

$('form').onsubmit = async (e) => {
  e.preventDefault();
  const err = $('error');
  err.textContent = '';
  if ($('password').value !== $('password2').value) {
    err.textContent = t(lang, 'password_mismatch');
    return;
  }
  try {
    await api('POST', '/api/auth/signup', {
      name: $('name').value.trim(),
      username: $('username').value.trim(),
      email: $('email').value.trim(),
      password: $('password').value,
    });
    // grava o idioma escolhido na conta nova
    await api('PUT', '/api/settings', { lang }).catch(() => {});
    location.replace(target);
  } catch (ex) {
    err.textContent = apiErrorText(lang, ex instanceof ApiError ? ex.code : ex.message);
  }
};
