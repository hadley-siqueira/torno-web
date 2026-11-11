import { t, LANGS, DEFAULT_LANG } from '/shared/i18n.js';

// Idioma antes do login: o que foi usado por último neste navegador, senão o do navegador
export function guessLang() {
  try {
    const saved = localStorage.getItem('torno-cnc:lang');
    if (LANGS.includes(saved)) return saved;
  } catch {
    /* sem armazenamento */
  }
  return navigator.language?.toLowerCase().startsWith('pt') ? 'pt' : navigator.language ? 'en' : DEFAULT_LANG;
}

export function rememberLang(lang) {
  try {
    localStorage.setItem('torno-cnc:lang', lang);
  } catch {
    /* sem armazenamento */
  }
}

/** Aplica traduções aos elementos com data-i18n / data-i18n-title / data-i18n-placeholder. */
export function applyI18n(lang, root = document) {
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
  root.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(lang, el.dataset.i18n)));
  root.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(lang, el.dataset.i18nTitle)));
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(lang, el.dataset.i18nPlaceholder)));
}
