# Torno CNC Web (MVP)

Simulador simples de torno CNC no navegador, inspirado no SinuTrain: você escreve
G-code, aperta **Cycle Start** e vê a ferramenta usinando a peça em 3D (Three.js/WebGL).

```bash
npm install
npm start          # http://localhost:3000
npm test           # testes do interpretador de G-code
```

## Arquitetura

| Parte | Arquivo | Função |
|---|---|---|
| Servidor | `server.js` | Express: arquivos estáticos + API |
| Interpretador | `shared/gcode.js` | G-code → lista de eventos temporizados (roda no Node) |
| Ferramentas | `shared/tools.js` | Geometria das pastilhas (compartilhado servidor/cliente) |
| Peça | `public/js/stock.js` | Perfil r(z) da peça, remoção de material, malha de revolução |
| Cena 3D | `public/js/scene.js` | Placa, ferramenta, trajetória, cavacos, vista em corte |
| Interface | `public/js/main.js` | Editor, DRO, softkeys, laço da simulação, alarmes |

API:
- `POST /api/parse` `{ code, options? }` → `{ events, warnings, alarm, stats, bounds }`
- `GET /api/programs`, `GET /api/programs/:nome`, `PUT /api/programs/:nome` (text/plain)
- `GET /api/tools`

## G-code suportado

- Movimento: `G0`, `G1`, `G2`/`G3` (com `I`/`K` ou `CR=`/`R`), `G33`/`G32` (rosca como avanço reto)
- Modos: `G90`/`G91`, `G94`/`G95` (e `G98`/`G99` Fanuc), `G96`/`G97`, `LIMS=`, `G50 S`, `DIAMON`/`DIAMOF`
- Fanuc: `U`/`W` incrementais, `T0101`, `G28 U0 W0`, `O`, `%`, comentários `( )`
- Sinumerik: `T1 D1`, comentários `;`, `G4 F` (espera)
- `M3`/`M4`/`M5`, `M0`/`M1` (parada), `M2`/`M30`, `M8`/`M9`
- Convenções: X em diâmetro, Z=0 na face, G2 = horário com X para cima.

Alarmes simulados: G0 dentro do material, ferramenta na peça com fuso parado,
colisão com a placa, F ausente, arco inválido, ferramenta inexistente, erro de sintaxe.

Ferramentas: T1 desbaste 80°, T2 acabamento 35°, T3 bedame 3 mm (referência no canto esquerdo).

O cabeçalho `; Bruto: D50 x 80 mm, face em Z1` ajusta a peça bruta automaticamente ao abrir o programa.

## Limitações do MVP / próximos passos

- Sem ciclos (`CYCLE95`, `G71`/`G70` Fanuc), subprogramas, variáveis ou compensação de raio (`G41`/`G42`)
- Rosca não gera a hélice (só o diâmetro do fundo)
- Peça é sólido de revolução (sem furação/fresamento com ferramenta acionada)
- Ideias: tabela de ferramentas editável, ciclos de desbaste, contraponto, medição na vista 2D,
  exportar o perfil final, editor com destaque de sintaxe (CodeMirror)
