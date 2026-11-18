// Formulários dos ciclos (CYCLE95, CYCLE93, CYCLE97), como a tela de suporte a ciclos do
// 802D sl: cada parâmetro com uma explicação curta, e a linha do ciclo montada a partir dos
// campos. Também lê uma linha que já tem o ciclo, para abrir o formulário preenchido.
//
// Os nomes e a ordem dos parâmetros são os do manual do 802D sl (cap. 10.5); as
// explicações seguem o que o simulador faz (shared/cycles.js).

import { parseCallArgs, METRIC_COARSE } from './cycles.js';

const L = (pt, en) => ({ pt, en });

/**
 * Campo: { key, type: 'number' | 'text' | 'select', label, help, required?, options?, unit? }
 * required: true, ou uma função (valores) => boolean.
 */
export const CYCLE_FORMS = {
  CYCLE95: {
    title: L('CYCLE95 – Desbaste de contorno', 'CYCLE95 – Contour roughing'),
    intro: L(
      'Desbasta (e/ou dá o acabamento) num contorno escrito no programa entre dois rótulos, ou num subprograma. Antes do ciclo, posicione a ferramenta fora da peça (ex.: G0 X54 Z2).',
      'Roughs (and/or finishes) a contour written in the program between two labels, or in a subprogram. Before the cycle, place the tool outside the part (e.g. G0 X54 Z2).',
    ),
    fields: [
      { key: 'NPP', type: 'text', required: true, label: L('Contorno', 'Contour'),
        help: L('Rótulos do início e do fim do contorno no próprio programa ("INICIO:FIM") ou o nome do subprograma com o contorno', 'Labels of the start and end of the contour in the program ("START:END") or the name of the subprogram with the contour') },
      { key: 'MID', type: 'number', unit: 'mm', required: (v) => !(v.VARI >= 5 && v.VARI <= 8),
        label: L('Profundidade de cada passe', 'Depth of each cut'),
        help: L('Penetração máxima por passe (os passes saem iguais). No desbaste longitudinal é em diâmetro, como o X. Não precisa no só acabamento', 'Maximum infeed per cut (cuts are made equal). In longitudinal roughing it is in diameter, like X. Not needed for finishing only') },
      { key: 'FALZ', type: 'number', unit: 'mm', label: L('Sobremetal em Z', 'Allowance in Z'),
        help: L('Material deixado para o acabamento nas faces (eixo Z)', 'Material left for finishing on the faces (Z axis)') },
      { key: 'FALX', type: 'number', unit: 'mm', label: L('Sobremetal em X', 'Allowance in X'),
        help: L('Material deixado para o acabamento nos diâmetros, em diâmetro (0,8 deixa 0,4 por lado)', 'Material left for finishing on the diameters, in diameter (0.8 leaves 0.4 per side)') },
      { key: 'FAL', type: 'number', unit: 'mm', label: L('Sobremetal no contorno', 'Allowance along contour'),
        help: L('Material deixado igual em todo o contorno (em vez de FALZ/FALX, ou somado a eles)', 'Material left evenly along the contour (instead of, or added to, FALZ/FALX)') },
      { key: 'FF1', type: 'number', unit: 'mm/rot', label: L('Avanço de desbaste', 'Roughing feed'),
        help: L('Avanço dos passes de desbaste', 'Feed of the roughing cuts') },
      { key: 'FF2', type: 'number', unit: 'mm/rot', label: L('Avanço nos rebaixos', 'Feed into undercuts'),
        help: L('Avanço ao descer nos rebaixos do contorno', 'Feed when plunging into undercuts of the contour') },
      { key: 'FF3', type: 'number', unit: 'mm/rot', label: L('Avanço de acabamento', 'Finishing feed'),
        help: L('Avanço do passe de acabamento, que segue o contorno', 'Feed of the finishing pass along the contour') },
      { key: 'VARI', type: 'select', required: true, label: L('Tipo de usinagem', 'Machining type'),
        help: L('O que fazer (desbaste, acabamento ou os dois), em que direção (longitudinal ou faceamento) e onde (externo ou interno)', 'What to do (roughing, finishing or both), in which direction (longitudinal or facing) and where (external or internal)'),
        options: [
          [1, L('1 – Desbaste, longitudinal, externo', '1 – Roughing, longitudinal, external')],
          [2, L('2 – Desbaste, faceamento, externo', '2 – Roughing, facing, external')],
          [3, L('3 – Desbaste, longitudinal, interno', '3 – Roughing, longitudinal, internal')],
          [4, L('4 – Desbaste, faceamento, interno', '4 – Roughing, facing, internal')],
          [5, L('5 – Acabamento, longitudinal, externo', '5 – Finishing, longitudinal, external')],
          [6, L('6 – Acabamento, faceamento, externo', '6 – Finishing, facing, external')],
          [7, L('7 – Acabamento, longitudinal, interno', '7 – Finishing, longitudinal, internal')],
          [8, L('8 – Acabamento, faceamento, interno', '8 – Finishing, facing, internal')],
          [9, L('9 – Completo (desbaste + acabamento), longitudinal, externo', '9 – Complete (roughing + finishing), longitudinal, external')],
          [10, L('10 – Completo, faceamento, externo', '10 – Complete, facing, external')],
          [11, L('11 – Completo, longitudinal, interno', '11 – Complete, longitudinal, internal')],
          [12, L('12 – Completo, faceamento, interno', '12 – Complete, facing, internal')],
        ] },
      { key: 'DT', type: 'number', unit: 's', label: L('Espera para quebrar o cavaco', 'Dwell for chip breaking'),
        help: L('Parada depois de cada passe de desbaste. No simulador não muda a peça', 'Pause after each roughing cut. Does not change the part in the simulator') },
      { key: 'DAM', type: 'number', unit: 'mm', label: L('Interromper a cada', 'Interrupt every'),
        help: L('Percurso depois do qual o passe de desbaste é interrompido para quebrar o cavaco. No simulador não muda a peça', 'Distance after which the roughing cut is interrupted to break the chip. Does not change the part in the simulator') },
      { key: 'VRT', type: 'number', unit: 'mm', label: L('Afastamento', 'Lift-off'),
        help: L('Quanto a ferramenta se afasta do contorno ao voltar para o próximo passe (vazio = 1 mm)', 'How far the tool lifts off the contour before the next cut (empty = 1 mm)') },
    ],
    defaults: { NPP: '', MID: 1.5, FALZ: 0.1, FALX: 0.5, FF1: 0.2, FF2: 0.1, FF3: 0.08, VARI: 9, VRT: 1 },
  },

  CYCLE93: {
    title: L('CYCLE93 – Canal', 'CYCLE93 – Groove'),
    intro: L(
      'Abre um canal com o bedame, em mergulhos, e dá o acabamento dos flancos. O ponto inicial (SPD, SPL) é o canto de cima do canal, do lado escolhido no tipo de usinagem.',
      'Cuts a groove with the grooving tool, in plunges, and finishes the flanks. The starting point (SPD, SPL) is the top corner of the groove, on the side chosen in the machining type.',
    ),
    fields: [
      { key: 'SPD', type: 'number', unit: 'Ø mm', required: true, label: L('Ponto inicial em X', 'Starting point in X'),
        help: L('Diâmetro onde o canal começa (a superfície da peça)', 'Diameter where the groove starts (the part surface)') },
      { key: 'SPL', type: 'number', unit: 'mm', required: true, label: L('Ponto inicial em Z', 'Starting point in Z'),
        help: L('Posição em Z do canto do canal do lado do ponto inicial', 'Z position of the groove corner on the starting-point side') },
      { key: 'WIDG', type: 'number', unit: 'mm', required: true, label: L('Largura do canal', 'Groove width'),
        help: L('Largura no fundo do canal. Precisa ser pelo menos a largura do bedame', 'Width at the bottom of the groove. Must be at least the width of the grooving tool') },
      { key: 'DIAG', type: 'number', unit: 'mm', required: true, label: L('Profundidade do canal', 'Groove depth'),
        help: L('Altura radial, de cima até o fundo: Ø40 com profundidade 4 deixa o fundo em Ø32', 'Radial height, from the top to the bottom: Ø40 with depth 4 leaves the bottom at Ø32') },
      { key: 'STA1', type: 'number', unit: '°', label: L('Ângulo da superfície', 'Surface angle'),
        help: L('Inclinação da superfície onde fica o canal, em relação ao eixo Z (0 = cilindro). O fundo fica reto', 'Slope of the surface where the groove is, relative to the Z axis (0 = cylinder). The bottom stays straight') },
      { key: 'ANG1', type: 'number', unit: '°', label: L('Ângulo do flanco 1', 'Flank angle 1'),
        help: L('Flanco do lado do ponto inicial, medido a partir da vertical (0 = flanco reto)', 'Flank on the starting-point side, measured from the vertical (0 = straight flank)') },
      { key: 'ANG2', type: 'number', unit: '°', label: L('Ângulo do flanco 2', 'Flank angle 2'),
        help: L('Flanco do outro lado, medido a partir da vertical', 'Flank on the other side, measured from the vertical') },
      { key: 'RCO1', type: 'number', unit: 'mm', label: L('Canto de cima 1', 'Top corner 1'),
        help: L('Canto de cima do lado do ponto inicial: positivo = raio, negativo = chanfro', 'Top corner on the starting-point side: positive = radius, negative = chamfer') },
      { key: 'RCO2', type: 'number', unit: 'mm', label: L('Canto de cima 2', 'Top corner 2'),
        help: L('Canto de cima do outro lado: positivo = raio, negativo = chanfro', 'Top corner on the other side: positive = radius, negative = chamfer') },
      { key: 'RCI1', type: 'number', unit: 'mm', label: L('Canto do fundo 1', 'Bottom corner 1'),
        help: L('Canto do fundo do lado do ponto inicial: positivo = raio, negativo = chanfro', 'Bottom corner on the starting-point side: positive = radius, negative = chamfer') },
      { key: 'RCI2', type: 'number', unit: 'mm', label: L('Canto do fundo 2', 'Bottom corner 2'),
        help: L('Canto do fundo do outro lado: positivo = raio, negativo = chanfro', 'Bottom corner on the other side: positive = radius, negative = chamfer') },
      { key: 'FAL1', type: 'number', unit: 'mm', label: L('Sobremetal no fundo', 'Allowance at the bottom'),
        help: L('Material deixado no fundo nos mergulhos e tirado no acabamento', 'Material left at the bottom by the plunges and removed by finishing') },
      { key: 'FAL2', type: 'number', unit: 'mm', label: L('Sobremetal nos flancos', 'Allowance on the flanks'),
        help: L('Material deixado nos flancos nos mergulhos e tirado no acabamento', 'Material left on the flanks by the plunges and removed by finishing') },
      { key: 'IDEP', type: 'number', unit: 'mm', required: true, label: L('Profundidade de cada mergulho', 'Depth of each plunge'),
        help: L('A cada IDEP a ferramenta recua um pouco para quebrar o cavaco', 'Every IDEP the tool backs off a little to break the chip') },
      { key: 'DTB', type: 'number', unit: 's', label: L('Espera no fundo', 'Dwell at the bottom'),
        help: L('Tempo parado no fundo de cada mergulho', 'Time spent at the bottom of each plunge') },
      { key: 'VARI', type: 'select', required: true, label: L('Tipo de usinagem', 'Machining type'),
        help: L('Externo ou interno e de que lado está o ponto inicial. De 11 a 17, os chanfros são medidos como CHR em vez de CHF. Canais na face (2, 4, 6, 8) ainda não são simulados', 'External or internal and on which side the starting point is. From 11 to 17, chamfers are measured like CHR instead of CHF. Face grooves (2, 4, 6, 8) are not simulated yet'),
        options: [
          [1, L('1 – Externo, ponto inicial à esquerda', '1 – External, starting point on the left')],
          [5, L('5 – Externo, ponto inicial à direita', '5 – External, starting point on the right')],
          [3, L('3 – Interno, ponto inicial à esquerda', '3 – Internal, starting point on the left')],
          [7, L('7 – Interno, ponto inicial à direita', '7 – Internal, starting point on the right')],
          [11, L('11 – Externo, à esquerda (chanfro como CHR)', '11 – External, left (chamfer as CHR)')],
          [15, L('15 – Externo, à direita (chanfro como CHR)', '15 – External, right (chamfer as CHR)')],
          [13, L('13 – Interno, à esquerda (chanfro como CHR)', '13 – Internal, left (chamfer as CHR)')],
          [17, L('17 – Interno, à direita (chanfro como CHR)', '17 – Internal, right (chamfer as CHR)')],
        ] },
      { key: 'VRT', type: 'number', unit: 'mm', label: L('Recuo', 'Retraction'),
        help: L('Quanto a ferramenta recua para quebrar o cavaco e sai acima do canal (vazio = 1 mm)', 'How far the tool backs off to break the chip and clears the groove (empty = 1 mm)') },
    ],
    defaults: { SPD: 40, SPL: -20, WIDG: 5, DIAG: 3, STA1: 0, ANG1: 0, ANG2: 0, RCO1: 0, RCO2: 0, RCI1: 0, RCI2: 0, FAL1: 0, FAL2: 0, IDEP: 1, DTB: 0.3, VARI: 5, VRT: 1 },
  },

  CYCLE97: {
    title: L('CYCLE97 – Rosca', 'CYCLE97 – Thread cutting'),
    intro: L(
      'Abre a rosca em vários passes, cada um seguindo a hélice. Use a ferramenta de rosca e rotação constante (G97) antes do ciclo.',
      'Cuts the thread in several passes, each one following the helix. Use the threading tool and constant spindle speed (G97) before the cycle.',
    ),
    fields: [
      { key: 'PIT', type: 'number', unit: 'mm', required: (v) => !(v.MPIT > 0), label: L('Passo', 'Pitch'),
        help: L('Passo da rosca. Deixe vazio se escolher a rosca métrica (MPIT)', 'Thread pitch. Leave empty if you choose the metric thread (MPIT)') },
      { key: 'MPIT', type: 'select', label: L('Rosca métrica grossa', 'Metric coarse thread'),
        help: L('Em vez do passo: o tamanho da rosca (M3 a M60) e o passo sai da tabela', 'Instead of the pitch: the thread size (M3 to M60), and the pitch comes from the table'),
        options: [['', L('—', '—')], ...Object.entries(METRIC_COARSE).map(([m, p]) => [Number(m), L(`M${m} (passo ${p})`, `M${m} (pitch ${p})`)])] },
      { key: 'SPL', type: 'number', unit: 'mm', required: true, label: L('Início da rosca (Z)', 'Thread start (Z)'),
        help: L('Z onde a rosca começa (normalmente a face ou o fim do chanfro)', 'Z where the thread starts (usually the face or the end of the chamfer)') },
      { key: 'FPL', type: 'number', unit: 'mm', required: true, label: L('Fim da rosca (Z)', 'Thread end (Z)'),
        help: L('Z onde a rosca termina (antes do canal de saída)', 'Z where the thread ends (before the run-out groove)') },
      { key: 'DM1', type: 'number', unit: 'Ø mm', required: true, label: L('Diâmetro no início', 'Diameter at start'),
        help: L('Rosca externa: diâmetro nominal (M20 → 20). Rosca interna: diâmetro do furo', 'External thread: nominal diameter (M20 → 20). Internal thread: bore diameter') },
      { key: 'DM2', type: 'number', unit: 'Ø mm', label: L('Diâmetro no fim', 'Diameter at end'),
        help: L('Igual ao do início numa rosca cilíndrica; diferente numa rosca cônica', 'Same as at the start for a parallel thread; different for a taper thread') },
      { key: 'APP', type: 'number', unit: 'mm', label: L('Percurso de entrada', 'Run-in path'),
        help: L('Quanto antes do início a ferramenta começa a andar, para pegar a velocidade (cerca de 3 × passo)', 'How far before the start the tool begins moving, to reach speed (about 3 × pitch)') },
      { key: 'ROP', type: 'number', unit: 'mm', label: L('Percurso de saída', 'Run-out path'),
        help: L('Saída inclinada no fim da rosca', 'Sloped run-out at the end of the thread') },
      { key: 'TDEP', type: 'number', unit: 'mm', required: true, label: L('Profundidade da rosca', 'Thread depth'),
        help: L('Altura do filete, em raio (cerca de 0,65 × passo na rosca métrica externa)', 'Thread height, in radius (about 0.65 × pitch for an external metric thread)') },
      { key: 'FAL', type: 'number', unit: 'mm', label: L('Sobremetal do acabamento', 'Finishing allowance'),
        help: L('Profundidade do último passe (acabamento)', 'Depth of the last (finishing) pass') },
      { key: 'IANG', type: 'number', unit: '°', label: L('Ângulo de penetração', 'Infeed angle'),
        help: L('0 = penetração radial; positivo = por um flanco (metade do ângulo da pastilha, 30 na rosca métrica); negativo = flancos alternados', '0 = radial infeed; positive = along one flank (half the insert angle, 30 for metric threads); negative = alternating flanks') },
      { key: 'NSP', type: 'number', unit: '°', label: L('Ângulo de início', 'Start angle'),
        help: L('Onde começa a primeira entrada da rosca, em graus', 'Where the first thread start begins, in degrees') },
      { key: 'NRC', type: 'number', label: L('Passes de desbaste', 'Roughing passes'),
        help: L('Número de passes até chegar à profundidade (sem contar o acabamento)', 'Number of passes to reach the depth (not counting the finishing pass)') },
      { key: 'NID', type: 'number', label: L('Passes em vazio', 'Idle passes'),
        help: L('Passes repetidos na profundidade final, sem penetrar mais (alisam o filete)', 'Passes repeated at the final depth without more infeed (they clean the thread)') },
      { key: 'VARI', type: 'select', required: true, label: L('Tipo de usinagem', 'Machining type'),
        help: L('Externa ou interna; penetração constante (passes iguais) ou seção de cavaco constante (passes cada vez menores)', 'External or internal; constant infeed (equal passes) or constant chip section (smaller and smaller passes)'),
        options: [
          [1, L('1 – Externa, penetração constante', '1 – External, constant infeed')],
          [2, L('2 – Interna, penetração constante', '2 – Internal, constant infeed')],
          [3, L('3 – Externa, seção de cavaco constante', '3 – External, constant chip section')],
          [4, L('4 – Interna, seção de cavaco constante', '4 – Internal, constant chip section')],
        ] },
      { key: 'NUMT', type: 'number', label: L('Número de entradas', 'Number of starts'),
        help: L('1 = rosca simples; 2 ou mais = rosca de várias entradas', '1 = single-start thread; 2 or more = multi-start thread') },
      { key: 'VRT', type: 'number', unit: 'mm', label: L('Afastamento', 'Clearance'),
        help: L('Quanto a ferramenta sobe acima do diâmetro da rosca para voltar ao início (vazio = 1 mm)', 'How far the tool rises above the thread diameter to return to the start (empty = 1 mm)') },
    ],
    defaults: { PIT: 1.5, SPL: 0, FPL: -20, DM1: 20, DM2: 20, APP: 4.5, ROP: 1, TDEP: 0.98, FAL: 0.05, IANG: 30, NSP: 0, NRC: 10, NID: 1, VARI: 1, NUMT: 1, VRT: 1 },
  },
};

