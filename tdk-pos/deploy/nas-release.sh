#!/bin/sh
# Sent over SSH only after local release scope and explicit approval checks.
set -eu
umask 077

mode=${1:-}
release_sha=${2:-}
base_sha=${3:-}
device_agent_url=${4:-}
repo=/volume1/TDK-POS
app_dir=$repo/tdk-pos
backup_root=/volume1/tdk-pos-release-backups
backup_dir=$backup_root/$release_sha
baseline_file=$backup_root/approved-baseline
build_dir=

valid_sha() {
  case "$1" in
    *[!0-9a-f]*|'') return 1 ;;
  esac
  [ "${#1}" -eq 40 ]
}

valid_image_id() {
  case "$1" in sha256:*) image_hex=${1#sha256:} ;; *) return 1 ;; esac
  case "$image_hex" in *[!0-9a-f]*|'') return 1 ;; esac
  [ "${#image_hex}" -eq 64 ]
}

resolve_revision() {
  image_id=$1
  checkout_sha=$2
  revision=$(sudo -n docker image inspect "$image_id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null) || fail 'running image inspect failed'
  revision_source=IMAGE_LABEL
  evidence_sha=NONE
  if valid_sha "$revision"; then return 0; fi
  revision=UNKNOWN
  revision_source=UNVERIFIED
  [ -f "$baseline_file" ] && [ ! -L "$baseline_file" ] || return 0
  recorded_image=$(sudo -n sed -n 's/^IMAGE_ID=//p' "$baseline_file" | head -n 1)
  recorded_sha=$(sudo -n sed -n 's/^SOURCE_SHA=//p' "$baseline_file" | head -n 1)
  recorded_evidence=$(sudo -n sed -n 's/^EVIDENCE_SHA256=//p' "$baseline_file" | head -n 1)
  if [ "$recorded_image" = "$image_id" ] && [ "$recorded_sha" = "$checkout_sha" ] && valid_sha "$recorded_sha"; then
    case "$recorded_evidence" in *[!0-9a-f]*|'') return 0 ;; esac
    [ "${#recorded_evidence}" -eq 64 ] || return 0
    revision=$recorded_sha
    revision_source=APPROVED_BASELINE
    evidence_sha=$recorded_evidence
  fi
}

cleanup() {
  if [ -n "$build_dir" ]; then
    case "$build_dir" in
      /tmp/tdk-pos-release.*) rm -rf "$build_dir" ;;
    esac
  fi
}
trap cleanup 0 HUP INT TERM

fail() { printf 'RELEASE FAILED: %s\n' "$*" >&2; exit 1; }

# The one-click SSH path has a terminal and asks sudo to validate its timestamp
# before each privileged command. Other entry points remain non-interactive.
sudo() {
  if [ "${TDK_INTERACTIVE_SUDO:-0}" = 1 ] && [ "${1:-}" = -n ]; then
    command sudo -p 'NAS sudo password (input hidden):
' -v || return
  fi
  command sudo "$@"
}

require_git() {
  # Non-interactive SSH sessions may omit application directories from PATH.
  if ! command -v git >/dev/null 2>&1; then
    for git_dir in /usr/local/bin /opt/bin /usr/bin /bin /volume1/.@plugins/AppCentral/git/bin /volume1/.@plugins/AppCentral/git/data/bin; do
      if [ -x "$git_dir/git" ]; then
        PATH="$git_dir:$PATH"
        export PATH
        break
      fi
    done
  fi
  command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1 ||
    fail 'Git CLI is unavailable in the NAS non-interactive SSH shell. Check its installation and executable path; no deployment was started.'
}

require_main_branch() {
  require_git
  branch=$(git branch --show-current) || fail 'NAS Git branch lookup failed'
  [ "$branch" = main ] || fail "NAS repository is not on main (branch: ${branch:-detached})"
}

require_docker_sudo() {
  docker_preflight=$(sudo -n docker version --format '{{.Server.Version}}' 2>&1) ||
    fail "Docker preflight failed (sudo -n docker version): $docker_preflight"
}

