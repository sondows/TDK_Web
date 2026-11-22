#!/bin/sh
# Isolated contract test: copies the NAS helper into a temporary fake NAS.
set -eu
PATH=/usr/bin:/bin:$PATH

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sandbox=$(mktemp -d /tmp/tdk-release-test.XXXXXX)
case "$(realpath "$sandbox")" in /tmp/tdk-release-test.*) ;; *) echo 'unsafe test directory' >&2; exit 1 ;; esac
trap 'rm -rf "$sandbox"' 0 HUP INT TERM
mkdir -p "$sandbox/bin" "$sandbox/repo/tdk-pos" "$sandbox/state"
export TDK_TEST_REPO="$sandbox/repo" TDK_TEST_STATE="$sandbox/state"
export TDK_TEST_BASE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export PATH="$sandbox/bin:$PATH"
printf '%s\n' 'services: {}' > "$sandbox/repo/tdk-pos/docker-compose.yml"
printf '%s\n' 'DB_NAME=TDK_POS' > "$sandbox/repo/tdk-pos/.env.production"
sed -e "s#^repo=/volume1/TDK-POS\$#repo=$sandbox/repo#" \
  -e "s#^backup_root=/volume1/tdk-pos-release-backups\$#backup_root=$sandbox/backups#" \
  "$here/nas-release.sh" > "$sandbox/helper.sh"

cat > "$sandbox/bin/sudo" <<'EOF'
#!/bin/sh
[ "$1" = -n ] && shift
if [ "${TDK_TEST_SUDO_DENY:-0}" = 1 ]; then echo 'sudo: a password is required' >&2; exit 1; fi
if [ "$1" = install ]; then shift 4; mkdir -p "$@"; exit 0; fi
if [ "$1" = chmod ]; then exit 0; fi
exec "$@"
EOF
cat > "$sandbox/bin/git" <<'EOF'
#!/bin/sh
case "$1 $2" in
  'branch --show-current') echo main ;;
  'rev-parse HEAD') echo "$TDK_TEST_BASE_SHA" ;;
  'diff --quiet'|'diff --cached') exit 0 ;;
  *) echo "unexpected fake git call: $*" >&2; exit 1 ;;
esac
EOF
cat > "$sandbox/bin/df" <<'EOF'
#!/bin/sh
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf '/fake 100000000 100 99999900 1%% /volume1\n'
EOF
cat > "$sandbox/bin/docker" <<'EOF'
#!/bin/sh
old=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
case "$1 $2 $3" in
  'version --format '*) echo 27.0.0 ;;
  'compose config --quiet') exit 0 ;;
  'compose config --hash') echo 'tdk-pos cfghash' ;;
  'compose ps -q') echo fake-container ;;
  'compose up -d') [ "${TDK_TEST_UP_FAIL:-0}" = 0 ] || exit 1 ;;
  'image inspect '*)
    case "$3" in tdk-pos:backup-*) [ -f "$TDK_TEST_STATE/tagged" ] || exit 1 ;; esac
    case "$*" in
      *org.opencontainers.image.revision*) if [ "${TDK_TEST_NO_LABEL:-0}" = 1 ]; then echo '<no value>'; else echo "$TDK_TEST_BASE_SHA"; fi ;;
      *com.tdkon.device-agent-url*) echo 'http://127.0.0.1:5168' ;;
      *'{{.Size}}'*) echo 1024 ;;
      *'{{.Created}}'*) echo '2026-11-22T00:00:00Z' ;;
      *'{{.Id}}'*) echo "$old" ;;
      *) echo "$old" ;;
    esac
    ;;
  'inspect --format '*)
    case "$*" in
      *'{{.Image}}'*) echo "$old" ;;
      *com.docker.compose.config-hash*) echo cfghash ;;
      *'{{.State.Status}}'*) echo running ;;
      *'.State.Health'*) echo healthy ;;
      *'{{.Created}}'*) echo '2026-11-22T00:00:00Z' ;;
      *'{{.Id}}'*) echo fake-container ;;
      *) echo unexpected-format >&2; exit 1 ;;
    esac
    ;;
  'inspect fake-container '*) echo '{"Id":"fake-container"}' ;;
  'exec fake-container '*) printf TDK_POS ;;
  'save -o '*)
    [ "${TDK_TEST_SAVE_FAIL:-0}" = 0 ] || exit 1
    tar -cf "$3" -C "$TDK_TEST_REPO" tdk-pos/docker-compose.yml
    ;;
  'image tag '*) : > "$TDK_TEST_STATE/tagged" ;;
  *) echo "unexpected fake docker call: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$sandbox/bin/sudo" "$sandbox/bin/git" "$sandbox/bin/df" "$sandbox/bin/docker"

