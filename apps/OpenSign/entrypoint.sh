#!/bin/sh

ENV_FILE=./build/env.js
DOTENV_FILE=./.env.prod # ✅ use .env.prod

echo "Generating runtime env file at $ENV_FILE..."

echo "window.RUNTIME_ENV = {" > $ENV_FILE

# List of keys to include. REACT_APP_OIDC_ENABLED and REACT_APP_APPID are
# required for the Sunbeam SSO login button to render at runtime.
RUNTIME_KEYS="REACT_APP_SERVERURL REACT_APP_OIDC_ENABLED REACT_APP_APPID"

for key in $RUNTIME_KEYS; do
  # First check docker env (-e), fallback to .env file
  value=$(printenv "$key")

  if [ -z "$value" ] && [ -f "$DOTENV_FILE" ]; then
    # fallback: read from .env
    value=$(grep "^$key=" "$DOTENV_FILE" | cut -d '=' -f2- | tr -d '\r\n' | sed 's/"/\\"/g')
  else
    value=$(echo "$value" | sed 's/"/\\"/g')
  fi

  echo "  $key: \"$value\"," >> $ENV_FILE
done

echo "};" >> $ENV_FILE

exec "$@"
