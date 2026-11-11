# Plano do simulador de torno CNC

Limitações conhecidas da versão atual: [LIMITACOES.md](LIMITACOES.md).

## Contexto

- **Público:** alunos de ensino técnico.
- **Máquina da escola:** torno **Veker LVK-175** com comando **Siemens SINUMERIK 802D sl**
  (bem simulado pelo SinuTrain). Fotos e observações em [Referência da máquina](#referência-da-máquina).
- **Cenário de uso:**
  Os alunos primeiro **aprendem a programar** e depois **aprendem a operar** a máquina.
- **Objetivo do simulador:** cobrir as duas etapas no navegador, sem instalação, de modo que o que
  o aluno aprende aqui se transfira direto para a máquina real.

### Como o professor da disciplina usa o SinuTrain nas aulas (relato de 2026-11-11)

Fonte: áudio de ~3 min e mensagem escrita do professor da disciplina, transcritos e filtrados.

1. **Peça bruta primeiro:** o aluno informa o diâmetro máximo do bruto (normalmente um cilindro maciço,
   mas pode ser um **tubo**, para usinagem interna), o **zero peça** (referência das medidas), o
   **comprimento total** e o **comprimento fixado nas castanhas**, e com isso o comprimento útil de usinagem.
2. **Escolha das ferramentas** pela operação: desbaste, acabamento, corte (bedame), usinagem interna…
3. **Programa passo a passo:** escreve e simula aos poucos, corrigindo o que errou. O simulador é
   para **praticar**; o professor **não avalia o que é feito no simulador**.
4. **Conferência das medidas:** depois de rodar, o aluno usa as **réguas/escalas dos eixos** do
   simulador (Z ao longo da peça, X no diâmetro) para medir o comprimento total e os trechos usinados
   e verificar se batem com as medidas programadas.
5. **Avaliação no papel:** o professor fornece os dados tecnológicos (material, diâmetro a usinar,
   avanço, velocidade de corte e **quantidade de passes** em cada trecho onde a seção muda), para que
   exista um **gabarito padronizado**. Cada bloco com erro é eliminado; a nota é proporcional à
   quantidade de blocos certos em relação ao gabarito.

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

- [x] **Cadastro aberto e login** (senha com scrypt, sessão por cookie, limite de tentativas e de cadastros por IP).
- [x] **Banco SQLite** (módulo nativo do Node), com migrações.
- [x] **Programas salvos por aluno** (criar, salvar, salvar como, excluir) e rascunho automático no navegador.
- [x] **Configurações por usuário** (idioma, dialeto, peça bruta, velocidade, vistas).
- [x] **Turmas:** qualquer usuário cria as suas e convida alunos por link/código; alunos **entregam** programas
      e o professor vê só as entregas. Administração do sistema por `ADMIN_USERNAMES`.
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
- [ ] **Recuperação de senha por e-mail** (o e-mail já é coletado, opcional; precisa de um serviço de envio no VPS).

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
- [x] **Usinagem interna** (2026-11-11): perfil externo e interno; furação em X0, mandrilamento e rosca
      interna; colisão do corpo da barra e broca fora do centro.
- [x] **Torre configurável** (2026-11-11): catálogo de ferramentas, cada posição escolhida numa lista.
- [x] **Exemplos de curso técnico** (2026-11-11): pino roscado M20, bucha, peça completa com as 8 ferramentas.
- [ ] Fanuc (secundário): G71/G70, G75, G76/G92, G83, só se a pergunta 4 confirmar.
- [ ] **Compensação de raio da ponta** G41/G42 (perfil correto em cones e raios).
- [ ] **Subprogramas e variáveis básicas:** subprogramas (`.SPF`, chamada por nome/`L`), parâmetros `R`,
      rótulos e `GOTOF`/`GOTOB`, o mínimo usado nos ciclos do 802D sl.
- [x] **Vistas** (2026-11-11): 3D, Lateral (2D em corte), Face, Meio corte e Peça pronta, como no SINUMERIK Operate.
- [ ] **Vistas que faltam:** duas janelas, medição na vista e ampliação por região.
- [ ] **Editor melhor:** destaque de sintaxe, erros marcados enquanto digita e ajuda ao passar o mouse sobre G/M.
- [ ] **Formulários de ciclo** (preencher os parâmetros e gerar a linha do ciclo), no espírito do
      programGUIDE. Fase posterior.
- [ ] *(Mais tarde, a avaliar)* Programação conversacional por etapas, no estilo ShopTurn.

### Pedidos de funcionalidade (2026-11-11)

- [ ] **Peça bruta como no SinuTrain** (relato do professor da disciplina): além de diâmetro e comprimento,
      **tubo** (diâmetro interno do bruto, para usinagem interna sem furar antes), **comprimento fixado
      nas castanhas** (hoje fixo em 25 mm) e posição do **zero peça**. Mostrar o comprimento útil
      (em balanço) e alarmar se a ferramenta for além dele. Ver pergunta 19 (como o aluno informa o
      bruto no SinuTrain: tela ou linha no programa).
- [ ] **Escolha de ferramentas pela operação:** a torre configurável já existe; nos exercícios, deixar
      o professor definir quais ferramentas estão disponíveis e o aluno montar a torre.

- [ ] **Roscas:** hoje a rosca aparece como um rebaixo liso até o fundo do filete. Pedido:
      - hélice visível na peça (externa e interna), com passo, profundidade e sentido corretos;
      - passes múltiplos de rosca visíveis (o filete aprofundando a cada passe);
      - G33 cônica, várias entradas e ângulo de início `SF=`, conforme o 802D sl;
      - **CYCLE97** (e depois CYCLE98) e, no Fanuc básico, G76/G92 se a pergunta 4 confirmar;
      - avisos didáticos: passo incompatível com a ferramenta, rotação alta demais para o passo,
        falta de entrada/saída (aproximação antes do início da rosca).
      Caminho técnico: a hélice é só visual (deslocar os vértices da malha conforme o ângulo); o modelo
      de remoção continua por perfil. Ver também LIMITACOES.md.
- [ ] **Fluidos (refrigeração):** hoje M8/M9 são lidos e ignorados. Pedido:
      - jato de fluido de corte saindo do bico em direção à ponta da ferramenta com M8, parando com M9;
      - indicação do estado da refrigeração no painel (como a lâmpada/tecla da máquina);
      - aviso didático (opcional, configurável) ao usinar sem refrigeração;
      - respeitar o modo econômico (sem aceleração gráfica, efeito simplificado ou desligado).
      Caminho técnico: partículas/linhas no Three.js, desenhadas só enquanto a refrigeração está ligada.

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

A conferência de medidas foi **confirmada** pelo professor da disciplina em 2026-11-11 (ver Contexto): os
alunos medem o comprimento total e os trechos usinados com as réguas dos eixos. Detalhes em
[Plano de medição e conferência da peça](#plano-de-medição-e-conferência-da-peça).

- [ ] **Réguas graduadas nos eixos Z e X** nas vistas Lateral e Peça pronta, com linhas de
      chamada ao passar o mouse sobre faces e diâmetros. É o que os alunos já usam no SinuTrain;
      vem antes da fase 1.

- [ ] **Fase 1 – Medir na peça:** modo "Medir" nas vistas Lateral e Peça pronta; Ø externo e do furo,
      comprimento entre faces, valor no formato do instrumento.
- [ ] **Fase 2 – Tabela de cotas** automática da peça pronta.
- [ ] **Fase 3 – Comparar com o desenho:** cotas esperadas e tolerâncias no exercício; correção automática.
- [ ] **Fase 4 (opcional) – Desenho em diedro** da peça pronta (1º diedro, ABNT), com cotas.
      Detalhado em [Desenho técnico a partir da peça](#desenho-técnico-a-partir-da-peça-caminho-inverso)
      (fases A–E).
- [ ] **Exercícios e avaliação:** enunciado, peça bruta, ferramentas disponíveis e nota automática.
- [ ] **Correção por blocos contra o gabarito** (pedido do professor da disciplina, 2026-11-11): o professor
      cadastra o programa-gabarito e os dados tecnológicos (material, diâmetro, avanço, Vc, passes por
      trecho); o programa do aluno é comparado **bloco a bloco**; cada bloco com erro é eliminado e a
      nota é `blocos certos ÷ blocos do gabarito`. Notas técnicas:
      - alinhar os dois programas como um `diff` (um bloco a mais ou a menos no aluno não pode
        "deslocar" todos os seguintes e zerar o resto);
      - comparar o **significado** do bloco, não o texto: ordem das palavras, `X30` = `X30.0`, espaços,
        comentários e números de bloco `N` não contam como erro (critério a confirmar, pergunta 20);
      - mostrar ao professor a lista de blocos certos/errados lado a lado, com a nota sugerida, e
        deixá-lo ajustar antes de publicar;
      - complementar com a simulação: além do texto, conferir se a peça do aluno tem as cotas do
        gabarito (usa o plano de medição).
      Como hoje a avaliação é no papel, o uso inicial pode ser o professor **digitar** a resposta do aluno
      ou o aluno entregar pela turma em atividade de treino.
- [x] Contas e entrega de programas pelo servidor (turmas e entregas, 2026-11-11).

## Plano de medição e conferência da peça

Registrado em 2026-11-11. **Status: conferência confirmada** pelo professor da disciplina (2026-11-11): os alunos
medem com as réguas dos eixos do simulador. Instrumentos reais (paquímetro, micrômetro) não foram
citados; a fase 1 pode começar pelas réguas e pela leitura direta do valor.

### Contexto (pesquisa)

- Um professor de mecânica (não de CNC) relatou que, depois da simulação, costuma-se **conferir as
  medidas da peça**, principalmente os comprimentos entre faces, além dos diâmetros. Isso corresponde
  à inspeção da primeira peça na indústria (paquímetro/micrômetro contra o desenho).
- **SSCNC:** tem menu de **medição** da peça simulada: clica-se sobre um diâmetro e lê-se o valor;
  o instrumento muda sozinho (micrômetro para diâmetros pequenos, súbito para furos); também mede
  pelo teclado ou digitando a posição. Fonte: tutoriais do SSCNC (Scribd).
- **SinuTrain / SINUMERIK Operate:** não foi encontrado paquímetro virtual na simulação. O que existe
  é **"Medir peça"** com apalpador e ciclos de medição (preset e controle de processo), outro conceito.
- **Vistas de diedro:** nem o SinuTrain nem o SSCNC geram desenho técnico em diedro; têm vistas de
  simulação (lateral, face, meio corte, 3D, duas janelas). Lateral, Face, Meio corte e 3D já existem aqui.

### Fases

| Fase | Entrega | Motivo | Depende de |
|---|---|---|---|
| 1. Medir na peça | Modo "Medir" nas vistas Lateral e Peça pronta. Clique num trecho mostra Ø externo e Ø do furo; clique em duas faces mostra o comprimento; o clique "gruda" em faces e cantos. Valor no formato do instrumento (paquímetro 0,02/0,05 mm, micrômetro 0,01 mm, súbito para furos) | É o que o professor descreveu e o que o SSCNC faz | Pergunta 16 (resoluções) |
| 2. Tabela de cotas | Lista automática da peça pronta: cada diâmetro (Ø, Z inicial, Z final, comprimento), faces, cones, furos | Conferência rápida sem clicar ponto a ponto | — |
| 3. Comparar com o desenho | No exercício, o professor cadastra cotas esperadas e tolerâncias (ex.: Ø30 ±0,05; 55 ±0,1); o sistema mede a peça entregue e marca verde/vermelho | Correção automática; usa turmas e entregas que já existem | Definir o formato dos exercícios |
| 4. Desenho em diedro (opcional) | Desenho técnico da peça pronta em 1º diedro: vista frontal com meio corte, vista lateral, cotas automáticas; exportar PDF/SVG. Detalhado nas fases A–E da seção seguinte | Ensina leitura de desenho; mais trabalhoso | Pergunta 18 (estilo de cotagem) |

### Notas para a implementação

- O perfil da peça pronta já existe no modelo (`shared/stock-model.js`: `r`, `ri`, `diameterAt`,
  `boreAt`; peça separada em `Simulator.parts`). A medição e a tabela de cotas podem ser funções puras
  em `shared/`, testadas no Node como as cotas dos exemplos (`test/unit/examples.test.js`).
- Ao mostrar valores, considerar a resolução da simulação (~0,035 mm; até ~0,1 mm em perfis muito
  inclinados – ver LIMITACOES.md) para não exibir casas decimais enganosas.

## Desenho técnico a partir da peça (caminho inverso)

Registrado em 2026-11-11. **Status: proposta.** Amplia as fases 2 e 4 do plano de medição.

Na prática o mecânico parte do desenho 2D cotado e escreve o código G. A ideia aqui é o caminho
inverso: a partir da peça torneada pronta, gerar o desenho 2D com cotas, ângulos e raios, e usá-lo
para o aluno ver no papel o que o programa dele produziu.

### Viabilidade

- **Viável, e mais fácil que no caso geral**, porque a peça de torno é um **sólido de revolução**:
  ela é inteira definida por um contorno 2D girado em torno do eixo. O modelo já guarda exatamente
  isso (raio externo `r` e raio do furo `ri` a cada 0,05 mm em Z); o 3D é só esse contorno girado.
- Duas fontes de informação, usadas juntas:
  - **peça simulada:** diz o que realmente ficou (o que foi cortado e o que sobrou);
  - **programa (eventos do interpretador):** dá os valores exatos (`G1 X30` → Ø30, `CR=5` → R5),
    evitando cotas aproximadas como 29,98.

| Parte | Dificuldade | Motivo |
|---|---|---|
| Contorno 2D (meio corte com hachura) | Baixa | O perfil já existe; a vista Lateral quase faz isso |
| Converter pontos em retas e arcos | Média | Agrupar as amostras e casar com os movimentos do programa |
| Reconhecer elementos (degrau, chanfro, cone, raio, canal, furo, rosca) | Média | Regras geométricas simples num contorno de torno |
| **Cotagem automática** (quais cotas, onde pôr, sem sobrepor) | **Alta** | Exige critério de desenhista; dá para automatizar um estilo, não todos |
| Tolerâncias, rugosidade, material | Não sai da peça | Vêm do desenho original (cadastro do exercício) |

### Fases

- [ ] **Fase A – Contorno técnico 2D:** vista frontal com **meio corte** (metade de cima em vista,
      metade de baixo cortada e hachurada, mostrando o furo), linha de centro (traço-ponto), arestas
      visíveis e ocultas; contorno convertido em retas e arcos e ajustado às coordenadas do programa.
- [ ] **Fase B – Reconhecimento dos elementos:** diâmetros de cada degrau, comprimentos e faces;
      chanfro (`1×45°`), cone com ângulo, raio (`R5`), canal (largura × profundidade), furo e rebaixo
      interno, profundidade da broca; rosca a partir do G33 (`M20×1,5`), desenhada pela convenção da
      norma (linha fina no fundo do filete).
- [ ] **Fase C – Cotagem automática:** diâmetros com `Ø`, comprimentos a partir de uma face de
      referência; opção do professor entre **cotas em paralelo** (todas da mesma face) e **em cadeia**;
      ângulos, raios e roscas; cotas distribuídas em "andares" para não se sobreporem. Começar com um
      estilo simples e fixo e refinar.
- [ ] **Fase D – Folha de desenho:** vista frontal + vista lateral (círculos) no **1º diedro (ABNT)**,
      carimbo/legenda (aluno, turma, programa, escala, data), exportar **PDF/SVG** e imprimir.
- [ ] **Fase E – Uso didático** (= fase 3 do plano de medição): o professor cadastra o desenho
      esperado; o simulador gera o desenho da peça do aluno e **destaca as cotas diferentes**
      (ex.: "Ø30 esperado, saiu Ø32").

Ordem sugerida: A e B primeiro (resultado visível rápido, pouco risco); C em seguida (a mais
trabalhosa); D e E depois da resposta à pergunta 16.

### Limitações a aceitar

- Sem raio de ponta e sem G41/G42 (ver LIMITACOES.md), os cantos saem vivos no desenho, como na simulação.
- Cotas de perfis muito inclinados podem ter erro de ~0,1 mm; usar os valores do programa corrige a
  maior parte.
- A cotagem automática segue um padrão e não vai coincidir sempre com o jeito de cada professor cotar.

### Notas para a implementação

- Funções puras em `shared/` (extrair contorno, ajustar retas/arcos, reconhecer elementos, gerar cotas),
  testadas no Node com os exemplos de `programs/` (as cotas dos desenhos já são conferidas em
  `test/unit/examples.test.js`).
- Desenho em **SVG** no navegador (escala exata, fácil de imprimir e exportar); PDF pela impressão do navegador.
- O contorno do programa vem dos eventos com `pts`; os arcos (G2/G3) precisam guardar centro e raio
  no evento para virar cota `R` exata.

## Possibilidade futura: fresadora

Registrado em 2026-11-11. **Status: ideia para depois que o torno estiver maduro.** Surgiu da pergunta
se o desenho técnico gerado da peça (seção anterior) funcionaria também numa fresadora.

- **Na prática é um segundo simulador.** O modelo atual da peça (um raio por posição Z) só serve para
  sólidos de revolução. Muda o modelo da peça, as ferramentas (fresas), o plano de trabalho (G17),
  os ciclos (bolsão, rasgo, furação em padrão) e a cena 3D.
- **Reaproveitável:** servidor (contas, turmas, entregas), editor, base do interpretador de código G,
  interface, idiomas e estrutura de testes.
- **Modelo da peça:** fresadora 3 eixos (ferramenta vindo de cima) → **mapa de alturas** (grade XY com
  a altura do material em cada ponto). Rebaixos laterais e rasgos em T exigem voxels ou tri-dexel (mais pesados).

| Máquina | Simular a peça | Extrair vistas | Cotar automaticamente |
|---|---|---|---|
| Torno (atual) | Fácil (contorno 2D) | Fácil | Média/alta |
| Fresadora 3 eixos | Média (mapa de alturas) | Média: vista de cima e silhuetas fáceis; linhas ocultas e cortes dão trabalho | Alta: exige reconhecer feições (bolsão, rasgo, furação); melhor partir dos ciclos do programa |
| Fresadora 5 eixos / torno com ferramenta acionada | Alta | Alta | Muito alta |

- **Precisão:** a grade tem resolução limitada (0,1–0,5 mm) e as bordas saem serrilhadas; os valores
  exatos das cotas devem vir do programa (ex.: ciclo de furação → posição, diâmetro e profundidade).

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
3. Rosca com hélice + ciclos de rosca e canal + refrigeração (fluido) visível
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
| 16 | Contas | **Cadastro aberto**, sem tipo fixo de conta. Quem cria uma turma é o professor dela; convida alunos por **link/código**. O professor vê só as **entregas** (cópia do programa no momento da entrega). E-mail **opcional** (para recuperar senha no futuro). Administrador do sistema definido por configuração (`ADMIN_USERNAMES`). | 2026-11-11 |
| 17 | Torre | **Configurável.** Não há padrão industrial de posição: quem prepara a máquina define e registra na folha de ferramentas. Os exemplos usam uma montagem padrão (T1 desbaste … T8 rosca interna). | 2026-11-11 |
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
| 11 | O aluno usa rotação fixa (`G97 S…`) ou velocidade de corte constante (`G96`)? Pista (professor da disciplina, 2026-11-11): na avaliação ele fornece a **velocidade de corte** e o avanço; falta saber se o aluno calcula o `S` (G97) ou programa `G96 S<Vc>`. | Padrão dos exemplos e exercícios |
| 16 | ~~Confirmar a conferência de medidas~~ **Respondida em parte (professor da disciplina, 2026-11-11):** medem comprimento total e trechos com as réguas dos eixos. Falta: querem desenho em diedro? Conferem diâmetros também? Texto original: a conferência de medidas após a simulação é feita assim (diâmetros e comprimentos entre faces)? Quais instrumentos os alunos usam (paquímetro 0,02 ou 0,05 mm, micrômetro 0,01 mm, súbito)? Querem desenho em diedro? | Libera o [plano de medição](#plano-de-medição-e-conferência-da-peça) e define as resoluções |
| 15 | Capturas de tela do **SinuTrain do professor** (é no PC, não depende da máquina): a tela de criar máquina, mostrando os tipos de comando disponíveis, e algumas telas de uso | Saber se os alunos veem 802D sl ou Operate; serve de referência visual enquanto a máquina está parada |
| 18 | Nos desenhos das atividades, as cotas de comprimento são **em paralelo** (todas a partir de uma face), **em cadeia** ou misturadas? | Estilo padrão da cotagem automática ([desenho técnico](#desenho-técnico-a-partir-da-peça-caminho-inverso), fase C) |
| 19 | No SinuTrain, como o aluno informa a peça bruta (diâmetro, tubo, comprimento, fixação, zero peça)? Numa **tela de configuração** ou numa **linha do programa** (ex.: `WORKPIECE(...)`)? Pedir uma foto da tela ou um programa de aluno | Define se o simulador lê o bruto do programa (como o SinuTrain) ou só de um formulário |
| 20 | Na correção por blocos: o que conta como erro? Ex.: ordem das palavras (`G1 X30 Z-20` × `G1 Z-20 X30`), repetir ou omitir palavras modais (`G1` em toda linha), `X30` × `X30.0`, número de bloco `N`. Um bloco a mais no programa do aluno também é erro? Pedir um gabarito e uma prova corrigida como exemplo | Regras da correção automática |
| 14 | O perfil "Máquina" deve imitar o **802D sl** (máquina real) ou a interface do **SinuTrain/Operate** (o que os alunos usam agora)? | Define o alvo do protótipo de interface |