# Separate, explicit baseline registration for a legacy image without a Git label.
# The operator must first verify historical deployment evidence and approve its hash.
if [ "$mode" = register-baseline ]; then
  valid_sha "$release_sha" || fail 'verified baseline SHA must be 40 lowercase hex characters'
  valid_image_id "$base_sha" || fail 'expected running image ID is invalid'
  case "$device_agent_url" in *[!0-9a-f]*|'') fail 'evidence SHA-256 must be 64 lowercase hex characters' ;; esac
  [ "${#device_agent_url}" -eq 64 ] || fail 'evidence SHA-256 must be 64 lowercase hex characters'
  cd "$repo" || fail 'NAS repository missing'
  require_git
  [ "$(git rev-parse HEAD)" = "$release_sha" ] || fail 'NAS checkout does not match the verified baseline SHA'
  cd "$app_dir" || fail 'NAS application directory missing'
  container=$(sudo -n docker compose ps -q tdk-pos) || fail 'Docker access unavailable'
  [ -n "$container" ] || fail 'running TDKON container not found'
  actual_image=$(sudo -n docker inspect --format '{{.Image}}' "$container")
  [ "$actual_image" = "$base_sha" ] || fail 'running image ID changed since evidence review'
  health=$(sudo -n docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container")
  [ "$health" = healthy ] || fail 'running container is not healthy'
  running_db=$(sudo -n docker exec "$container" sh -c 'printf %s "${DB_NAME-}"')
  [ "$running_db" = TDK_POS ] || fail 'running container does not use TDK_POS'
  existing_label=$(sudo -n docker image inspect "$actual_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
  if valid_sha "$existing_label"; then fail 'running image already has a Git revision label'; fi
  [ ! -L "$backup_root" ] && [ ! -L "$baseline_file" ] || fail 'baseline path is a symbolic link'
  [ ! -e "$baseline_file" ] || fail 'baseline record already exists; review it before any replacement'
  sudo -n install -d -m 700 "$backup_root" || fail 'baseline directory creation failed'
  printf 'IMAGE_ID=%s\nSOURCE_SHA=%s\nEVIDENCE_SHA256=%s\n' "$actual_image" "$release_sha" "$device_agent_url" | sudo -n tee "$baseline_file" >/dev/null
  sudo -n chmod 600 "$baseline_file"
  printf 'APPROVED BASELINE REGISTERED: image=%s source=%s evidence_sha256=%s\n' "$actual_image" "$release_sha" "$device_agent_url"
  exit 0
fi

# Inspect never writes to the NAS and never prints environment secrets.
if [ "$mode" = inspect ]; then
  cd "$repo" || fail 'NAS repository missing'
  require_main_branch
  source_sha=$(git rev-parse HEAD) || fail 'NAS Git HEAD unavailable'
  valid_sha "$source_sha" || fail 'NAS Git HEAD is not a full SHA'
  require_docker_sudo
  cd "$app_dir" || fail 'NAS application directory missing'
  sudo -n docker compose config --quiet || fail 'Docker Compose configuration is invalid or Docker permission is missing'
  container=$(sudo -n docker compose ps -q tdk-pos) || fail 'Docker Compose lookup failed'
  [ -n "$container" ] || fail 'running TDKON container not found'
  old_id=$(sudo -n docker inspect --format '{{.Image}}' "$container") || fail 'container inspect failed'
  case "$old_id" in sha256:*) ;; *) fail 'running image ID has an unexpected format' ;; esac
  resolve_revision "$old_id" "$source_sha"
  agent_url=$(sudo -n docker image inspect "$old_id" --format '{{index .Config.Labels "com.tdkon.device-agent-url"}}' 2>/dev/null) || fail 'Device Agent image label lookup failed'
  case "$agent_url" in http://127.0.0.1:*) ;; *) agent_url=UNKNOWN ;; esac
  state=$(sudo -n docker inspect --format '{{.State.Status}}' "$container")
  health=$(sudo -n docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container")
  running_db=$(sudo -n docker exec "$container" sh -c 'printf %s "${DB_NAME-}"') || fail 'running DB identity unavailable'
  [ "$running_db" = TDK_POS ] || fail 'running container does not use TDK_POS'
  running_config_hash=$(sudo -n docker inspect --format '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$container")
  configured_hash=$(sudo -n docker compose config --hash tdk-pos | awk 'NF {print $NF}') || fail 'Compose configuration hash unavailable'
  [ -n "$running_config_hash" ] && [ "$running_config_hash" = "$configured_hash" ] || fail 'Compose files or environment differ from the running container'
  free_kb=$(df -Pk /volume1 | awk 'NR==2 {print $4}')
  case "$free_kb" in *[!0-9]*|'') fail 'NAS free space unavailable' ;; esac
  printf 'SOURCE_SHA=%s\nIMAGE_REVISION=%s\nREVISION_SOURCE=%s\nBASELINE_EVIDENCE_SHA256=%s\nDEVICE_AGENT_URL=%s\nIMAGE_ID=%s\nCONTAINER_ID=%s\nCONTAINER_STATE=%s\nHEALTH=%s\nFREE_KB=%s\n' \
    "$source_sha" "$revision" "$revision_source" "$evidence_sha" "$agent_url" "$old_id" "$container" "$state" "$health" "$free_kb"
  exit 0
fi

valid_sha "$release_sha" || fail 'release SHA must be 40 lowercase hex characters'

restore_image() {
  [ ! -L "$backup_dir" ] || fail 'backup directory must not be a symbolic link'
  [ -f "$backup_dir/old-image-id" ] || fail 'previous image ID backup missing'
  [ -f "$backup_dir/old-image.tar" ] || fail 'previous image archive missing'
  [ -f "$backup_dir/old-image.tar.sha256" ] || fail 'previous image checksum missing'
  (cd "$backup_dir" && sudo -n sha256sum -c old-image.tar.sha256) || fail 'previous image archive checksum failed'
  old_id=$(sudo -n cat "$backup_dir/old-image-id")
  case "$old_id" in sha256:*) ;; *) fail 'previous image ID has an unexpected format' ;; esac
  if ! sudo -n docker image inspect "$old_id" >/dev/null 2>&1; then
    sudo -n docker load -i "$backup_dir/old-image.tar" || fail 'previous image could not be loaded'
  fi
  sudo -n docker image tag "$old_id" tdk-pos:1.0.0 || fail 'previous image tag restore failed'
  sudo -n cp -p "$backup_dir/docker-compose.yml" "$app_dir/docker-compose.yml" || fail 'Compose restore failed'
  sudo -n cp -p "$backup_dir/.env.production" "$app_dir/.env.production" || fail 'environment restore failed'
  cd "$app_dir"
  sudo -n docker compose config --quiet || fail 'restored Compose configuration is invalid'
  sudo -n docker compose up -d --no-deps --no-build --force-recreate tdk-pos || fail 'previous container restart failed'
  restored_container=$(sudo -n docker compose ps -q tdk-pos)
  [ -n "$restored_container" ] || fail 'previous container not found after rollback'
  restored_id=$(sudo -n docker inspect --format '{{.Image}}' "$restored_container")
  [ "$restored_id" = "$old_id" ] || fail 'rollback image ID mismatch'
  rollback_attempt=0
  while [ "$rollback_attempt" -lt 30 ]; do
    rollback_health=$(sudo -n docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$restored_container")
    [ "$rollback_health" != healthy ] || break
    [ "$rollback_health" != unhealthy ] || fail 'restored container is unhealthy'
    rollback_attempt=$((rollback_attempt + 1))
    sleep 5
  done
  [ "$rollback_health" = healthy ] || fail 'restored container did not become healthy'
  printf 'ROLLBACK IMAGE RESTORED: %s\n' "$old_id"
  printf 'Review app health and logs; database and mounted data were not restored or deleted.\n'
}