export const CYCLE_NAMES = Object.keys(CYCLE_FORMS);

/** O campo é obrigatório com estes valores? */
export function isRequired(field, values) {
  return typeof field.required === 'function' ? field.required(values) : !!field.required;
}

/** Campos obrigatórios que estão vazios. */
export function missingFields(cycle, values) {
  return CYCLE_FORMS[cycle].fields.filter((f) => isRequired(f, values) && (values[f.key] === undefined || values[f.key] === '')).map((f) => f.key);
}

const fmt = (v) => {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'string') return `"${v.replace(/"/g, '')}"`;
  return String(Math.round(v * 10000) / 10000);
};

/** Monta a chamada: CYCLE93(40, -20, …). Posições vazias no fim são omitidas. */
export function buildCycleCall(cycle, values) {
  const args = CYCLE_FORMS[cycle].fields.map((f) => fmt(values[f.key]));
  while (args.length && args[args.length - 1] === '') args.pop();
  return `${cycle}(${args.join(', ')})`;
}

const LINE_RE = /^(\s*(?:N\d+\s+)?)(CYCLE9[357])\s*\(([^)]*)\)(.*)$/i;

/**
 * Lê uma linha com um ciclo: { cycle, values, prefix, suffix } ou null. prefix = número do
 * bloco (N…) e suffix = o que vem depois do parêntese (comentário), para manter ao trocar.
 */
