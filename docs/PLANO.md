# Plano do simulador de torno CNC

## Contexto

- **Público:** alunos de ensino técnico.
- **Máquina da escola:** torno **Veker LVK-175** com comando **Siemens SINUMERIK 802D sl**
  (bem simulado pelo SinuTrain). Fotos e observações em [Referência da máquina](#referência-da-máquina).
- **Cenário de uso:**
  Os alunos primeiro **aprendem a programar** e depois **aprendem a operar** a máquina.
- **Objetivo do simulador:** cobrir as duas etapas no navegador, sem instalação, de modo que o que
  o aluno aprende aqui se transfira direto para a máquina real.

## Princípios

1. **Fidelidade ao fluxo da máquina, não à aparência de outro software.** SinuTrain e SSCNC
   imitam o comando e o painel das máquinas para que o treino se transfira para o chão de fábrica.
   Nosso alvo é o mesmo: imitar **a máquina da escola** (o comando e o painel de operação),
   não copiar o SinuTrain nem o SSCNC.
2. **Sem marcas de terceiros.** Não usar logos, nomes comerciais nem ícones copiados. Layout, fluxo
   de telas, modos e teclas podem seguir a lógica da máquina com arte própria.
3. **Núcleo separado da interface.** Interpretador, estado da máquina e simulação não dependem da UI.
   Assim, a mesma simulação pode ser vista em mais de um "perfil de interface".
4. **Siemens 802D sl primeiro.** O dialeto, os ciclos e as telas seguem o 802D sl. Fanuc continua
   suportado, mas como secundário.

## Etapa 0: base técnica (pré-requisito das demais)

Feito em 2026-11-11:

- [x] **Login** de aluno e professor (senha com scrypt, sessão por cookie, limite de tentativas).
- [x] **Banco SQLite** (módulo nativo do Node), com migrações.
- [x] **Programas salvos por aluno** (criar, salvar, salvar como, excluir) e rascunho automático no navegador.
- [x] **Configurações por usuário** (idioma, dialeto, peça bruta, velocidade, vistas).
- [x] **Painel do professor:** cadastrar alunos e turmas, redefinir senha, desativar, ler os programas dos alunos.
- [x] **Idioma PT/EN** em toda a interface e nas mensagens do interpretador.
- [x] **Interpretador rodando no navegador**; `/api/parse` fica como apoio no servidor.
- [x] **Seleção de dialeto** (Sinumerik / Fanuc) para resolver G70/G71.
- [x] **Torre padrão de 8 ferramentas** (T1–T4 externas simuladas; T5–T8 se movem, mas ainda não removem material).

Falta:

- [ ] Separar o **estado da máquina** (posição, modos, corretores, origens, overrides) em um módulo próprio.
      Melhor fazer junto com os modos JOG/MDA da Etapa 2.
- [ ] **Tabela de ferramentas editável** (raio de ponta, corretores de geometria e desgaste).
- [ ] **Origens** G54–G57 com deslocamento real (hoje o zero da peça é sempre a face).
- [ ] **Implantação no VPS:** HTTPS (proxy reverso), `NODE_ENV=production`, backup do banco.

## Etapa 1: programação (foco SinuTrain)

- [ ] **Programação manual por passes (aulas iniciais):** cabeçalho (rotação, avanço, ferramenta),
      `G0` até perto da peça já na profundidade do passe e `G1` até a coordenada. Já funciona;
      melhorar mensagens de erro e exemplos nesse estilo, que é o que o professor ensina primeiro.
- [ ] **Calculadora de corte** (rpm = Vc·318/Ø, igual ao adesivo da máquina) para o aluno conferir o `S`.

Ciclos do **802D sl** (são estes que os alunos usam na máquina):

- [ ] **CYCLE95:** desbaste de contorno (longitudinal/transversal, desbaste e acabamento), com
      contorno em subprograma. Prioridade alta, mas depois de garantir que G0/G1 manual (como se ensina
      nas aulas iniciais) está impecável.
- [ ] **CYCLE93:** canal.
- [ ] **CYCLE94 / CYCLE96:** alívios (forma E/F e de rosca).
- [ ] **Rosca:** G33 com hélice visível na peça, **CYCLE97** (rosca) e CYCLE98 (rosca encadeada), com passes múltiplos.
- [ ] **Furação no centro:** CYCLE81–CYCLE83, com broca de centro e broca helicoidal.
- [ ] **Usinagem interna:** a peça passa a ter perfil externo **e** interno (furo), para furação,
      mandrilamento e rosca interna. Exige mudar o modelo da peça em `stock.js` (hoje só tem raio externo).
- [ ] Fanuc (secundário): G71/G70, G75, G76/G92, G83, só se a pergunta 4 confirmar.
- [ ] **Compensação de raio da ponta** G41/G42 (perfil correto em cones e raios).
- [ ] **Subprogramas e variáveis básicas:** subprogramas (`.SPF`, chamada por nome/`L`), parâmetros `R`,
      rótulos e `GOTOF`/`GOTOB`, o mínimo usado nos ciclos do 802D sl.
- [ ] **Vista 2D plana** (torno visto de cima, com zoom e medição), além da 3D e do meio corte.
- [ ] **Editor melhor:** destaque de sintaxe, erros marcados enquanto digita e ajuda ao passar o mouse sobre G/M.
- [ ] **Formulários de ciclo** (preencher os parâmetros e gerar a linha do ciclo), no espírito do
      programGUIDE. Fase posterior.
- [ ] *(Mais tarde, a avaliar)* Programação conversacional por etapas, no estilo ShopTurn.

## Etapa 2: operação (foco SSCNC / máquina real)

- [ ] **Modos de operação:** JOG, manivela (incrementos 0,001 / 0,01 / 0,1), MDA e AUTO.
- [ ] **Referenciamento da máquina** ao "ligar" (ir ao ponto de referência), se a máquina exigir.
- [ ] **Overrides** de avanço, rápido e rotação, e parada de emergência.
- [ ] **Preset de ferramenta:** encostar a ferramenta na peça em JOG/manivela, informar o
      diâmetro/face medido e gravar o corretor, como na máquina.
- [ ] **Origem da peça:** tocar a face e gravar o G54.
- [ ] **Corretores de desgaste:** ajustar após medir a peça (ciclo real de correção dimensional).
- [ ] **Alarmes** com o comportamento do comando: reset, confirmação, bloqueio de start.
- [ ] Peça bruta configurável e fixação na placa, com comprimento em balanço.

## Etapa 3: recursos didáticos

- [ ] **Medição virtual** da peça pronta (paquímetro/micrômetro: clicar e ler diâmetro e comprimento).
- [ ] **Comparação com o desenho:** o professor define o perfil esperado e as tolerâncias;
      o sistema compara com a peça usinada.
- [ ] **Exercícios e avaliação:** enunciado, peça bruta, ferramentas disponíveis e nota automática.
- [ ] *(A avaliar)* Contas de aluno/professor e entrega de exercícios pelo servidor.

## Estudo de viabilidade: perfis de interface

**Pergunta:** dá para oferecer, por configuração, a interface atual ("Simples") **ou** uma
interface que emula o comando e o painel da máquina da escola ("Máquina")?

**Por que fazer:** os simuladores comerciais emulam a interface porque o objetivo é que o aluno
treine os mesmos passos, teclas e telas que vai encontrar na máquina. Então emulamos a **máquina**:
o comando Sinumerik do torno da escola e o painel de comando da máquina.

**Abordagem proposta:**

1. **Levantamento:** fotos em close da tela, do teclado e do painel da máquina, e o manual do operador
   do 802D sl (torneamento). Mapear as áreas de operação (Posição/Máquina, Parâmetros/Corretores,
   Programa, Gerenciador de programas, Sistema, Alarmes), as softkeys horizontais e verticais de cada
   tela e as teclas do painel (modos, start/stop, reset, overrides, manivelas).
2. **Modelo de navegação como dados:** descrever telas, softkeys e transições em configuração
   (JSON), interpretadas por um motor de UI genérico. Ajustar para outra máquina ou versão de comando
   passa a ser editar configuração, não reescrever código.
3. **Protótipo vertical:** uma única tela completa (Máquina → AUTO, com posição, bloco atual,
   softkeys e painel de comando) ligada ao núcleo existente. Avaliar com professores e alunos.
4. **Decisão:** se o protótipo for útil, expandir tela a tela, seguindo a ordem em que os alunos
   aprendem (programa → simulação → JOG/preset → AUTO).

**Riscos e pontos de atenção:**

- A fidelidade depende de material de referência da máquina real.
- Marcas e direitos: arte e textos próprios; nada copiado do software original.
- Tamanho de tela: o comando real é pensado para uma tela fixa. A emulação precisa caber no notebook do aluno.
- Esforço: o perfil "Máquina" é a parte mais trabalhosa do projeto. Por isso entra como protótipo
  antes de compromisso total.

**Critério de sucesso:** um aluno que treinou no perfil "Máquina" consegue executar na máquina real
a mesma sequência (abrir programa, simular, fazer preset, rodar em AUTO) sem precisar reaprender a navegação.

## Ordem sugerida

1. Etapa 0 (base) + ciclo de desbaste CYCLE95 / G71-G70
2. Tabela de ferramentas, corretores e G54 + G41/G42
3. Rosca com hélice + ciclos de rosca e canal
4. Vista 2D + editor com checagem ao vivo
5. Levantamento e protótipo do perfil "Máquina"
6. Modos JOG/manivela/MDA + preset (já dentro do perfil escolhido)
7. Medição, comparação com desenho e exercícios

## Decisões registradas

| # | Tema | Decisão | Data |
|---|---|---|---|
| 1 | Máquina e comando | **Veker LVK-175** com **SINUMERIK 802D sl**. | 2026-11-11 |
| 2 | Forma de programar | **Só código G.** O professor confirmou que não usa ShopTurn; suporte conversacional fica para o futuro. Nas aulas iniciais: cabeçalho com rotação/avanço, `G0` até perto da peça já na profundidade do passe, `G1` até a coordenada (passes manuais, sem ciclos). | 2026-11-11 |
| 3 | Equipamento | **Torre de 8 posições** (disco horizontal, marca Lio Shing) e **contraponto com ponta rotativa**. Barramento plano. Placa de 3 castanhas com protetor. | 2026-11-11 |
| 3b | Posição da ferramenta | **Torre traseira**: a ferramenta fica **atrás** da linha de centro. Na tela, X positivo para cima (como o simulador já desenha); G2/G3 aparecem como hoje. | 2026-11-11 |
| 4 | Fanuc | **Só o suporte básico** que já existe. Nada de ciclos Fanuc por enquanto. | 2026-11-11 |
| 5 | Distribuição | Roda em um **VPS**, alunos acessam pelo **navegador**. Arquitetura cliente-servidor: processamento pesado (interpretador, simulação, 3D) **no cliente**; o VPS cuida de login, sessão, banco de dados e armazenamento. Mover processamento para o VPS só se for necessário. **Login e trabalhos salvos por aluno.** | 2026-11-11 |
| 6 | Material de referência | Recebidos: visão geral, closes do painel de comando, da tela e do teclado, torre, contraponto e adesivo de fórmulas. **Fotos da tela ligada não são possíveis**: a máquina está com defeito. | 2026-11-11 |
| 10 | Ferramentas da torre | Usar as ferramentas mais comuns em cursos técnicos (tabela "Torre padrão" abaixo). | 2026-11-11 |
| 13 | SinuTrain | O professor usa o **SinuTrain v4.95**. Ele diz que usa "a 802D sl", mas não está claro se é a máquina criada no SinuTrain ou a máquina real. Ver suposição. | 2026-11-11 |
| 12 | Lacunas | **Usar os padrões do SinuTrain** (o que os alunos estão usando enquanto a máquina está parada) para preencher o que não se sabe. Cada suposição fica registrada em "Suposições" e pode ser revista. | 2026-11-11 |
| 7 | Idioma | Interface e comando emulado em **português e inglês**, configurável. | 2026-11-11 |

### Impactos das decisões no plano

- **Etapa 0 ganha:** autenticação (aluno/professor), banco de dados, programas e
  configurações salvos por aluno, e internacionalização (PT/EN) desde o início.
- O interpretador de G-code passa a rodar **no navegador** (o módulo já é compartilhado). O endpoint
  `/api/parse` pode continuar existindo só como apoio (ex.: correção automática de exercícios).
- A pasta `programs/` deixa de ser o armazenamento principal: exemplos continuam como arquivos,
  e os trabalhos dos alunos vão para o banco.
- Fanuc: manter o que existe (G0–G3, U/W, T0101, G28, G96/G97, G98/G99) e não investir mais.
- Ciclos e sintaxe seguem o **802D sl** (CYCLE93/95/97 etc., não os ciclos do 828D/840D).
- A cena 3D passa a mostrar **torre de 8 posições** (troca de ferramenta girando o disco) e **contraponto**.
  A tabela de ferramentas tem 8 posições (T1–T8).
- Passes manuais G0/G1 vêm antes dos ciclos na ordem de ensino; o simulador já cobre isso.
- O perfil "Máquina" emula o **802D sl da LVK-175**: tela com 8 softkeys verticais à direita e
  8 horizontais embaixo (mais as teclas `^` e `>`), teclado CNC completo e o painel de comando
  descrito abaixo.

## Referência da máquina

Fotos em `docs/referencia/maquina/`:

| Foto | O que mostra |
|---|---|
| `frente-painel.png` | Vista frontal da LVK-175: tela, teclado, painel de comando, torre de sinalização e painel na porta direita com emergência e duas manivelas. |
| `tela-e-teclado.jpeg` | Tela do 802D sl (desligada): 8 softkeys verticais à direita; embaixo `^`, 8 softkeys e `>`. |
| `teclado-cnc.jpeg` | Teclado CNC legível (detalhes abaixo). |
| `painel-comando-mcp.jpeg` | Painel de comando da máquina legível (detalhes abaixo). |
| `torre-8-posicoes.jpeg` | Torre em disco com ferramentas de tornear externas presas radialmente. |
| `contraponto.jpeg`, `interior-placa-torre-contraponto.jpeg` | Contraponto com ponta rotativa; placa, torre e contraponto juntos. |
| `interior-placa.jpeg`, `interior-placa-carro.png` | Placa de 3 castanhas com protetor e barramento plano. |
| `traseira-hidraulica.png` | Armário elétrico e unidade hidráulica. |
| `adesivo-formulas-corte.jpeg` | Adesivo com fórmulas: rpm = Vc·318/Ø, Vc = rpm·Ø/318, avanço. |

### Teclado CNC (802D sl)

- Topo: `ALARM CANCEL`, `CHANNEL`, `HELP`.
- Letras: O N G P / X Y Z C / I J K R / M S T L / F D H B, com segunda função via `SHIFT`
  (ex.: `;` `:` `E` `U` `V` `W` `Q` `A` `"` `*` `[` `]` `+/-`).
- Números 0–9, `-` `.` `/` `=` `+`, também com segunda função (`& ( $ % ! @ # ) > ?`).
- Edição: `SHIFT` `CTRL` `ALT` espaço, `BACKSPACE` `DEL` `INSERT` `TAB` `INPUT` (amarela).
- Navegação: `NEXT WINDOW`, `PAGE UP`, `PAGE DOWN`, setas, `SELECT`, `END`.
- **Áreas de operação:** `POSITION` (M), `PROGRAM`, `OFFSET PARAM`, `PROGRAM MANAGER`,
  `SYSTEM/ALARM`, `CUSTOM`.

### Painel de comando da máquina (fabricante, não o padrão Siemens)

- `EMERGENCY STOP` (cogumelo) e, embaixo, `RESET`, `STOP` (parada de ciclo) e `START` (cycle start).
- `STATUS`: 3 LEDs verdes (X, ?, Z), provavelmente "eixo referenciado". `ALARM`: 3 LEDs vermelhos.
- Chave de 3 posições (0/1/2), provavelmente proteção de programa.
- `MODE`: `VAR` (incremento variável), `JOG`, `REF.P` (referenciar), `AUTO`, `SBK` (bloco a bloco), `MDA`;
  fuso `CCW` / `STOP` / `CW`; mais duas teclas de fuso na última linha (provável ajuste/jog do fuso).
- `AXIS DIRECTION`: `+X` `-X` `+Z` `-Z`, `RAPID` no centro, `+C` `-C`, e `IN` / `OUT`
  (provável avanço/recuo do mangote do contraponto ou aperto da placa).
- `AUXILIARY FUNCTION`: 12 teclas com ícones (troca de torre, refrigeração, luz, placa, contraponto…),
  pouco legíveis na foto.
- Manivela: seleção de eixo `X` `Z` `C` e incremento `×1` `×10` `×100`.
- Dois seletores giratórios: override do fuso (50–120 %) e override de avanço (0–120 %).

### Observações a confirmar

- O mangote do contraponto parece ser acionado pelo painel (`IN`/`OUT`) e pela unidade hidráulica.
- O eixo C aparece no painel, mas provavelmente não é usado (torno sem ferramenta acionada).

## Torre padrão (8 posições)

Ferramentas mais comuns em cursos técnicos de torneamento CNC (decisão 10):

| T | Ferramenta | Uso nas aulas |
|---|---|---|
| T1 | Desbaste externo 80° (pastilha CNMG, suporte 95°) | Faceamento e desbaste |
| T2 | Acabamento externo 35° (VNMG, suporte 93°) | Perfil final, raios e chanfros |
| T3 | Bedame 3 mm | Canais e corte (sangramento) |
| T4 | Rosca externa 60° (métrica) | Roscas externas (G33 / CYCLE97) |
| T5 | Broca de centro | Furo de centro (para contraponto ou antes da broca) |
| T6 | Broca helicoidal Ø10 | Furação |
| T7 | Barra de mandrilar (desbaste/acabamento interno) | Furos e perfis internos |
| T8 | Rosca interna 60° | Roscas internas |

T1–T3 já existem no simulador. T4–T8 dependem da usinagem interna e da rosca com hélice (Etapa 1).

## Suposições (padrões do SinuTrain até haver confirmação)

| Tema | Suposição adotada | Confirmar com |
|---|---|---|
| Interface que os alunos veem hoje | O número 4.95 coincide com a versão do software **SINUMERIK Operate** (828D/840D sl), então o SinuTrain v4.95 provavelmente mostra a interface do Operate, e não a do 802D sl. Não foi possível confirmar se ele oferece um modelo 802D sl. O código G básico é o mesmo nos dois. | Captura de tela do SinuTrain do professor (pergunta 15) |
| Preset e zero da peça | Ferramentas já vêm medidas (corretores preenchidos), como no SinuTrain. Zero da peça na face, em **G54**, definido por uma tela de "medir peça" em JOG. | professor da disciplina (pergunta 9) |
| Rotação | Exemplos com **G96 + LIMS** e também com **G97** calculado pela fórmula do adesivo. Os dois funcionam. | Professor (pergunta 11) |
| Manivela | Uma manivela eletrônica, selecionada pelo painel (X/Z, ×1/×10/×100). As duas manivelas da porta ficam fora por enquanto. | Pergunta 8 |
| Contraponto | Mostrado na cena, posicionado pela configuração da peça, sem simular as teclas `IN`/`OUT`. | Pergunta 3c |
| Modos ao ligar | `G18 G90 DIAMON G95 G97` (plano de torneamento, absoluto, X em diâmetro, avanço por rotação). | Comparar com o SinuTrain |

## Perguntas pendentes

Nenhuma bloqueia o trabalho atual; as suposições acima cobrem as lacunas.

| # | Pergunta | Por que importa |
|---|---|---|
| 3c | O contraponto avança pelo painel (`IN`/`OUT`) ou na mão? | Simulação do contraponto |
| 6 | Fotos da tela ligada (quando a máquina voltar) e close do painel da porta e das teclas de função auxiliar. Manual de operação do 802D sl, se houver | Fidelidade do perfil "Máquina" |
| 8 | O que são as duas manivelas do painel da porta? | Como simular JOG/manivela |
| 9 | Professor que opera a máquina: como os alunos fazem o preset das ferramentas e o zero da peça? | Fluxo de operação a simular |
| 11 | O aluno usa rotação fixa (`G97 S…`) ou velocidade de corte constante (`G96`)? | Padrão dos exemplos e exercícios |
| 15 | Capturas de tela do **SinuTrain do professor** (é no PC, não depende da máquina): a tela de criar máquina, mostrando os tipos de comando disponíveis, e algumas telas de uso | Saber se os alunos veem 802D sl ou Operate; serve de referência visual enquanto a máquina está parada |
| 14 | O perfil "Máquina" deve imitar o **802D sl** (máquina real) ou a interface do **SinuTrain/Operate** (o que os alunos usam agora)? | Define o alvo do protótipo de interface |