if [ "$mode" = rollback ]; then
  require_docker_sudo
  restore_image
  exit 0
fi
[ "$mode" = deploy ] || [ "$mode" = prepare ] || fail 'mode must be inspect, prepare, deploy, or rollback'
valid_sha "$base_sha" || fail 'NAS base SHA must be 40 lowercase hex characters'
if [ "$mode" = deploy ]; then
  case "$device_agent_url" in
    http://127.0.0.1:*) device_agent_port=${device_agent_url##*:} ;;
    *) fail 'an explicitly approved local Device Agent URL is required' ;;
  esac
  case "$device_agent_port" in *[!0-9]*|'') fail 'Device Agent port must be numeric' ;; esac
fi

cd "$repo" || fail 'NAS repository missing'
require_main_branch
[ "$(git rev-parse HEAD)" = "$base_sha" ] || fail 'NAS checkout differs from approved base SHA'
git diff --quiet -- tdk-pos/docker-compose.yml || fail 'NAS Compose file has local edits'
git diff --cached --quiet -- tdk-pos/docker-compose.yml || fail 'NAS Compose file has staged edits'
[ -f "$app_dir/.env.production" ] || fail 'production environment file missing'
tr -d '\r' < "$app_dir/.env.production" | grep -Eq '^DB_NAME=TDK_POS$' || fail 'production DB identity setting missing'
require_docker_sudo
cd "$app_dir" || fail 'NAS application directory missing'
container=$(sudo -n docker compose ps -q tdk-pos)
[ -n "$container" ] || fail 'running app container not found'
old_id=$(sudo -n docker inspect --format '{{.Image}}' "$container")
case "$old_id" in sha256:*) ;; *) fail 'running image ID has an unexpected format' ;; esac
resolve_revision "$old_id" "$base_sha"
[ "$revision" = "$base_sha" ] || fail 'running image revision does not match approved NAS base SHA'
old_container_created=$(sudo -n docker inspect --format '{{.Created}}' "$container")
old_image_created=$(sudo -n docker image inspect "$old_id" --format '{{.Created}}')
running_db=$(sudo -n docker exec "$container" sh -c 'printf %s "${DB_NAME-}"')
[ "$running_db" = TDK_POS ] || fail 'running container does not use TDK_POS'
running_config_hash=$(sudo -n docker inspect --format '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$container")
configured_hash=$(sudo -n docker compose config --hash tdk-pos | awk 'NF {print $NF}') || fail 'Compose configuration hash unavailable'
[ -n "$running_config_hash" ] && [ "$running_config_hash" = "$configured_hash" ] || fail 'Compose files or environment differ from the running container'
[ ! -L "$backup_root" ] && [ ! -L "$backup_dir" ] || fail 'backup path must not be a symbolic link'
free_kb=$(df -Pk /volume1 | awk 'NR==2 {print $4}')
case "$free_kb" in *[!0-9]*|'') fail 'NAS free space unavailable' ;; esac
image_bytes=$(sudo -n docker image inspect "$old_id" --format '{{.Size}}')
case "$image_bytes" in *[!0-9]*|'') fail 'running image size unavailable' ;; esac
required_kb=$((image_bytes / 1024 * 2 + 4194304))
[ "$free_kb" -gt "$required_kb" ] || fail 'insufficient NAS space for image backup and candidate build'

