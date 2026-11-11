import { api, ApiError } from './api.js';
import { applyI18n, guessLang, rememberLang } from './i18n-dom.js';
import { t, apiErrorText } from '/shared/i18n.js';

const $ = (id) => document.getElementById(id);
let lang = guessLang();
let data = { owned: [], joined: [] };
const open = new Set(); // turmas com detalhes abertos
const tr = (k, p) => t(lang, k, p);
const errText = (e) => apiErrorText(lang, e instanceof ApiError ? e.code : e.message);
const inviteUrl = (code) => `${location.origin}/join.html?code=${code}`;
const fmtDate = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString(lang === 'pt' ? 'pt-BR' : 'en');

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) if (c != null) e.append(c);
  return e;
}
const btn = (key, onclick, cls = 'btn sm') => el('button', { className: cls, textContent: tr(key), onclick });

function table(headers, rows) {
  return el(
    'div',
    { className: 'table-wrap' },
    el(
      'table',
      { className: 'users' },
      el('thead', {}, el('tr', {}, ...headers.map((h) => el('th', { textContent: h ? tr(h) : '' })))),
      el('tbody', {}, ...rows)
    )
  );
}

async function showCode(turmaId, sub) {
  const full = await api('GET', `/api/turmas/${turmaId}/submissions/${sub.id}`);
  $('codeTitle').textContent = full.name;
  $('codeInfo').textContent = `${full.user_name} (${full.username}) · ${tr('submitted_at')} ${fmtDate(full.submitted_at)}`;
  $('codeView').value = full.code;
  $('dlgCode').showModal();
}

async function act(fn) {
  try {
    await fn();
    await load();
  } catch (e) {
    alert(errText(e));
  }
}

// ---------- turmas em que sou aluno ----------
async function renderJoined() {
  const box = $('joinedList');
  box.replaceChildren();
  if (!data.joined.length) return box.append(el('p', { className: 'muted', textContent: tr('no_turmas') }));
  const rows = [];
  for (const j of data.joined) {
    const det = await api('GET', `/api/turmas/${j.id}`);
    const subs = det.submissions.length
      ? el('div', { className: 'actions' }, ...det.submissions.map((s) =>
          el('button', { className: 'link', textContent: `${s.name} · ${fmtDate(s.submitted_at)}`, onclick: () => showCode(j.id, s) })))
      : el('span', { className: 'muted', textContent: tr('no_submissions') });
    rows.push(
      el('tr', {},
        el('td', { textContent: j.name }),
        el('td', { textContent: j.owner_name }),
        el('td', {}, subs),
        el('td', {}, btn('leave', () => confirm(tr('confirm_leave', { name: j.name })) &&
          act(() => api('DELETE', `/api/turmas/${j.id}/members/${me.id}`)))))
    );
  }
  box.append(table(['turma_name', 'teacher', 'submissions', ''], rows));
}

// ---------- minhas turmas (professor) ----------
async function turmaDetails(tm) {
  const det = await api('GET', `/api/turmas/${tm.id}`);
  const wrap = el('div', { className: 'turma-details' });
  wrap.append(el('h3', { textContent: tr('members') }));
  if (!det.members.length) wrap.append(el('p', { className: 'muted', textContent: tr('no_members') }));
  else {
    wrap.append(table(['name', 'username', 'submissions', ''], det.members.map((m) =>
      el('tr', {},
        el('td', { textContent: m.name }),
        el('td', { textContent: m.username }),
        el('td', { textContent: m.submissions }),
        el('td', {}, btn('remove', () => confirm(tr('confirm_remove_member', { name: m.name })) &&
          act(() => api('DELETE', `/api/turmas/${tm.id}/members/${m.id}`))))))));
  }
  wrap.append(el('h3', { textContent: tr('submissions') }));
  if (!det.submissions.length) wrap.append(el('p', { className: 'muted', textContent: tr('no_submissions') }));
  else {
    wrap.append(table(['student', 'program', 'submitted_at', ''], det.submissions.map((s) =>
      el('tr', {},
        el('td', { textContent: s.user_name }),
        el('td', { textContent: s.name }),
        el('td', { textContent: fmtDate(s.submitted_at) }),
        el('td', {}, btn('view', () => showCode(tm.id, s)))))));
  }
  return wrap;
}

