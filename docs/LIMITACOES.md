# Limitações conhecidas

Lista do que o simulador **ainda não faz** ou faz de forma **aproximada**, com o motivo e um caminho
sugerido para resolver. Atualize este arquivo quando resolver um item ou descobrir uma limitação nova.
O planejamento geral está em [PLANO.md](PLANO.md).

Última revisão: 2026-11-11.

## Interpretador de G-code (`shared/gcode.js`)

| Limitação | Efeito para o aluno | Caminho sugerido |
|---|---|---|
| **Sem ciclos** (CYCLE93/94/95/96/97/98, CYCLE81–83; G71/G70/G72/G75/G76/G92 Fanuc) | O bloco é ignorado com aviso; o desbaste precisa ser escrito passe a passe | Expandir cada ciclo em movimentos G0/G1 dentro do interpretador. Começar pelo CYCLE95 (ver PLANO, Etapa 1) |
| **Sem subprogramas, parâmetros `R`, `GOTOF`/`GOTOB`, `IF`, `REPEAT`** | Bloco ignorado com aviso | Necessário para os ciclos (contorno em subprograma). Implementar avaliador de expressões e pilha de chamadas |
| **G41/G42 ignorados** (sem compensação de raio da ponta) | Cones e raios saem com o perfil da ponta viva, sem o erro típico de quem esquece o G42 | Modelar raio de ponta na ferramenta e deslocar a trajetória (offset de contorno) |
| **G54–G57 sem deslocamento real** | O zero da peça é sempre a face; esquecer o G54 não causa erro | Coordenadas de máquina + tabela de origens; ver Etapa 0 do PLANO |
| **Sem corretores de ferramenta** (`D` é lido e ignorado) | Não dá para treinar preset nem correção de desgaste | Tabela de ferramentas com geometria/desgaste X/Z por posição |
| **Rosca G33 só reta** (sem cônica, sem múltiplas entradas, sem `SF=`) | Roscas simples funcionam; as demais não | Acrescentar parâmetros conforme o 802D sl |
| **Fanuc só o básico** (G0–G3, U/W, T0101, G28, G50 S, G96/G97, G98/G99) | Programas Fanuc com ciclos não rodam | Decisão do projeto: Fanuc é secundário (PLANO, decisão 4) |
| **Unidades só em mm** (G20/G70 polegada dão alarme) | — | Raro em curso técnico; baixa prioridade |
| Valores de máquina fixos: rápido 8000 mm/min, rotação máxima 4000 rpm, troca de ferramenta 1,5 s, sem aceleração | O tempo estimado é aproximado | Levar para uma configuração de máquina (perfil da LVK-175) |

## Simulação de remoção de material (`public/js/stock.js`)

| Limitação | Efeito | Caminho sugerido |
|---|---|---|
| **Rosca sem hélice** | A rosca aparece como um rebaixo até o fundo do filete | Desenhar a hélice só na malha (deslocamento de vértices por ângulo), sem mudar o modelo de remoção |
| **Um único raio interno por posição Z** | Canal interno "atrás" de um ressalto, ou um anel fino que sobra sob a pastilha, não é representado; até 1 mm sob a pastilha interna vira cavaco | Trocar o perfil por uma lista de intervalos [rᵢ, rₑ] por posição Z |
| **Ponta viva** (sem raio de ponta) | Cantos internos ficam vivos | Junto com G41/G42 |
| **Furação só em X0** | Broca fora do centro gera alarme (correto para torno sem ferramenta acionada) | — |
| **Peça é sólido de revolução** | Sem fresamento, eixo C ou ferramentas acionadas | Fora do escopo atual |
| Resolução do perfil: passo de 0,05 mm (até 2000 amostras) | Detalhes menores que isso somem | Aumentar amostras se for preciso (custo de desempenho) |
| A ponta avança em passos de ~0,035 mm | Em perfis muito inclinados (ex.: gola do exemplo 07) o diâmetro sai até ~0,1 mm maior | Passos menores nos trechos inclinados, ou calcular a interseção exata da aresta com cada amostra |

