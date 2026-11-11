# Deploy no VPS

Atualmente o simulador roda em **http://<IP-do-VPS>:9000** (HTTP, sem domínio), em modo de demonstração.

## Como publicar

```bash
scripts/deploy.sh
```

Publica a **última versão commitada** (`git HEAD`), via `git archive`. Mudanças não commitadas na
pasta local não vão para o VPS. Assim dá para publicar enquanto alguém edita o código. Para usar
outro host ou porta: `HOST=outro PORT=8080 scripts/deploy.sh`.

O servidor real fica num arquivo local **`.deploy.env`** na raiz do projeto, que não vai para o git:

```sh
HOST=meu-vps   # alias do ~/.ssh/config (lá ficam IP, porta SSH e usuário)
PORT=9000
```

## Onde fica no VPS

| Item | Valor |
|---|---|
| Acesso SSH | alias `meu-vps` no `~/.ssh/config` (IP, porta e usuário ficam só na configuração local, fora do repositório) |
| Pasta | `~/torno-cnc` |
| Processo | sessão tmux `torno-cnc`, executando `~/torno-cnc/iniciar.sh` (`PORT=9000 node server.js`) |
| Log | `~/torno-cnc/server.log` |
| Banco | `~/torno-cnc/data/cnc.db`. O deploy o move para a versão nova, então contas e programas são mantidos |
| Versão anterior | `~/torno-cnc.antigo` (só a última; para voltar, troque as pastas e reinicie o tmux) |

## Comandos úteis

```bash
ssh meu-vps 'tail -f ~/torno-cnc/server.log'                         # ver log
ssh meu-vps 'tmux kill-session -t torno-cnc'                          # parar
ssh meu-vps 'tmux new-session -d -s torno-cnc ~/torno-cnc/iniciar.sh' # iniciar
```

## Limitações atuais

- **Não volta sozinho após reiniciar o VPS** (não há entrada `@reboot` no crontab). Depois de um
  reboot, use o comando "iniciar" acima.
- **Sem HTTPS.** Por isso o servidor roda **sem** `NODE_ENV=production`: nesse modo o cookie de
  sessão exige HTTPS e o login não funcionaria. A implantação definitiva (proxy reverso com HTTPS,
  `NODE_ENV=production`, `TRUST_PROXY`, backup do banco) continua pendente em `docs/PLANO.md`.
- Sem backup automático do banco.
