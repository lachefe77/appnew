#!/usr/bin/env bash
# Rollback 1-click: restaura o SQLite para o snapshot do último deploy
set -e
cd "$(dirname "$0")/.."

LAST=$(cat backups/last-deploy.txt 2>/dev/null || echo "")
if [ -z "$LAST" ] || [ ! -f "backups/data-$LAST.sqlite" ]; then
  echo "Nenhum snapshot de deploy encontrado."
  exit 1
fi

docker-compose stop app
cp data.sqlite "backups/data-pre-rollback-$(date +%Y%m%d-%H%M%S).sqlite"
cp "backups/data-$LAST.sqlite" data.sqlite
docker-compose up -d app
echo "✅ Rollback para $LAST concluído."