## Colisões (`public/js/main.js`, `stock.js`)

| Detectado | **Não** detectado |
|---|---|
| G0 dentro do material | Suporte/porta-ferramenta e torre batendo na peça ou na placa |
| Ferramenta na peça com fuso parado | Contraponto (não existe na cena) |
| Ponta na região das castanhas (aproximado) | Ferramentas vizinhas na torre batendo na peça |
| Corpo da barra interna no material | Avanço/profundidade de corte excessivos (quebra de ferramenta) |
| Broca fora do centro | |

## Cena 3D (`public/js/scene.js`)

- Vistas existentes: 3D, Lateral (2D em corte), Face, Meio corte e Peça pronta. Faltam, em relação ao
  SINUMERIK Operate: duas janelas lado a lado, espaço de máquina, registro simultâneo com a máquina,
  ampliação por região e medição na vista.
- A torre é um bloco que acompanha a ferramenta ativa; não gira na troca e não mostra as 8 ferramentas montadas.
- Ferramentas são silhuetas extrudadas (brocas e barras aparecem "achatadas").
- Contraponto, porta, refrigeração e luzes da máquina não existem.
- A rotação da placa é limitada visualmente (para não "piscar"), não é a rotação real.

## Desempenho

- **Sem aceleração gráfica** (WebGL por software: SwiftShader, llvmpipe, "Microsoft Basic Render Driver"),
  o 3D roda na CPU. O simulador detecta, avisa nas mensagens, mostra a etiqueta laranja
  "Software (CPU)" no canto da vista e entra em modo econômico (sem suavização de bordas, menos pixels,
  32 divisões na peça, no máximo ~24 quadros/s). Mesmo assim fica lento (~6 quadros/s usinando).
- Medido em 2026-11-11 (WebGL por software): parado ~3% de CPU (antes ~10%, redesenhava sempre);
  usinando, o envio da malha para a placa de vídeo deixou de existir no perfil (antes ~51% do tempo,
  ~10 MB por quadro; agora só o trecho alterado).
- A peça é desenhada com até ~2000 anéis × 72 divisões; peças muito longas pesam mais.

## Operação da máquina (ainda não existe)

- Modos JOG, MDA, manivela, referenciamento, overrides de avanço e rotação.
- Preset de ferramenta e de origem.
- Perfil de interface "Máquina" (emulação do 802D sl da LVK-175). Ver estudo de viabilidade no PLANO.

## Contas, turmas e servidor (`server/`)

| Limitação | Caminho sugerido |
|---|---|
| **Sem recuperação de senha** (o e-mail é coletado, mas nada é enviado) | Serviço de envio de e-mail no VPS + link com token de uso único |
| Limites de login e de cadastro ficam **em memória**: zeram ao reiniciar e não são compartilhados entre processos | Guardar no SQLite se houver mais de uma instância |
| Entregas sem nota, comentário ou correção; o professor só lê o código | Abrir a entrega direto no simulador; campo de nota/comentário |
| Sem configuração de implantação (HTTPS, proxy reverso, backup do banco) | Ver Etapa 0 do PLANO |
| Exclusão de conta pelo próprio usuário não existe | Rota de exclusão com confirmação de senha |

## Interface e idiomas

- Os comentários dentro dos programas de exemplo estão só em português.
- O editor não tem destaque de sintaxe nem checagem enquanto digita (só ao rodar).
- Exige navegador com WebGL.

## Testes

- A cena 3D é testada só de forma grosseira (o canvas desenha algo); a aparência não tem teste de
  regressão visual (comparação de imagens).
- Os testes de ponta a ponta usam WebGL por software e são lentos (~3 min); por isso rodam com 2 processos.
- A geometria é conferida em pontos escolhidos (cotas do desenho), não no perfil inteiro.
