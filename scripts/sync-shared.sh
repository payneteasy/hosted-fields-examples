#!/usr/bin/env bash
#
# Copies the shared browser half from shared/ into every app.
#
# The copies stay committed on purpose: each app directory has to work on its own, with no
# build step in front of it and nothing extra in the release archive. This script is what keeps
# them honest, and CI runs it and fails on `git diff --exit-code` — so forgetting to run it
# cannot reach main.
#
# Adding an app means adding its name to one of the two lists below, and nothing else.

set -euo pipefail
cd "$(dirname "$0")/.."

# The plain-JS frontend: stylesheet, scripts and views, all six files.
PLAIN_JS_APPS=(
  go-js
  nodejs-express-js
  php-js
  python-flask-js
  ruby-sinatra-js
  java-springboot-js
  kotlin-ktor-js
  rust-axum-js
  dotnet-aspnetcore-js
)

# React: the scripts and the views are components there, so only the stylesheet is shared.
# That one file is what keeps every example looking identical. go-react/web is the browser
# half of the Go + React example, which is a project of its own inside that app.
STYLESHEET_ONLY_APPS=(
  nextjs
  go-react/web
)

for app in "${PLAIN_JS_APPS[@]}"; do
  install -d "$app/public" "$app/views"
  cp shared/public/styles.css shared/public/status.js shared/public/checkout.js shared/public/result.js "$app/public/"
  cp shared/views/checkout.html shared/views/result.html "$app/views/"
  echo "$app: public/{styles.css,status.js,checkout.js,result.js} views/{checkout.html,result.html}"
done

for app in "${STYLESHEET_ONLY_APPS[@]}"; do
  install -d "$app/public"
  cp shared/public/styles.css "$app/public/styles.css"
  echo "$app: public/styles.css"
done
