#!/usr/bin/env sh
# macOS / Linux başlatıcı: uygulamayı açar (ilk seferde bağımlılıkları kurar)
cd "$(dirname "$0")/uygulama-electron" || exit 1
[ -d node_modules ] || npm install
npm start
