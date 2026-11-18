// Janela "Ciclos": preenche os parâmetros de CYCLE95/93/97 com explicações e põe a linha do
// ciclo no programa. Com o cursor numa linha que já tem um ciclo, abre com os valores dela
// e troca a linha (mantendo o número do bloco e o comentário).

import { CYCLE_FORMS, CYCLE_NAMES, isRequired, missingFields, buildCycleCall, parseCycleLine, contourSuggestions, threadSuggestion } from '/shared/cycle-forms.js';
import { findLabels, METRIC_COARSE } from '/shared/cycles.js';

const $ = (id) => document.getElementById(id);

/**
 * ta: textarea do editor; lang(): idioma atual; tr(key, params): tradução;
 * changed(lineIndex): avisa que o código mudou (atualiza a numeração, o rascunho…).
 */
export function initCycleDialog({ ta, lang, tr, changed }) {
  const dlg = $('dlgCycle');
  const form = $('cycleFields');
  const st = { cycle: 'CYCLE95', values: {}, edit: null }; // edit = { line, prefix, suffix, cycle }
  const L = (o) => o[lang()] || o.pt;

  const cursorLine = () => ta.value.slice(0, ta.selectionStart).split('\n').length - 1;

  function readField(f, el) {
    const raw = el.value.trim();
    if (raw === '') return undefined;
    if (f.type === 'text') return raw.replace(/"/g, '');
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) ? n : raw; // inválido: fica como texto e é apontado
  }

  function collect() {
    const v = {};
    for (const f of CYCLE_FORMS[st.cycle].fields) {
      const val = readField(f, form.querySelector(`[data-key="${f.key}"]`));
      if (val !== undefined) v[f.key] = val;
    }
    st.values = v;
    return v;
  }

  function invalidKeys(v) {
    return CYCLE_FORMS[st.cycle].fields.filter((f) => f.type !== 'text' && typeof v[f.key] === 'string').map((f) => f.key);
  }

  function refresh() {
    const v = collect();
    const missing = missingFields(st.cycle, v);
    const bad = invalidKeys(v);
    for (const f of CYCLE_FORMS[st.cycle].fields) {
      const wrap = form.querySelector(`[data-wrap="${f.key}"]`);
      wrap.classList.toggle('req', isRequired(f, v));
      wrap.classList.toggle('missing', missing.includes(f.key) || bad.includes(f.key));
    }
    $('cyclePreview').textContent = bad.length ? '' : buildCycleCall(st.cycle, v);
    const problems = [];
    if (missing.length) problems.push(tr('cycle_missing', { p: missing.join(', ') }));
    if (bad.length) problems.push(tr('cycle_bad_number', { p: bad.join(', ') }));
    $('cycleProblems').textContent = problems.join(' · ');
    $('cycleInsert').disabled = problems.length > 0 || ta.readOnly;
    $('cycleInsert').textContent = st.edit && st.edit.cycle === st.cycle ? tr('cycle_update', { n: st.edit.line + 1 }) : tr('cycle_insert');
  }

  function render() {
    const def = CYCLE_FORMS[st.cycle];
    $('cycleTitle').textContent = L(def.title);
    $('cycleIntro').textContent = L(def.intro);
    for (const b of $('cycleTabs').children) b.classList.toggle('on', b.dataset.cycle === st.cycle);
    const frag = document.createDocumentFragment();
    for (const f of def.fields) {
      const wrap = document.createElement('label');
      wrap.className = 'cyc-field';
      wrap.dataset.wrap = f.key;
      const head = document.createElement('span');
      head.className = 'cyc-head';
      head.innerHTML = '<b></b> <span class="cyc-name"></span><span class="cyc-unit"></span>';
      head.querySelector('b').textContent = f.key;
      head.querySelector('.cyc-name').textContent = L(f.label);
      head.querySelector('.cyc-unit').textContent = f.unit ? ` (${f.unit})` : '';
      let el;
      if (f.type === 'select') {
        el = document.createElement('select');
        for (const [val, text] of f.options) {
          const o = document.createElement('option');
          o.value = String(val);
          o.textContent = L(text);
          el.appendChild(o);
        }
        if (!f.options.some(([val]) => val === '')) {
          // valor fora da lista (ex.: VARI de canal na face) continua visível
          const cur = st.values[f.key];
          if (cur !== undefined && !f.options.some(([val]) => val === cur)) {
            const o = document.createElement('option');
            o.value = String(cur);
            o.textContent = String(cur);
            el.appendChild(o);
          }
        }
      } else {
        el = document.createElement('input');
        el.type = 'text';
        el.inputMode = f.type === 'number' ? 'decimal' : 'text';
        el.autocomplete = 'off';
        el.spellcheck = false;
        if (f.key === 'NPP') {
          el.setAttribute('list', 'cycleContours');
          el.placeholder = 'INICIO:FIM';
        }
      }
      el.dataset.key = f.key;
      const cur = st.values[f.key];
      el.value = cur === undefined ? '' : String(cur);
      const help = document.createElement('small');
      help.textContent = L(f.help);
      wrap.append(head, el, help);
      frag.appendChild(wrap);
    }
    form.replaceChildren(frag);
    $('cycleThreadCalc').hidden = st.cycle !== 'CYCLE97';
    // contornos sugeridos: pares de rótulos do programa
    const dl = $('cycleContours');
    dl.replaceChildren(...contourSuggestions(findLabels(ta.value.split('\n'))).map((s) => Object.assign(document.createElement('option'), { value: s })));
    refresh();
  }

  // valores iniciais de um ciclo novo; o contorno do CYCLE95 vem do primeiro par de rótulos
  function freshValues(cycle) {
    const v = { ...CYCLE_FORMS[cycle].defaults };
    if (cycle === 'CYCLE95') v.NPP = contourSuggestions(findLabels(ta.value.split('\n')))[0] || '';
    return v;
  }

  function selectCycle(cycle) {
    if (cycle === st.cycle) return;
    st.cycle = cycle;
    st.values = st.edit && st.edit.cycle === cycle ? { ...st.edit.values } : freshValues(cycle);
    render();
  }

  function open() {
    const lines = ta.value.split('\n');
    const li = cursorLine();
    const parsed = parseCycleLine(lines[li] || '');
    if (parsed) {
      st.edit = { line: li, ...parsed };
      st.cycle = parsed.cycle;
      st.values = { ...parsed.values };
    } else {
      st.edit = null;
      st.values = freshValues(st.cycle);
    }
    render();
    dlg.showModal();
  }

  function insert() {
    const v = collect();
    if (missingFields(st.cycle, v).length || invalidKeys(v).length || ta.readOnly) return;
    const call = buildCycleCall(st.cycle, v);
    const lines = ta.value.split('\n');
    let at;
    if (st.edit && st.edit.cycle === st.cycle) {
      at = st.edit.line;
      lines[at] = st.edit.prefix + call + st.edit.suffix;
    } else {
      const li = Math.min(cursorLine(), lines.length - 1);
      if (lines[li].trim() === '') {
        at = li;
        lines[at] = call;
      } else {
        at = li + 1;
        lines.splice(at, 0, call);
      }
    }
    ta.value = lines.join('\n');
    dlg.close();
    changed(at);
  }

  // abas dos ciclos
  $('cycleTabs').replaceChildren(
    ...CYCLE_NAMES.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn sm';
      b.dataset.cycle = c;
      b.textContent = c;
      b.onclick = () => selectCycle(c);
      return b;
    }),
  );
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  $('cycleInsert').onclick = insert;
  $('cycleCancel').onclick = () => dlg.close();
  $('cycleClose').onclick = () => dlg.close();
  $('cycleThreadCalc').onclick = () => {
    const v = collect();
    const p = v.PIT > 0 ? v.PIT : METRIC_COARSE[v.MPIT];
    const s = threadSuggestion(p);
    if (!s) return;
    for (const [k, val] of Object.entries(s)) form.querySelector(`[data-key="${k}"]`).value = String(val);
    refresh();
  };

  return { open, rerender: () => dlg.open && render() };
}