# Archive the immutable running image and the exact settings used to recreate it.
if [ -e "$backup_dir" ]; then
  [ "$(sudo -n cat "$backup_dir/old-image-id" 2>/dev/null)" = "$old_id" ] || fail 'existing backup belongs to a different running image'
  [ "$(sudo -n cat "$backup_dir/old-source-sha" 2>/dev/null)" = "$base_sha" ] || fail 'existing backup belongs to a different source SHA'
  [ -f "$backup_dir/docker-compose.yml" ] && [ -f "$backup_dir/.env.production" ] && [ -f "$backup_dir/old-container-inspect.json" ] || fail 'existing backup is incomplete'
  (cd "$backup_dir" && sudo -n sha256sum -c old-image.tar.sha256) || fail 'existing image checksum failed'
  sudo -n tar -tf "$backup_dir/old-image.tar" >/dev/null || fail 'existing image archive cannot be read'
else
  sudo -n install -d -m 700 "$backup_root" "$backup_dir" || fail 'backup directory creation failed'
  sudo -n cp -p "$app_dir/docker-compose.yml" "$backup_dir/docker-compose.yml" || fail 'Compose backup failed'
  sudo -n cp -p "$app_dir/.env.production" "$backup_dir/.env.production" || fail 'environment backup failed'
  sudo -n docker inspect "$container" | sudo -n tee "$backup_dir/old-container-inspect.json" >/dev/null || fail 'container settings backup failed'
  sudo -n test -s "$backup_dir/old-container-inspect.json" || fail 'container settings backup is empty'
  sudo -n chmod 600 "$backup_dir/docker-compose.yml" "$backup_dir/.env.production" "$backup_dir/old-container-inspect.json"
  printf '%s\n' "$old_id" | sudo -n tee "$backup_dir/old-image-id" >/dev/null
  printf '%s\n' "$container" | sudo -n tee "$backup_dir/old-container-id" >/dev/null
  printf '%s\n' "$base_sha" | sudo -n tee "$backup_dir/old-source-sha" >/dev/null
  sudo -n docker save -o "$backup_dir/old-image.tar" "$old_id" || fail 'running image archive failed'
  (cd "$backup_dir" && sudo -n sha256sum old-image.tar | sudo -n tee old-image.tar.sha256 >/dev/null)
  (cd "$backup_dir" && sudo -n sha256sum -c old-image.tar.sha256) || fail 'image checksum verification failed'
  sudo -n tar -tf "$backup_dir/old-image.tar" >/dev/null || fail 'image archive cannot be read'
fi
old_backup_tag=tdk-pos:backup-$release_sha
if sudo -n docker image inspect "$old_backup_tag" >/dev/null 2>&1; then
  tagged_id=$(sudo -n docker image inspect "$old_backup_tag" --format '{{.Id}}')
  [ "$tagged_id" = "$old_id" ] || fail 'previous-image backup tag belongs to another image'
