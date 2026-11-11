import { api, ApiError } from './api.js';
import { applyI18n, guessLang, rememberLang } from './i18n-dom.js';
import { t } from '/shared/i18n.js';

const $ = (id) => document.getElementById(id);
let lang = guessLang();
let me = null;
let users = [];
const tr = (k, p) => t(lang, k, p);
const errText = (e) => tr('S_ERROR', { msg: e instanceof ApiError ? e.code : e.message });

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) e.append(c);
  return e;
}

function render() {
  const turmas = [...new Set(users.map((u) => u.turma).filter(Boolean))].sort();
  const filter = $('filterTurma');
  const cur = filter.value;
  filter.replaceChildren(new Option(tr('all_groups'), ''), ...turmas.map((x) => new Option(x, x)));
  filter.value = turmas.includes(cur) ? cur : '';
  $('turmas').replaceChildren(...turmas.map((x) => el('option', { value: x })));

  const body = $('usersBody');
  body.replaceChildren();
  for (const u of users.filter((u) => !filter.value || u.turma === filter.value)) {
    const actions = el('td', { className: 'actions' });
    actions.append(
      el('button', { className: 'btn sm', textContent: tr('view'), onclick: () => showPrograms(u) }),
      el('button', { className: 'btn sm', textContent: tr('reset_password'), onclick: () => resetPassword(u) })
    );
    if (u.id !== me.id) {
      actions.append(
        el('button', {
          className: 'btn sm',
          textContent: u.active ? tr('deactivate') : tr('activate'),
          onclick: () => patch(u, { active: !u.active }),
        })
      );
    }
    const tr_ = el(
      'tr',
      { className: u.active ? '' : 'inactive' },
      el('td', { textContent: u.name }),
      el('td', { textContent: u.username }),
      el('td', { textContent: u.turma }),
      el('td', { textContent: tr(`role_${u.role}`) + (u.active ? '' : ` (${tr('inactive')})`) }),
      el('td', { textContent: u.programs }),
      actions
    );
    body.append(tr_);
  }
}

async function load() {
  users = await api('GET', '/api/admin/users');
  render();
}

async function patch(u, body) {
  try {
    await api('PATCH', `/api/admin/users/${u.id}`, body);
    await load();
  } catch (e) {
    alert(errText(e));
  }
}

function resetPassword(u) {
  const pw = prompt(tr('prompt_new_password', { username: u.username }));
  if (!pw) return;
  if (pw.length < 6) return alert(tr('new_password'));
  patch(u, { password: pw });
}

async function showPrograms(u) {
  const { programs } = await api('GET', `/api/admin/users/${u.id}/programs`);
  $('progTitle').textContent = tr('programs_of', { name: u.name });
  $('codeName').textContent = '';
  $('codeView').value = '';
  const list = $('progList');
  list.replaceChildren();
  if (!programs.length) list.append(el('li', { className: 'muted', textContent: tr('no_programs') }));
  for (const p of programs) {
    const btn = el('button', { className: 'link', textContent: p.name, title: `${tr('updated_at')} ${p.updated_at} UTC` });
    btn.onclick = async () => {
      const full = await api('GET', `/api/admin/programs/${p.id}`);
      $('codeName').textContent = full.name;
      $('codeView').value = full.code;
    };
    list.append(el('li', {}, btn));
  }
  $('dlgPrograms').showModal();
}

$('progClose').onclick = () => $('dlgPrograms').close();
$('btnCopy').onclick = () => navigator.clipboard?.writeText($('codeView').value);
$('filterTurma').onchange = render;
$('langSelect').onchange = (e) => {
  lang = e.target.value;
  rememberLang(lang);
  applyI18n(lang);
  render();
  api('PUT', '/api/settings', { lang }).catch(() => {});
};

$('formCreate').onsubmit = async (e) => {
  e.preventDefault();
  const msg = $('createMsg');
  msg.textContent = '';
  const username = $('cUser').value.trim();
  try {
    await api('POST', '/api/admin/users', {
      name: $('cName').value.trim(),
      username,
      password: $('cPass').value,
      turma: $('cTurma').value.trim(),
      role: $('cRole').value,
    });
    msg.className = 'ok-msg';
    msg.textContent = tr('user_created', { username });
    ['cName', 'cUser', 'cPass'].forEach((id) => ($(id).value = ''));
    await load();
  } catch (ex) {
    msg.className = 'error';
    msg.textContent = errText(ex);
  }
};

(async function init() {
  applyI18n(lang);
  me = (await api('GET', '/api/auth/me')).user;
  if (me.role !== 'professor') return location.replace('/');
  const s = await api('GET', '/api/settings').catch(() => ({}));
  if (s.lang) lang = s.lang;
  $('langSelect').value = lang;
  applyI18n(lang);
  await load();
})();
