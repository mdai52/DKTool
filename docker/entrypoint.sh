#!/bin/sh
set -eu

mkdir -p /app/runtime-data

if [ ! -f "$DKTOOL_DB_PATH" ]; then
  cp /app/seed/dktool.seed.db "$DKTOOL_DB_PATH"
fi

exec /app/server
