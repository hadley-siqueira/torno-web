// Aparência da cena: material do tarugo e posição da torre. Só estética: a simulação
// de corte é a mesma para todos (não muda avanço, rotação, tempo nem cotas).
//
// Materiais do tarugo (peça bruta).
//
// raw: superfície bruta (laminada/extrudada, com carepa ou oxidação)
// cut: superfície usinada
// chips: cor dos cavacos
// metalness/roughness: brilho da superfície usinada (a bruta é mais fosca)

export const MATERIALS = {
  steel: {
    name: { pt: 'Aço carbono (SAE 1020/1045)', en: 'Carbon steel (SAE 1020/1045)' },
    raw: 0x5e5951, cut: 0xc8cdd3, chips: 0x9fb0c8, metalness: 0.8, roughness: 0.33,
  },
  stainless: {
    name: { pt: 'Aço inox (AISI 304)', en: 'Stainless steel (AISI 304)' },
    raw: 0x9ea3a8, cut: 0xe1e5e9, chips: 0xc9ced4, metalness: 0.85, roughness: 0.26,
  },
  aluminum: {
    name: { pt: 'Alumínio (6061/6351)', en: 'Aluminium (6061/6351)' },
    raw: 0xaab0b6, cut: 0xedf0f3, chips: 0xe3e7eb, metalness: 0.7, roughness: 0.22,
  },
  brass: {
    name: { pt: 'Latão', en: 'Brass' },
    raw: 0x9c7d3a, cut: 0xe2c060, chips: 0xebcb6a, metalness: 0.85, roughness: 0.28,
  },
  copper: {
    name: { pt: 'Cobre', en: 'Copper' },
    raw: 0x8a4f34, cut: 0xe38b5c, chips: 0xe99a6c, metalness: 0.85, roughness: 0.28,
  },
  bronze: {
    name: { pt: 'Bronze (SAE 660)', en: 'Bronze (SAE 660)' },
    raw: 0x6f5532, cut: 0xc89a5a, chips: 0xd0a462, metalness: 0.8, roughness: 0.32,
  },
  cast_iron: {
    name: { pt: 'Ferro fundido cinzento', en: 'Grey cast iron' },
    raw: 0x45433f, cut: 0x9a9ea3, chips: 0x5f6266, metalness: 0.55, roughness: 0.6,
  },
  nylon: {
    name: { pt: 'Nylon (Tecnil)', en: 'Nylon (polyamide)' },
    raw: 0xe6dfcc, cut: 0xf1ebda, chips: 0xf5f0e2, metalness: 0, roughness: 0.55,
  },
  pom: {
    name: { pt: 'Poliacetal (POM)', en: 'Acetal (POM)' },
    raw: 0x2e3033, cut: 0x3a3c40, chips: 0x4a4c50, metalness: 0, roughness: 0.4,
  },
  ptfe: {
    name: { pt: 'Teflon (PTFE)', en: 'Teflon (PTFE)' },
    raw: 0xeeeeea, cut: 0xf7f7f4, chips: 0xfbfbf8, metalness: 0, roughness: 0.65,
  },
};

export const DEFAULT_MATERIAL = 'steel';

export const materialOf = (key) => MATERIALS[key] || MATERIALS[DEFAULT_MATERIAL];

/** Posições da torre em relação à linha de centro (vista do operador, de frente para a máquina). */
export const TURRET_SIDES = ['rear', 'top', 'front'];
export const DEFAULT_TURRET_SIDE = 'rear';