else
  sudo -n docker image tag "$old_id" "$old_backup_tag" || fail 'previous-image backup tag failed'
fi
printf 'BACKUP READY: old image %s created=%s, container=%s created=%s, archive=%s\n' \
  "$old_id" "$old_image_created" "$container" "$old_container_created" "$backup_dir/old-image.tar"
if [ "$mode" = prepare ]; then
  printf 'ROLLBACK PREPARED: archive checksum and tar listing verified; container restore has not been exercised.\n'
  exit 0
fi

# Use only committed files for the Docker build, regardless of NAS worktree dirt.
cd "$repo"
git fetch origin main || fail 'NAS fetch failed; previous container remains in place'
[ "$(git rev-parse FETCH_HEAD)" = "$release_sha" ] || fail 'remote main differs from approved release SHA'
git merge-base --is-ancestor "$base_sha" "$release_sha" || fail 'release is not a fast-forward from NAS base'
git pull --ff-only origin main || fail 'NAS source update failed; previous container remains in place'
[ "$(git rev-parse HEAD)" = "$release_sha" ] || fail 'NAS source SHA mismatch after pull'
build_dir=$(mktemp -d /tmp/tdk-pos-release.XXXXXX) || fail 'temporary build directory unavailable'
git archive "$release_sha" tdk-pos | tar -x -C "$build_dir" || fail 'committed source archive failed'
[ -f "$build_dir/tdk-pos/Dockerfile" ] || fail 'Dockerfile missing from approved archive'
candidate=tdk-pos:candidate-$release_sha
sudo -n docker build --label "org.opencontainers.image.revision=$release_sha" \
  --label "com.tdkon.device-agent-url=$device_agent_url" \
  --build-arg "NEXT_PUBLIC_DEVICE_AGENT_URL=$device_agent_url" -t "$candidate" "$build_dir/tdk-pos" \
  || fail 'candidate image build failed; previous container remains in place'
new_id=$(sudo -n docker image inspect "$candidate" --format '{{.Id}}')
[ "$new_id" != "$old_id" ] || fail 'candidate image unexpectedly matches previous image'
revision=$(sudo -n docker image inspect "$candidate" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[ "$revision" = "$release_sha" ] || fail 'candidate revision label mismatch'
sudo -n docker image tag "$candidate" tdk-pos:1.0.0 || fail 'candidate production tag failed'
cd "$app_dir"
started_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
if ! sudo -n docker compose up -d --no-deps --no-build --force-recreate tdk-pos; then
  printf 'New container start failed; restoring prior image.\n' >&2
  restore_image
  exit 1
fi

attempt=0
while [ "$attempt" -lt 30 ]; do
  current=$(sudo -n docker compose ps -q tdk-pos)
  if [ -n "$current" ]; then
    current_id=$(sudo -n docker inspect --format '{{.Image}}' "$current")
    health=$(sudo -n docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$current")
    if [ "$current_id" = "$new_id" ] && [ "$health" = healthy ]; then
      if ! sudo -n docker exec "$current" node -e 'const paths=["/pos","/hos","/qr"]; Promise.all(paths.map(async path=>{const r=await fetch("http://127.0.0.1:3000"+path,{redirect:"manual",signal:AbortSignal.timeout(10000)}); console.log(path+" "+r.status); if(r.status<200||r.status>=400) throw Error(path+" returned "+r.status)})).catch(e=>{console.error(e.message);process.exit(1)})'; then
        printf 'Local POS/HOS/QRS route check failed; restoring prior image.\n' >&2
        restore_image
        exit 1
      fi
      if ! recent_logs=$(sudo -n docker logs --since "$started_at" "$current" 2>&1); then
        printf 'New container logs could not be inspected; restoring prior image.\n' >&2
        restore_image
        exit 1
      fi
      if printf '%s\n' "$recent_logs" | grep -Eq 'TypeError: immutable|Unknown column|ER_BAD_FIELD_ERROR'; then
        printf 'New container emitted a known critical error; restoring prior image.\n' >&2
        restore_image
        exit 1
      fi
      printf 'RELEASE CONTAINER HEALTHY: image=%s revision=%s backup=%s\n' "$new_id" "$release_sha" "$backup_dir"
      printf 'Local POS/HOS/QRS GET checks passed; authenticated business flows still require manual review.\n'
      exit 0
    fi
    [ "$health" != unhealthy ] || break
  fi
  attempt=$((attempt + 1))
  sleep 5
done
printf 'New container did not become healthy with the expected image; restoring prior image.\n' >&2
restore_image
exit 1