release=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
sh "$sandbox/helper.sh" inspect > "$sandbox/inspect.txt"
grep -q "IMAGE_REVISION=$TDK_TEST_BASE_SHA" "$sandbox/inspect.txt"
sh "$sandbox/helper.sh" prepare "$release" "$TDK_TEST_BASE_SHA" > "$sandbox/prepare.txt"
grep -q '^ROLLBACK PREPARED:' "$sandbox/prepare.txt"
test -s "$sandbox/backups/$release/old-image.tar"
(cd "$sandbox/backups/$release" && sha256sum -c old-image.tar.sha256 >/dev/null)
sh "$sandbox/helper.sh" rollback "$release" > "$sandbox/rollback.txt"
grep -q '^ROLLBACK IMAGE RESTORED:' "$sandbox/rollback.txt"

printf 'corruption' >> "$sandbox/backups/$release/old-image.tar"
if sh "$sandbox/helper.sh" prepare "$release" "$TDK_TEST_BASE_SHA" > "$sandbox/bad-checksum.txt" 2>&1; then
  echo 'corrupted backup was accepted' >&2; exit 1
fi
grep -q 'existing image checksum failed' "$sandbox/bad-checksum.txt"

other=cccccccccccccccccccccccccccccccccccccccc
if TDK_TEST_SAVE_FAIL=1 sh "$sandbox/helper.sh" prepare "$other" "$TDK_TEST_BASE_SHA" > "$sandbox/save-fail.txt" 2>&1; then
  echo 'failed image save was accepted' >&2; exit 1
fi
grep -q 'running image archive failed' "$sandbox/save-fail.txt"

third=dddddddddddddddddddddddddddddddddddddddd
sh "$sandbox/helper.sh" prepare "$third" "$TDK_TEST_BASE_SHA" > /dev/null
if TDK_TEST_UP_FAIL=1 sh "$sandbox/helper.sh" rollback "$third" > "$sandbox/rollback-fail.txt" 2>&1; then
  echo 'failed rollback restart was accepted' >&2; exit 1
fi
grep -q 'previous container restart failed' "$sandbox/rollback-fail.txt"

if sh "$sandbox/helper.sh" prepare invalid "$TDK_TEST_BASE_SHA" > "$sandbox/invalid-sha.txt" 2>&1; then
  echo 'invalid release SHA was accepted' >&2; exit 1
fi
grep -q 'release SHA must be 40' "$sandbox/invalid-sha.txt"

legacy_id=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
evidence=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
TDK_TEST_NO_LABEL=1 sh "$sandbox/helper.sh" register-baseline "$TDK_TEST_BASE_SHA" "$legacy_id" "$evidence" > "$sandbox/baseline.txt"
TDK_TEST_NO_LABEL=1 sh "$sandbox/helper.sh" inspect > "$sandbox/baseline-inspect.txt"
grep -q '^REVISION_SOURCE=APPROVED_BASELINE$' "$sandbox/baseline-inspect.txt"
grep -q "^BASELINE_EVIDENCE_SHA256=$evidence\$" "$sandbox/baseline-inspect.txt"

if TDK_TEST_SUDO_DENY=1 sh "$sandbox/helper.sh" inspect > "$sandbox/sudo-fail.txt" 2>&1; then
  echo 'missing sudo permission was accepted' >&2; exit 1
fi
grep -q 'noninteractive Docker sudo is unavailable' "$sandbox/sudo-fail.txt"

printf 'PASS: inspect, backup/checksum, rollback, corrupt-backup rejection, save failure, rollback failure, SHA guard, approved baseline, sudo denial\n'
