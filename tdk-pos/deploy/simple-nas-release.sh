#!/bin/sh
# Default deployment: update committed source, rebuild, replace the app.
set -eu

release_sha=${1:-}
agent_url=${2:--}
repo=/volume1/TDK-POS
app_dir=$repo/tdk-pos

fail() { printf 'DEPLOYMENT FAILED: %s\n' "$*" >&2; exit 1; }
case "$release_sha" in *[!0-9a-f]*|'') fail 'invalid release SHA' ;; esac
[ "${#release_sha}" -eq 40 ] || fail 'invalid release SHA'
if [ "$agent_url" != - ]; then
  case "$agent_url" in http://127.0.0.1:*) ;;
    *) fail 'Device Agent URL must use local 127.0.0.1' ;;
  esac
  agent_port=${agent_url##*:}
  case "$agent_port" in *[!0-9]*|'') fail 'Device Agent port must be numeric' ;; esac
fi

# SSH supplies a terminal. Renew sudo after a long Docker build if necessary.
sudo() {
  command sudo -p 'NAS sudo password (input hidden):
' -v || return
  command sudo -n "$@"
}

PATH=/opt/bin:/opt/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH
export PATH
cd "$repo" || fail 'NAS repository missing'
[ "$(git branch --show-current)" = main ] || fail 'NAS repository is not on main'
git fetch origin main || fail 'NAS fetch failed'
[ "$(git rev-parse FETCH_HEAD)" = "$release_sha" ] || fail 'origin/main changed since local release verification'
git pull --ff-only origin main || fail 'NAS fast-forward pull failed'
[ "$(git rev-parse HEAD)" = "$release_sha" ] || fail 'NAS checkout does not match release SHA'
dirty_source=$(git status --porcelain=v1 --untracked-files=all -- tdk-pos ':(exclude)tdk-pos/public/uploads/menu' ':(exclude)tdk-pos/storage' ':(exclude)tdk-pos/.local-dev-https') || fail 'NAS source status failed'
[ -z "$dirty_source" ] || fail 'NAS app source has local edits; review them before building'

cd "$app_dir" || fail 'NAS application directory missing'
[ -f .env.production ] || fail 'production environment file missing'
tr -d '\r' < .env.production | grep -Eq '^DB_NAME=TDK_POS$' || fail 'production DB identity setting missing'
sudo docker compose config --quiet || fail 'Docker Compose configuration is invalid'
if [ "$agent_url" = - ]; then
  printf 'Building with the Dockerfile Device Agent default.\n'
  sudo docker compose build tdk-pos || fail 'Docker image build failed; existing container was not replaced'
else
  printf 'Building with Device Agent URL %s\n' "$agent_url"
  sudo docker compose build --build-arg "NEXT_PUBLIC_DEVICE_AGENT_URL=$agent_url" tdk-pos || fail 'Docker image build failed; existing container was not replaced'
fi
sudo docker compose up -d --no-deps --no-build --force-recreate tdk-pos || fail 'container replacement failed; inspect NAS and rebuild after fixing the error'

container=$(sudo docker compose ps -q tdk-pos) || fail 'container lookup failed'
[ -n "$container" ] || fail 'new container not found'
attempt=0
while [ "$attempt" -lt 18 ]; do
  health=$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container") || fail 'container health lookup failed'
  [ "$health" != healthy ] || break
  [ "$health" != unhealthy ] || fail 'new container is unhealthy; inspect logs and rebuild after fixing the error'
  attempt=$((attempt + 1))
  sleep 5
done
[ "$health" = healthy ] || fail 'new container did not become healthy; inspect logs and rebuild after fixing the error'
printf 'DEPLOYMENT COMPLETE: release=%s container=%s health=%s\n' "$release_sha" "$container" "$health"
