#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — edit it to point VITE_API_URL at your ml-monitor-service instance."
fi

npm install
npm run dev