export function parseCycleLine(line) {
  const m = String(line).match(LINE_RE);
  if (!m) return null;
  const cycle = m[2].toUpperCase();
  let args;
  try {
    args = parseCallArgs(m[3], cycle);
  } catch {
    return null;
  }
  const values = {};
  CYCLE_FORMS[cycle].fields.forEach((f, i) => {
    if (args[i] !== undefined) values[f.key] = args[i];
  });
  return { cycle, values, prefix: m[1], suffix: m[4] };
}

/** Pares de rótulos para sugerir no contorno do CYCLE95: ["CONTORNO:CONTORNO_FIM", …]. */
export function contourSuggestions(labels) {
  const names = Object.entries(labels).sort((a, b) => a[1] - b[1]).map(([n]) => n);
  const out = [];
  for (let i = 0; i + 1 < names.length; i++) out.push(`${names[i]}:${names[i + 1]}`);
  return out;
}

/** Fórmulas usuais da rosca métrica externa: TDEP = 0,65·P, NRC = TDEP / 0,1, APP = 3·P. */
export function threadSuggestion(pitch) {
  if (!(pitch > 0)) return null;
  const TDEP = Math.round(0.65 * pitch * 1000) / 1000;
  return { TDEP, NRC: Math.max(1, Math.ceil(TDEP / 0.1 - 1e-9)), APP: Math.round(3 * pitch * 100) / 100, IANG: 30 };
}
