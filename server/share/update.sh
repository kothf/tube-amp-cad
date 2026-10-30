#!/usr/bin/env bash
# Brings the store in ~/tubecad-share up to date from GitHub (main): the short links and, since
# 3.143.0, the owner's projects and revisions under /api/rev/. Adds the /api/rev/ block to the
# site's nginx once (with a backup), rebuilds the container and checks both ends. Safe to run again.
#   curl -fsSL https://raw.githubusercontent.com/kothf/tube-amp-cad/main/server/share/update.sh | bash
set -euo pipefail
SRC=${SRC:-https://raw.githubusercontent.com/kothf/tube-amp-cad/main/server/share}
DIR=${DIR:-$HOME/tubecad-share}
NGINX_CONF=${NGINX_CONF:-$HOME/aerocat/nginx.conf}
NGINX=${NGINX:-aerocat_static_web}

mkdir -p "$DIR" && cd "$DIR"
for f in server.mjs access.mjs revisions.mjs Dockerfile docker-compose.yml nginx.conf; do
  curl -fsSL "$SRC/$f" -o "$f.new" && mv "$f.new" "$f"
done
# the container runs as uid 1000; projects and revisions live in ./revisions, never deleted by the store
mkdir -p data revisions
if [ "$(stat -c %u revisions)" != 1000 ]; then sudo chown 1000:1000 revisions; fi

if ! grep -q 'location /api/rev/' "$NGINX_CONF"; then
  cp "$NGINX_CONF" "$NGINX_CONF.bak-$(date +%Y%m%d-%H%M%S)"
  # the block from nginx.conf, put in front of the /api/share location
  block=$(sed -n '/^location \/api\/rev\/ {/,/^}/p' nginx.conf | sed 's/^/        /')
  B="$block" awk '!done && /location = \/api\/share \{/ { print ENVIRON["B"]; print ""; done=1 } { print }' "$NGINX_CONF" > "$NGINX_CONF.new"
  grep -q 'location /api/rev/' "$NGINX_CONF.new" || { echo "could not find 'location = /api/share {' in $NGINX_CONF: add nginx.conf's /api/rev/ block by hand"; rm -f "$NGINX_CONF.new"; exit 1; }
  cat "$NGINX_CONF.new" > "$NGINX_CONF" && rm -f "$NGINX_CONF.new"   # same file (inode), so the container's bind mount sees it
  echo "added /api/rev/ to $NGINX_CONF"
fi

docker compose up -d --build
docker exec "$NGINX" nginx -t && docker exec "$NGINX" nginx -s reload
sleep 2
echo "links:     $(curl -fsS https://aerocat.tech/api/share/health)"
# without the Access login in front, the store itself refuses (401); with it, Cloudflare asks to sign in (302)
echo "revisions: HTTP $(curl -s -o /dev/null -w '%{http_code}' https://aerocat.tech/api/rev/me) (302 = Cloudflare login in front, good; 401 = the store refuses, add the Access path)"
