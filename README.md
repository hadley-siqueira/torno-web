# Torno CNC Web (MVP)

Simulador simples de torno CNC no navegador, inspirado no SinuTrain: você escreve
G-code, aperta **Cycle Start** e vê a ferramenta usinando a peça em 3D (Three.js/WebGL).

```bash
npm install
npm run create-user -- --role professor --username prof --name "Seu Nome"   # mostra a senha gerada
npm start          # http://localhost:3000
npm test           # testes do interpretador e da API
```

Requer Node.js 22.13 ou mais novo (usa o SQLite nativo do Node). O banco fica em `data/cnc.db`
(mude com `DB_PATH`). O professor cadastra os alunos em **Alunos** (`/admin.html`).

### Variáveis de ambiente

| Variável | Uso |
|---|---|
| `PORT` | Porta HTTP (padrão 3000) |
| `DB_PATH` | Arquivo do banco SQLite (padrão `data/cnc.db`) |
| `NODE_ENV=production` | Cookie de sessão só por HTTPS (`Secure`) |
| `TRUST_PROXY` | Atrás de proxy reverso (nginx/Caddy): ex. `1` ou `loopback` |

## Arquitetura

Cliente-servidor: o navegador faz o trabalho pesado (interpretar G-code, simular, desenhar em 3D);
o servidor cuida de login, sessões, banco de dados e programas dos alunos.

| Parte | Arquivo | Função |
|---|---|---|
| Entrada | `server.js` | Abre o banco e sobe o servidor |
| Servidor | `server/app.js`, `server/routes/*` | Express: API e arquivos estáticos |
| Banco | `server/db.js` | SQLite + migrações (usuários, sessões, programas, configurações) |
| Autenticação | `server/auth.js` | Senhas (scrypt), sessões por cookie, limite de tentativas |
| Interpretador | `shared/gcode.js` | G-code → eventos temporizados (roda no navegador e no Node) |
| Ferramentas | `shared/tools.js` | Torre de 8 posições e geometria das pastilhas |
| Idiomas | `shared/i18n.js` | Textos PT/EN da interface e das mensagens |
| Peça | `public/js/stock.js` | Perfil r(z), remoção de material, malha de revolução |
| Cena 3D | `public/js/scene.js` | Placa, ferramenta, trajetória, cavacos, vista em corte |
| Simulador | `public/js/main.js` | Editor, DRO, softkeys, programas, laço da simulação |
| Professor | `public/admin.html`, `public/js/admin.js` | Alunos, turmas e programas dos alunos |

API (todas exigem login, exceto `POST /api/auth/login`; alterações só com JSON da mesma origem):
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/password`
- `GET|PUT /api/settings`
- `GET /api/programs` (exemplos + meus), `GET /api/programs/examples/:nome`,
  `GET|PUT|DELETE /api/programs/:id`, `POST /api/programs`
- Professor: `GET|POST /api/admin/users`, `PATCH /api/admin/users/:id`,
  `GET /api/admin/users/:id/programs`, `GET /api/admin/programs/:id`
- `POST /api/parse` (apoio; o cliente interpreta localmente)

## G-code suportado

- Movimento: `G0`, `G1`, `G2`/`G3` (com `I`/`K` ou `CR=`/`R`), `G33`/`G32` (rosca como avanço reto)
- Modos: `G90`/`G91`, `G94`/`G95` (e `G98`/`G99` Fanuc), `G96`/`G97`, `LIMS=`, `G50 S`, `DIAMON`/`DIAMOF`
- Fanuc: `U`/`W` incrementais, `T0101`, `G28 U0 W0`, `O`, `%`, comentários `( )`
- Sinumerik: `T1 D1`, comentários `;`, `G4 F` (espera)
- `M3`/`M4`/`M5`, `M0`/`M1` (parada), `M2`/`M30`, `M8`/`M9`
- Convenções: X em diâmetro, Z=0 na face, G2 = horário com X para cima.

Alarmes simulados: G0 dentro do material, ferramenta na peça com fuso parado,
colisão com a placa, F ausente, arco inválido, ferramenta inexistente, erro de sintaxe.

Torre de 8 posições: T1 desbaste 80°, T2 acabamento 35°, T3 bedame 3 mm (referência no canto esquerdo),
T4 rosca externa 60°, T5 broca de centro, T6 broca Ø10, T7 barra de mandrilar, T8 rosca interna.
T5–T8 ainda não removem material (usinagem interna em desenvolvimento).

O cabeçalho `; Bruto: D50 x 80 mm, face em Z1` ajusta a peça bruta automaticamente ao abrir o programa.

## Limitações do MVP / próximos passos

- Sem ciclos (`CYCLE95`, `G71`/`G70` Fanuc), subprogramas, variáveis ou compensação de raio (`G41`/`G42`)
- Rosca não gera a hélice (só o diâmetro do fundo)
- Peça é sólido de revolução (sem furação/fresamento com ferramenta acionada)
- Ideias: tabela de ferramentas editável, ciclos de desbaste, contraponto, medição na vista 2D,
  exportar o perfil final, editor com destaque de sintaxe (CodeMirror)
