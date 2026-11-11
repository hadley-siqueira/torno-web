#!/bin/sh
# Publica no VPS a última versão COMMITADA (git HEAD) do simulador.
# Mudanças não commitadas na pasta local NÃO vão para o VPS.
# O banco (data/) e o log do VPS são preservados. Detalhes em docs/DEPLOY.md.
#
# Uso: scripts/deploy.sh            (padrão: host meu-vps, porta 9000)
#      HOST=outro PORT=8080 scripts/deploy.sh
set -eu

HOST="${HOST:-meu-vps}"   # alias do ~/.ssh/config
PORT="${PORT:-9000}"
DIR=torno-cnc                  # pasta em ~ no VPS
SESSION=torno-cnc              # sessão tmux

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Aviso: há mudanças não commitadas; elas NÃO serão publicadas."
fi
echo "Publicando $(git log --oneline -1) em $HOST:~/$DIR (porta $PORT)"

ssh "$HOST" "rm -rf ~/$DIR.novo && mkdir ~/$DIR.novo"
git archive --format=tar HEAD | ssh "$HOST" "set -e
cd ~/$DIR.novo
tar -x
npm ci --omit=dev 2>&1 | tail -1
cat > iniciar.sh <<'EOF'
#!/bin/sh
cd \"\$(dirname \"\$0\")\"
export PORT=$PORT
exec node server.js 2>&1 | tee -a server.log
EOF
chmod +x iniciar.sh
[ -f ~/$DIR/server.log ] && cp ~/$DIR/server.log . || true
tmux kill-session -t $SESSION 2>/dev/null || true
sleep 1
[ -d ~/$DIR/data ] && mv ~/$DIR/data . || true
rm -rf ~/$DIR.antigo
[ -d ~/$DIR ] && mv ~/$DIR ~/$DIR.antigo || true
mv ~/$DIR.novo ~/$DIR
tmux new-session -d -s $SESSION ~/$DIR/iniciar.sh
sleep 2
code=\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT/)
echo \"Resposta local no VPS: \$code\"
[ \"\$code\" = 200 ]"

echo "Pronto. Versão anterior guardada em ~/$DIR.antigo no VPS."
