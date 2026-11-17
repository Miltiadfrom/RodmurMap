#!/bin/sh
set -e

DATA_DIR="${RODMUR_DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

# Первый запуск: кладём в том данных исходный мир, дальше он живёт своей жизнью.
if [ ! -f "$DATA_DIR/world.json" ]; then
  cp /app/seed/world.json "$DATA_DIR/world.json"
  echo "Атлас: в $DATA_DIR положен исходный мир"
fi

exec "$@"
