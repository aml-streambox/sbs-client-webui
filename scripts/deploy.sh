#!/bin/bash
set -euo pipefail

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$ROOT_DIR/.env"
    set +a
fi

TARGET="${TARGET:-}"
if [ -z "$TARGET" ]; then
    echo "Set TARGET in the environment or .env (for example: TARGET=root@device-hostname.local)." >&2
    exit 1
fi

REMOTE_WEBUI_DIR="${REMOTE_WEBUI_DIR:-/var/www/sbs-webui}"
if [[ "$REMOTE_WEBUI_DIR" != /* || "$REMOTE_WEBUI_DIR" == "/" || "$REMOTE_WEBUI_DIR" == "." || "$REMOTE_WEBUI_DIR" =~ [^A-Za-z0-9_./-] ]]; then
    echo "Refusing to deploy to unsafe REMOTE_WEBUI_DIR: '$REMOTE_WEBUI_DIR'" >&2
    exit 1
fi

msg() { printf "\033[1;34m[SBS-WEBUI-DEPLOY]\033[0m %s\n" "$*"; }

msg "Building WebUI..."
npm --prefix "$ROOT_DIR" run build

msg "Deploying WebUI to ${TARGET}:${REMOTE_WEBUI_DIR}..."
# REMOTE_WEBUI_DIR is restricted above so this remote shell cleanup cannot
# interpret quotes, spaces, or shell metacharacters as part of the command.
ssh "$TARGET" "mkdir -p '${REMOTE_WEBUI_DIR}' && rm -rf '${REMOTE_WEBUI_DIR}'/* '${REMOTE_WEBUI_DIR}'/.[!.]* '${REMOTE_WEBUI_DIR}'/..?*"
shopt -s nullglob dotglob
dist_files=("$ROOT_DIR"/dist/*)
if [ ${#dist_files[@]} -eq 0 ]; then
    echo "No files found in $ROOT_DIR/dist; build did not produce deployable assets." >&2
    exit 1
fi
scp -r "${dist_files[@]}" "$TARGET:${REMOTE_WEBUI_DIR}/"

msg "Deploy complete."
