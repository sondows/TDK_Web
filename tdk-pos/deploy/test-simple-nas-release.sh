#!/bin/sh
set -eu
PATH=/usr/bin:/bin:$PATH
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sandbox=$(mktemp -d /tmp/tdk-simple-release-test.XXXXXX)
case "$(realpath "$sandbox")" in /tmp/tdk-simple-release-test.*) ;; *) exit 1 ;; esac
trap 'rm -rf "$sandbox"' 0 HUP INT TERM
mkdir -p "$sandbox/bin" "$sandbox/repo/tdk-pos"
printf '%s\n' 'DB_NAME=TDK_POS' > "$sandbox/repo/tdk-pos/.env.production"
sed "s#^repo=/volume1/TDK-POS\$#repo=$sandbox/repo#" "$here/simple-nas-release.sh" > "$sandbox/helper.sh"
export PATH="$sandbox/bin:$PATH" TDK_TEST_LOG="$sandbox/docker.log"
export TDK_TEST_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

cat > "$sandbox/bin/git" <<'EOF'
#!/bin/sh
case "$1 $2" in
  'branch --show-current') echo main ;;
  'fetch origin'|'pull --ff-only') exit 0 ;;
  'rev-parse FETCH_HEAD'|'rev-parse HEAD') echo "$TDK_TEST_SHA" ;;
  'status --porcelain=v1') [ "${TDK_TEST_DIRTY:-0}" = 0 ] || echo ' M tdk-pos/src/server.ts' ;;
  *) echo "unexpected git call: $*" >&2; exit 1 ;;
esac
EOF
cat > "$sandbox/bin/sudo" <<'EOF'
#!/bin/sh
if [ "$1" = -p ]; then shift 2; fi
if [ "$1" = -v ]; then exit 0; fi
[ "$1" = -n ] && shift
exec "$@"
EOF
cat > "$sandbox/bin/docker" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$TDK_TEST_LOG"
case "$1 $2 $3" in
  'compose config --quiet') exit 0 ;;
  'compose build tdk-pos') [ "${TDK_TEST_BUILD_FAIL:-0}" = 0 ] ;;
  'compose build --build-arg') [ "${TDK_TEST_BUILD_FAIL:-0}" = 0 ] ;;
  'compose up -d') [ "${TDK_TEST_UP_FAIL:-0}" = 0 ] ;;
  'compose ps -q') echo fake-container ;;
  'inspect --format '*) echo "${TDK_TEST_HEALTH:-healthy}" ;;
  *) echo "unexpected docker call: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$sandbox/bin/git" "$sandbox/bin/sudo" "$sandbox/bin/docker"

sh "$sandbox/helper.sh" "$TDK_TEST_SHA" > "$sandbox/success.txt"
grep -q '^DEPLOYMENT COMPLETE:' "$sandbox/success.txt"
grep -q '^compose build tdk-pos$' "$TDK_TEST_LOG"
grep -q '^compose up -d' "$TDK_TEST_LOG"
if grep -Eiq 'save|backup|rollback' "$TDK_TEST_LOG"; then echo 'unexpected backup or rollback' >&2; exit 1; fi

: > "$TDK_TEST_LOG"
if sh "$sandbox/helper.sh" bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb > "$sandbox/wrong-sha.txt" 2>&1; then
  echo 'wrong origin SHA was accepted' >&2; exit 1
fi
grep -q 'origin/main changed' "$sandbox/wrong-sha.txt"
test ! -s "$TDK_TEST_LOG"

: > "$TDK_TEST_LOG"
if TDK_TEST_DIRTY=1 sh "$sandbox/helper.sh" "$TDK_TEST_SHA" > "$sandbox/dirty-source.txt" 2>&1; then
  echo 'dirty NAS source was built' >&2; exit 1
fi
grep -q 'NAS app source has local edits' "$sandbox/dirty-source.txt"
test ! -s "$TDK_TEST_LOG"

: > "$TDK_TEST_LOG"
if TDK_TEST_BUILD_FAIL=1 sh "$sandbox/helper.sh" "$TDK_TEST_SHA" > "$sandbox/build-fail.txt" 2>&1; then
  echo 'failed build was accepted' >&2; exit 1
fi
grep -q 'Docker image build failed' "$sandbox/build-fail.txt"
if grep -q '^compose up' "$TDK_TEST_LOG"; then echo 'container replaced after failed build' >&2; exit 1; fi

: > "$TDK_TEST_LOG"
if TDK_TEST_UP_FAIL=1 sh "$sandbox/helper.sh" "$TDK_TEST_SHA" http://127.0.0.1:5169 > "$sandbox/up-fail.txt" 2>&1; then
  echo 'failed container replacement was accepted' >&2; exit 1
fi
grep -q 'container replacement failed' "$sandbox/up-fail.txt"
grep -q '^compose build --build-arg NEXT_PUBLIC_DEVICE_AGENT_URL=http://127.0.0.1:5169 tdk-pos$' "$TDK_TEST_LOG"

printf 'PASS: simple NAS release, SHA guard, build failure, container failure, optional Device Agent port\n'