async function renderOwned() {
  const box = $('ownedList');
  box.replaceChildren();
  if (!data.owned.length) return box.append(el('p', { className: 'muted', textContent: tr('no_turmas') }));
  for (const tm of data.owned) {
    const link = el('input', { className: 'invite', readOnly: true, value: inviteUrl(tm.invite_code) });
    const copyBtn = btn('copy_link', async () => {
      await navigator.clipboard?.writeText(link.value).catch(() => link.select());
      copyBtn.textContent = tr('copied');
      setTimeout(() => (copyBtn.textContent = tr('copy_link')), 1500);
    });
    const card = el('div', { className: 'turma-card' },
      el('div', { className: 'row-between' },
        el('h3', { textContent: tm.name }),
        el('div', { className: 'actions' },
          btn('rename', () => {
            const name = prompt(tr('prompt_rename'), tm.name)?.trim();
            if (name) act(() => api('PATCH', `/api/turmas/${tm.id}`, { name }));
          }),
          btn('delete_turma', () => confirm(tr('confirm_delete_turma', { name: tm.name })) &&
            act(() => api('DELETE', `/api/turmas/${tm.id}`))))),
      el('div', { className: 'invite-row' },
        el('span', { className: 'muted', textContent: `${tr('invite_link')} (${tr('invite_code')}: ${tm.invite_code})` }),
        link, copyBtn,
        btn('new_code', () => confirm(tr('confirm_new_code')) && act(() => api('POST', `/api/turmas/${tm.id}/invite`, {})))),
      el('div', { className: 'muted' }, `${tr('members')}: ${tm.members} · ${tr('submissions')}: ${tm.submissions}`));
    const details = el('details', { open: open.has(tm.id) }, el('summary', { textContent: tr('view') }));
    details.ontoggle = async () => {
      if (details.open) {
        open.add(tm.id);
        if (!details.querySelector('.turma-details')) details.append(await turmaDetails(tm));
      } else open.delete(tm.id);
    };
    if (open.has(tm.id)) details.append(await turmaDetails(tm));
    card.append(details);
    box.append(card);
  }
}

async function load() {
  data = await api('GET', '/api/turmas');
  await Promise.all([renderJoined(), renderOwned()]);
}

$('formJoin').onsubmit = async (e) => {
  e.preventDefault();
  const msg = $('joinMsg');
  msg.className = 'error';
  msg.textContent = '';
  try {
    const r = await api('POST', '/api/turmas/join', { code: $('joinCode').value.trim() });
    msg.className = 'ok-msg';
    msg.textContent = tr('joined_ok', { name: r.name });
    $('joinCode').value = '';
    await load();
  } catch (ex) {
    msg.textContent = errText(ex);
  }
};

$('formCreate').onsubmit = async (e) => {
  e.preventDefault();
  $('createMsg').textContent = '';
  try {
    const r = await api('POST', '/api/turmas', { name: $('newName').value.trim() });
    $('newName').value = '';
    open.add(r.id);
    await load();
  } catch (ex) {
    $('createMsg').textContent = errText(ex);
  }
};

$('codeClose').onclick = () => $('dlgCode').close();
$('btnCopy').onclick = () => navigator.clipboard?.writeText($('codeView').value);
$('langSelect').onchange = async (e) => {
  lang = e.target.value;
  rememberLang(lang);
  applyI18n(lang);
  api('PUT', '/api/settings', { lang }).catch(() => {});
  await load();
};

let me;
(async function init() {
  applyI18n(lang);
  me = (await api('GET', '/api/auth/me')).user;
  $('linkAdmin').classList.toggle('hidden', !me.isAdmin);
  const s = await api('GET', '/api/settings').catch(() => ({}));
  if (s.lang) lang = s.lang;
  $('langSelect').value = lang;
  applyI18n(lang);
  await load();
})();
