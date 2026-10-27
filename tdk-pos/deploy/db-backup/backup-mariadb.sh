#!/bin/sh
set -eu
umask 077
# POSIX TZ form works even when ADM lacks the Asia/Seoul zoneinfo file.
TZ=KST-9
export TZ
if [ "${1:-}" = preflight ]; then READ_ONLY_PREFLIGHT=1; fi

CONFIG_FILE=${TDK_POS_BACKUP_CONFIG:-/volume1/tdk-pos-backup/tdk-pos-backup.conf}
USB_LOG_FILE=
BACKUP_ROOT=
LOG_DIR=
USB_MARKER=
DB_VERSION=
DB_TABLE_COUNT=0
DB_ESTIMATED_BYTES=0
DB_NON_INNODB_COUNT=0
FREE_BYTES=0
START_EPOCH=$(date +%s)
RUN_ID=$(date +%Y-%m-%d_%H%M%S)
STAGE_RAW=
STAGE_FILE=
STAGE_SUM=
PUBLISHED_FILE=
PUBLISHED_SUM=

usb_mount_details() {
  umd_mount=$1
  umd_record=$(awk -v expected="$umd_mount" '$2 == expected { print $2, $1, $3, $4; found=1; exit } END { if (!found) exit 1 }' /proc/mounts 2>/dev/null) || return 1
  set -- $umd_record
  [ "$#" -eq 4 ] || return 1
  umd_target=$1
  umd_source=$2
  umd_type=$3
  umd_options=$4
  case "$umd_source" in /dev/*) ;; *) return 1 ;; esac
  umd_uuid=$(blkid -s UUID -o value "$umd_source" 2>/dev/null | head -n 1 | tr '[:upper:]' '[:lower:]') || return 1
  [ -n "$umd_uuid" ] || return 1
  printf '%s %s %s %s %s\n' "$umd_target" "$umd_source" "$umd_type" "$umd_options" "$umd_uuid"
}

usb_mount_is_expected() {
  [ -n "${USB_MOUNT:-}" ] && [ -n "${USB_UUID:-}" ] && [ -d "$USB_MOUNT" ] && [ ! -L "$USB_MOUNT" ] || return 1
  umd_details=$(usb_mount_details "$USB_MOUNT") || return 1
  set -- $umd_details
  [ "$#" -eq 5 ] || return 1
  [ "$1" = "$USB_MOUNT" ] && [ "$5" = "$(printf '%s' "$USB_UUID" | tr '[:upper:]' '[:lower:]')" ]
}

usb_is_safe() {
  [ -n "${USB_MARKER:-}" ] || return 1
  usb_mount_is_expected || return 1
  uss_details=$(usb_mount_details "$USB_MOUNT") || return 1
  set -- $uss_details
  [ -f "$USB_MARKER" ] && [ ! -L "$USB_MARKER" ] && [ "$(cat "$USB_MARKER" 2>/dev/null)" = "$5" ]
}

log() {
  log_level=$1
  shift
  log_message=$*
  printf '%s [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$log_level" "$log_message" >&2
  if [ "${READ_ONLY_PREFLIGHT:-0}" != 1 ] && command -v logger >/dev/null 2>&1; then
    logger -t tdk-pos-db-backup -p "user.${log_level}" -- "$log_message" || true
  fi
  if [ -n "$USB_LOG_FILE" ] && usb_is_safe; then
    printf '%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M:%S%z')" "$log_level" "$log_message" >> "$USB_LOG_FILE" || true
  else
    USB_LOG_FILE=
  fi
}

write_status() {
  ws_status=$1
  ws_message=$2
  ws_file=$3
  ws_size=$4
  [ -n "$LOG_DIR" ] && usb_is_safe || return 0
  ws_duration=$(( $(date +%s) - START_EPOCH ))
  ws_tmp="$LOG_DIR/.last-run.json.$$"
  ws_message=$(printf '%s' "$ws_message" | sed 's/\\/\\\\/g; s/"/\\"/g; s/[[:cntrl:]]/ /g')
  printf '{"completedAt":"%s","type":"%s","status":"%s","file":"%s","sizeBytes":%s,"durationSeconds":%s,"database":"%s","dbVersion":"%s","dumpTool":"%s","message":"%s"}\n' \
    "$(date '+%Y-%m-%dT%H:%M:%S%z')" "${JOB_KIND:-unknown}" "$ws_status" "$ws_file" "$ws_size" "$ws_duration" "${DB_NAME:-}" "$DB_VERSION" "${DB_DUMP_BIN:-}" "$ws_message" > "$ws_tmp"
  mv -f "$ws_tmp" "$LOG_DIR/last-run.json"
}

die() {
  log err "$*"
  if [ -n "$LOG_DIR" ] && usb_is_safe; then write_status failure "$*" '' 0 || true; fi
  exit 1
}

cleanup() {
  [ -z "$STAGE_RAW" ] || [ ! -e "$STAGE_RAW" ] || rm -f "$STAGE_RAW"
  [ -z "$STAGE_FILE" ] || [ ! -e "$STAGE_FILE" ] || rm -f "$STAGE_FILE"
  [ -z "$STAGE_SUM" ] || [ ! -e "$STAGE_SUM" ] || rm -f "$STAGE_SUM"
  if [ -n "$PUBLISHED_FILE" ] && [ -n "$PUBLISHED_SUM" ] && [ -e "$PUBLISHED_FILE" ] && [ ! -e "$PUBLISHED_SUM" ]; then
    rm -f "$PUBLISHED_FILE"
  elif [ -n "$PUBLISHED_FILE" ] && [ -n "$PUBLISHED_SUM" ] && [ -e "$PUBLISHED_FILE" ] && ! usb_mount_details "${USB_MOUNT:-/nonexistent}" >/dev/null 2>&1; then
    rm -f "$PUBLISHED_FILE" "$PUBLISHED_SUM"
  fi
  if [ -n "${LOCK_DIR:-}" ]; then rmdir "$LOCK_DIR" 2>/dev/null || true; fi
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

if [ ! -f "$CONFIG_FILE" ] || [ -L "$CONFIG_FILE" ]; then die "설정 파일이 없거나 심볼릭 링크입니다: $CONFIG_FILE"; fi
CONFIG_MODE=$(stat -c '%a' "$CONFIG_FILE" 2>/dev/null || true)
[ "$CONFIG_MODE" = 600 ] || die "설정 파일 권한은 600이어야 합니다."
# 설정 파일에는 경로와 식별값만 둡니다. 비밀번호는 별도 mode-600 파일에만 둘 수 있습니다.
. "$CONFIG_FILE"

for config_name in USB_MOUNT USB_UUID DB_NAME DB_CLIENT_BIN DB_DUMP_BIN DB_AUTH_MODE MIN_FREE_BYTES RETENTION_MODE; do
  eval "config_value=\${$config_name-}"
  [ -n "$config_value" ] || die "필수 설정이 비어 있습니다: $config_name"
done
case "$USB_MOUNT" in /*) ;; *) die "USB_MOUNT는 절대 경로여야 합니다." ;; esac
[ "$USB_MOUNT" != / ] || die "USB_MOUNT에 루트 경로를 사용할 수 없습니다."
case "$USB_UUID" in *[!A-Fa-f0-9-]*|'') die "USB_UUID 형식이 올바르지 않습니다." ;; esac
case "$DB_NAME" in *[!A-Za-z0-9_]*|'') die "DB_NAME 형식이 올바르지 않습니다." ;; esac
[ "$DB_NAME" = TDK_POS ] || die "이 백업 설정은 운영 DB TDK_POS만 허용합니다."
case "$DB_AUTH_MODE" in socket|defaults-file) ;; *) die "DB_AUTH_MODE는 socket 또는 defaults-file이어야 합니다." ;; esac
case "$MIN_FREE_BYTES" in *[!0-9]*|'') die "MIN_FREE_BYTES는 바이트 단위 정수여야 합니다." ;; esac
case "$RETENTION_MODE" in preview|apply) ;; *) die "RETENTION_MODE는 preview 또는 apply여야 합니다." ;; esac

for command_name in blkid stat df gzip sha256sum date awk mktemp head tr cat cp mkdir rm mv rmdir sed id; do
  command -v "$command_name" >/dev/null 2>&1 || die "필수 명령을 찾을 수 없습니다: $command_name"
done

if [ "${1:-}" != preflight ]; then
  LOCK_DIR=/tmp/tdk-pos-db-backup.lockdir
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    log warning "다른 백업 작업이 실행 중이거나 잠금 디렉터리가 남아 있어 이번 실행을 건너뜁니다: $LOCK_DIR"
    exit 0
  fi
fi

validate_usb() {
  [ -d "$USB_MOUNT" ] && [ ! -L "$USB_MOUNT" ] || die "USB 마운트 경로가 없거나 심볼릭 링크입니다: $USB_MOUNT"
  vu_details=$(usb_mount_details "$USB_MOUNT") || die "USB 마운트 정보 또는 UUID를 읽을 수 없습니다: $USB_MOUNT"
  set -- $vu_details
  vu_target=$1; vu_source=$2; vu_type=$3; vu_options=$4; vu_uuid=$5
  vu_canonical=$(cd "$USB_MOUNT" 2>/dev/null && pwd -P) || die "USB 마운트 경로를 확인할 수 없습니다."
  [ "$vu_target" = "$vu_canonical" ] || die "지정한 경로가 독립 마운트 지점이 아닙니다. target=$vu_target"
  [ "$vu_uuid" = "$(printf '%s' "$USB_UUID" | tr '[:upper:]' '[:lower:]')" ] || die "USB 파일시스템 UUID가 설정값과 다릅니다. actual=$vu_uuid"
  case ",$vu_options," in *,rw,*) ;; *) die "USB 파일시스템이 읽기 전용입니다." ;; esac
  usb_mount_is_expected || die "USB 마운트가 확인 단계 중 변경되었습니다."
  BACKUP_ROOT="$vu_canonical/TDK_POS_Backup"
  [ ! -L "$BACKUP_ROOT" ] || die "백업 루트가 심볼릭 링크이므로 중단합니다."
  mkdir -p "$BACKUP_ROOT" || die "USB에 백업 폴더를 만들 수 없습니다."
  [ "$(cd "$BACKUP_ROOT" 2>/dev/null && pwd -P)" = "$vu_canonical/TDK_POS_Backup" ] || die "백업 루트가 USB 내부의 예상 경로와 다릅니다."
  for category_name in Morning Evening Daily Monthly Logs; do
    [ ! -L "$BACKUP_ROOT/$category_name" ] || die "백업 하위 경로가 심볼릭 링크입니다: $category_name"
    usb_mount_is_expected || die "백업 디렉터리 생성 중 USB 확인에 실패했습니다."
    mkdir -p "$BACKUP_ROOT/$category_name" || die "백업 하위 디렉터리를 만들 수 없습니다: $category_name"
  done
  USB_MARKER="$BACKUP_ROOT/.tdk-pos-usb-uuid"
  if [ -e "$USB_MARKER" ]; then
    [ -f "$USB_MARKER" ] && [ ! -L "$USB_MARKER" ] && [ "$(cat "$USB_MARKER")" = "$(printf '%s' "$USB_UUID" | tr '[:upper:]' '[:lower:]')" ] || die "백업 장치 표식의 UUID가 설정값과 다릅니다."
  else
    usb_mount_is_expected || die "장치 표식 작성 직전 USB 확인에 실패했습니다."
    printf '%s\n' "$(printf '%s' "$USB_UUID" | tr '[:upper:]' '[:lower:]')" > "$USB_MARKER" || die "USB 장치 표식을 만들 수 없습니다."
  fi
  LOG_DIR="$BACKUP_ROOT/Logs"
  USB_LOG_FILE="$LOG_DIR/backup.log"
  vu_probe=$(mktemp "$LOG_DIR/.write-test.XXXXXX") || die "USB 백업 경로에 쓸 수 없습니다."
  rm -f "$vu_probe"
  vu_free_kb=$(df -Pk "$USB_MOUNT" | awk 'NR==2 {print $4}')
  case "$vu_free_kb" in *[!0-9]*|'') die "USB 여유 공간을 확인할 수 없습니다." ;; esac
  FREE_BYTES=$((vu_free_kb * 1024))
  [ "$FREE_BYTES" -ge "$MIN_FREE_BYTES" ] || die "USB 여유 공간이 최소 설정값보다 적습니다: $FREE_BYTES"
}

validate_database() {
  [ -x "$DB_DUMP_BIN" ] && [ ! -L "$DB_DUMP_BIN" ] || die "MariaDB dump 도구가 없거나 실행할 수 없습니다: $DB_DUMP_BIN"
  [ -x "$DB_CLIENT_BIN" ] && [ ! -L "$DB_CLIENT_BIN" ] || die "MariaDB client가 없거나 실행할 수 없습니다: $DB_CLIENT_BIN"
  if [ "$DB_AUTH_MODE" = socket ]; then
    [ "$(id -u)" = 0 ] || die "socket 인증 모드는 root 계정으로 실행해야 합니다."
  else
    [ -n "${DB_CLIENT_CNF:-}" ] && [ -f "$DB_CLIENT_CNF" ] && [ ! -L "$DB_CLIENT_CNF" ] || die "DB 인증 파일이 없거나 심볼릭 링크입니다."
    [ "$(stat -c '%a' "$DB_CLIENT_CNF" 2>/dev/null || true)" = 600 ] || die "DB 인증 파일 권한은 600이어야 합니다."
  fi
  vd_escaped=$(printf '%s' "$DB_NAME" | sed "s/'/''/g")
  if [ "$DB_AUTH_MODE" = socket ]; then
    vd_stats=$("$DB_CLIENT_BIN" --protocol=socket --user=root --batch --skip-column-names --execute "SELECT COUNT(*), COALESCE(SUM(data_length + index_length),0), VERSION(), COALESCE(SUM(CASE WHEN table_type='BASE TABLE' AND engine IS NOT NULL AND engine <> 'InnoDB' THEN 1 ELSE 0 END),0) FROM information_schema.tables WHERE table_schema='${vd_escaped}'") || die "DB 연결 또는 스키마 확인에 실패했습니다."
  else
    vd_stats=$("$DB_CLIENT_BIN" --defaults-extra-file="$DB_CLIENT_CNF" --batch --skip-column-names --execute "SELECT COUNT(*), COALESCE(SUM(data_length + index_length),0), VERSION(), COALESCE(SUM(CASE WHEN table_type='BASE TABLE' AND engine IS NOT NULL AND engine <> 'InnoDB' THEN 1 ELSE 0 END),0) FROM information_schema.tables WHERE table_schema='${vd_escaped}'") || die "DB 연결 또는 스키마 확인에 실패했습니다."
  fi
  set -- $vd_stats
  [ "$#" -eq 4 ] || die "대상 DB 정보가 예상 형식이 아닙니다."
  DB_TABLE_COUNT=$1; DB_ESTIMATED_BYTES=$2; DB_VERSION=$3; DB_NON_INNODB_COUNT=$4
  case "$DB_TABLE_COUNT$DB_ESTIMATED_BYTES$DB_NON_INNODB_COUNT" in *[!0-9]*) die "대상 DB 통계를 해석할 수 없습니다." ;; esac
  [ "$DB_TABLE_COUNT" -gt 0 ] || die "대상 DB에 테이블이 없습니다."
  [ "$DB_NON_INNODB_COUNT" -eq 0 ] || die "비-InnoDB 기본 테이블이 있어 단일 트랜잭션 백업을 보장할 수 없습니다: $DB_NON_INNODB_COUNT"
  vd_required=$(( DB_ESTIMATED_BYTES * 2 + 268435456 ))
  [ "$FREE_BYTES" -ge "$vd_required" ] || die "raw 임시본과 압축본을 위한 공간이 부족합니다. free=$FREE_BYTES required=$vd_required"
  log info "DB 확인 완료. database=$DB_NAME version=$DB_VERSION tables=$DB_TABLE_COUNT estimatedBytes=$DB_ESTIMATED_BYTES dumpTool=$DB_DUMP_BIN"
}

inspect_usb_readonly() {
  [ -d "$USB_MOUNT" ] && [ ! -L "$USB_MOUNT" ] || die "USB 마운트 경로가 없거나 심볼릭 링크입니다: $USB_MOUNT"
  io_details=$(usb_mount_details "$USB_MOUNT") || die "USB 마운트 정보 또는 UUID를 읽을 수 없습니다: $USB_MOUNT"
  set -- $io_details
  io_target=$1; io_options=$4; io_uuid=$5
  io_canonical=$(cd "$USB_MOUNT" 2>/dev/null && pwd -P) || die "USB 마운트 경로를 확인할 수 없습니다."
  [ "$io_target" = "$io_canonical" ] || die "지정한 경로가 독립 마운트 지점이 아닙니다. target=$io_target"
  [ "$io_uuid" = "$(printf '%s' "$USB_UUID" | tr '[:upper:]' '[:lower:]')" ] || die "USB UUID가 설정값과 다릅니다. actual=$io_uuid"
  case ",$io_options," in *,rw,*) ;; *) die "USB 파일시스템이 읽기 전용입니다." ;; esac
  [ -w "$USB_MOUNT" ] || die "USB 경로에 쓰기 권한이 없습니다."
  io_backup_root="$io_canonical/TDK_POS_Backup"
  [ ! -L "$io_backup_root" ] || die "백업 루트가 심볼릭 링크입니다."
  if [ -e "$io_backup_root" ]; then [ "$(cd "$io_backup_root" 2>/dev/null && pwd -P)" = "$io_backup_root" ] || die "백업 루트가 USB 내부 예상 경로와 다릅니다."; fi
  for category_name in Morning Evening Daily Monthly Logs; do [ ! -L "$io_backup_root/$category_name" ] || die "백업 하위 경로가 심볼릭 링크입니다: $category_name"; done
  io_free_kb=$(df -Pk "$USB_MOUNT" | awk 'NR==2 {print $4}')
  case "$io_free_kb" in *[!0-9]*|'') die "USB 여유 공간을 확인할 수 없습니다." ;; esac
  FREE_BYTES=$((io_free_kb * 1024))
  [ "$FREE_BYTES" -ge "$MIN_FREE_BYTES" ] || die "USB 여유 공간이 최소 설정값보다 적습니다: $FREE_BYTES"
  log info "읽기 전용 USB 검사 통과: target=$io_target uuid=$io_uuid freeBytes=$FREE_BYTES"
}

verify_backup() {
  vb_file=$1; vb_sum=$2; vb_size=$3
  [ "$vb_size" -ge 1024 ] || die "백업 파일 크기가 비정상적으로 작습니다: $vb_size bytes"
  gzip -t "$vb_file" || die "gzip 무결성 검사에 실패했습니다."
  vb_dir=${vb_file%/*}
  vb_sum_name=${vb_sum##*/}
  (cd "$vb_dir" && sha256sum -c "$vb_sum_name") || die "체크섬 검증에 실패했습니다."
}

date_days_ago() {
  da_days=$1
  set -- $(date '+%Y %m %d')
  da_date=$(awk -v y="$1" -v m="$2" -v d="$3" -v delta="$da_days" 'BEGIN {
    y -= (m <= 2); era=int(y/400); yoe=y-era*400
    doy=int((153*(m+(m>2?-3:9))+2)/5)+d-1
    doe=yoe*365+int(yoe/4)-int(yoe/100)+doy
    z=era*146097+doe-719468-delta
    era=int(z/146097); doe=z-era*146097
    yoe=int((doe-int(doe/1460)+int(doe/36524)-int(doe/146096))/365)
    y=yoe+era*400
    doy=doe-(365*yoe+int(yoe/4)-int(yoe/100))
    mp=int((5*doy+2)/153)
    d=doy-int((153*mp+2)/5)+1
    m=mp+(mp<10?3:-9); y+=(m<=2)
    printf "%04d%02d%02d", y,m,d
  }')
  printf '%s%s\n' "$da_date" "$(date '+%H%M%S')"
}

preview_or_apply_retention() {
  now_stamp=$(date '+%Y%m%d%H%M%S')
  for retention_category in Morning Evening Daily Monthly; do
    case "$retention_category" in
      Morning|Evening) retention_cutoff=$(date_days_ago 14) ;;
      Daily) retention_cutoff=$(date_days_ago 90) ;;
      Monthly) retention_cutoff="$(( $(date '+%Y') - 1 ))$(date '+%m')01000000" ;;
    esac
    retention_dir="$BACKUP_ROOT/$retention_category"
    retention_count=0; retention_newest=; retention_newest_file=
    for retention_file in "$retention_dir"/TDK_POS_*.sql.gz; do
      [ -f "$retention_file" ] || continue
      [ ! -L "$retention_file" ] && [ -f "$retention_file.sha256" ] && [ ! -L "$retention_file.sha256" ] || continue
      retention_base=${retention_file##*/}
      retention_stamp=$(printf '%s\n' "$retention_base" | sed -n 's/^TDK_POS_\([0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]\)_\([0-9][0-9][0-9][0-9][0-9][0-9]\)\.sql\.gz$/\1\2/p' | tr -d '-')
      [ -n "$retention_stamp" ] || continue
      retention_count=$((retention_count + 1))
      if [ -z "$retention_newest" ] || awk -v a="$retention_stamp" -v b="$retention_newest" 'BEGIN { exit !(a > b) }'; then retention_newest=$retention_stamp; retention_newest_file=$retention_file; fi
    done
    if [ "$retention_count" -eq 0 ]; then log info "정리 미리보기 $retention_category: 검증 가능한 파일 없음"; continue; fi
    for retention_file in "$retention_dir"/TDK_POS_*.sql.gz; do
      [ -f "$retention_file" ] || continue
      [ ! -L "$retention_file" ] && [ -f "$retention_file.sha256" ] && [ ! -L "$retention_file.sha256" ] || continue
      retention_base=${retention_file##*/}
      retention_stamp=$(printf '%s\n' "$retention_base" | sed -n 's/^TDK_POS_\([0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]\)_\([0-9][0-9][0-9][0-9][0-9][0-9]\)\.sql\.gz$/\1\2/p' | tr -d '-')
      [ -n "$retention_stamp" ] || continue
      awk -v a="$retention_stamp" -v b="$retention_cutoff" 'BEGIN { exit !(a < b) }' || continue
      if [ "$retention_file" = "$retention_newest_file" ]; then log info "최신 백업 보존: $retention_file"; continue; fi
      usb_is_safe || { log err "USB 마운트가 변경되어 보관 정리를 중단합니다."; return 1; }
      if [ "$RETENTION_MODE" = preview ] || [ ! -f "$LOG_DIR/restore-verified.marker" ]; then
        log info "정리 미리보기 대상: $retention_file 및 체크섬"
      else
        log warning "보관기간 만료 파일 삭제: $retention_file 및 체크섬"
        rm -f "$retention_file" "$retention_file.sha256"
      fi
    done
  done
}

publish_success() {
  ps_file=$1; ps_size=$2; ps_digest=$3
  log info "백업 성공: $ps_file sizeBytes=$ps_size sha256=$ps_digest durationSeconds=$(( $(date +%s) - START_EPOCH ))"
  if [ "$JOB_KIND" = daily ]; then
    usb_is_safe || die "일일 성공 표식을 쓰기 전 USB 확인에 실패했습니다."
    ps_marker="$LOG_DIR/Daily_$(date '+%Y-%m-%d').success"
    ps_tmp="$LOG_DIR/.daily-${RUN_ID}.success.$$"
    printf 'kind=daily\nfile=%s\nsha256=%s\nstarted_epoch=%s\ncompleted_epoch=%s\n' "${ps_file##*/}" "$ps_digest" "$START_EPOCH" "$(date +%s)" > "$ps_tmp"
    mv -f "$ps_tmp" "$ps_marker"
  fi
  write_status success '' "${ps_file##*/}" "$ps_size"
  preview_or_apply_retention || log err "백업은 성공했지만 보관 정리 처리에서 오류가 발생했습니다."
}

run_dump() {
  JOB_KIND=$1
  dump_category=$2
  validate_database
  dump_filename="$BACKUP_ROOT/$dump_category/TDK_POS_${RUN_ID}.sql.gz"
  dump_checksum="$dump_filename.sha256"
  [ ! -e "$dump_filename" ] && [ ! -e "$dump_checksum" ] || die "같은 이름의 백업이 있어 덮어쓰지 않습니다: ${dump_filename##*/}"
  usb_is_safe || die "임시 dump 생성 전 USB 확인에 실패했습니다."
  STAGE_RAW=$(mktemp "$BACKUP_ROOT/$dump_category/.TDK_POS_${RUN_ID}.sql.part.XXXXXX") || die "임시 SQL 파일을 만들 수 없습니다."
  STAGE_FILE=$(mktemp "$BACKUP_ROOT/$dump_category/.TDK_POS_${RUN_ID}.sql.gz.part.XXXXXX") || die "임시 압축 파일을 만들 수 없습니다."
  STAGE_SUM=$(mktemp "$BACKUP_ROOT/$dump_category/.TDK_POS_${RUN_ID}.sha256.part.XXXXXX") || die "임시 체크섬 파일을 만들 수 없습니다."
  if [ "$DB_AUTH_MODE" = socket ]; then
    "$DB_DUMP_BIN" --protocol=socket --user=root --single-transaction --quick --routines --triggers --events --hex-blob --default-character-set=utf8mb4 --databases "$DB_NAME" > "$STAGE_RAW" || die "MariaDB dump 명령이 실패했습니다."
  else
    "$DB_DUMP_BIN" --defaults-extra-file="$DB_CLIENT_CNF" --single-transaction --quick --routines --triggers --events --hex-blob --default-character-set=utf8mb4 --databases "$DB_NAME" > "$STAGE_RAW" || die "MariaDB dump 명령이 실패했습니다."
  fi
  usb_is_safe || die "dump 도중 USB 마운트가 바뀌어 게시를 중단합니다."
  gzip -c "$STAGE_RAW" > "$STAGE_FILE" || die "gzip 압축이 실패했습니다."
  rm -f "$STAGE_RAW"; STAGE_RAW=
  usb_is_safe || die "압축 도중 USB 마운트가 바뀌어 게시를 중단합니다."
  gzip -t "$STAGE_FILE" || die "gzip 무결성 검사에 실패했습니다."
  dump_size=$(stat -c '%s' "$STAGE_FILE")
  [ "$dump_size" -ge 1024 ] || die "임시 백업 파일 크기가 비정상적으로 작습니다: $dump_size bytes"
  dump_free_kb=$(df -Pk "$USB_MOUNT" | awk 'NR==2 {print $4}')
  case "$dump_free_kb" in *[!0-9]*|'') die "백업 후 USB 여유 공간을 확인할 수 없습니다." ;; esac
  [ $((dump_free_kb * 1024)) -ge "$MIN_FREE_BYTES" ] || die "백업 후 USB 여유 공간이 최소 설정값보다 적습니다."
  dump_digest=$(sha256sum "$STAGE_FILE" | awk '{print $1}')
  printf '%s  %s\n' "$dump_digest" "${dump_filename##*/}" > "$STAGE_SUM"
  PUBLISHED_FILE=$dump_filename; PUBLISHED_SUM=$dump_checksum
  usb_is_safe || die "백업 게시 직전 USB 확인에 실패했습니다."
  mv "$STAGE_FILE" "$dump_filename"; STAGE_FILE=
  usb_is_safe || die "체크섬 게시 직전 USB 확인에 실패했습니다."
  mv "$STAGE_SUM" "$dump_checksum"; STAGE_SUM=
  verify_backup "$dump_filename" "$dump_checksum" "$dump_size"
  publish_success "$dump_filename" "$dump_size" "$dump_digest"
  PUBLISHED_FILE=; PUBLISHED_SUM=
}

run_monthly_copy() {
  JOB_KIND=monthly
  [ "$(date '+%d')" = 01 ] || die "월간 보관은 매월 1일에만 실행할 수 있습니다."
  monthly_marker="$LOG_DIR/Daily_$(date '+%Y-%m-%d').success"
  [ -f "$monthly_marker" ] && [ ! -L "$monthly_marker" ] || die "오늘 자정 일일 백업 성공 기록이 없습니다."
  monthly_source=$(awk -F= '$1=="file" {print substr($0,6)}' "$monthly_marker")
  monthly_digest=$(awk -F= '$1=="sha256" {print substr($0,8)}' "$monthly_marker")
  monthly_started=$(awk -F= '$1=="started_epoch" {print substr($0,15)}' "$monthly_marker")
  monthly_completed=$(awk -F= '$1=="completed_epoch" {print substr($0,17)}' "$monthly_marker")
  monthly_today=$(date '+%Y-%m-%d')
  case "$monthly_source" in "TDK_POS_${monthly_today}_"??????.sql.gz) ;; *) die "오늘 생성된 일일 백업 기록이 아닙니다." ;; esac
  case "$monthly_digest" in *[!A-Fa-f0-9]*|'') die "일일 백업 체크섬 형식이 올바르지 않습니다." ;; esac
  [ "${#monthly_digest}" -eq 64 ] || die "일일 백업 체크섬 형식이 올바르지 않습니다."
  case "$monthly_started$monthly_completed" in *[!0-9]*|'') die "일일 백업 시각 기록 형식이 올바르지 않습니다." ;; esac
  monthly_now=$(date +%s)
  monthly_hour=$(date '+%H' | sed 's/^0//'); monthly_minute=$(date '+%M' | sed 's/^0//'); monthly_second=$(date '+%S' | sed 's/^0//')
  monthly_midnight=$((monthly_now - monthly_hour * 3600 - monthly_minute * 60 - monthly_second))
  [ "$monthly_started" -ge "$monthly_midnight" ] && [ "$monthly_started" -le $((monthly_midnight + 120)) ] && [ "$monthly_completed" -ge "$monthly_midnight" ] && [ "$monthly_completed" -le $((monthly_midnight + 900)) ] && [ "$(date +%s)" -le $((monthly_midnight + 960)) ] || die "00:00에 시작해 00:15 이내 완료된 백업이 아닙니다."
  monthly_source_file="$BACKUP_ROOT/Daily/$monthly_source"
  [ -f "$monthly_source_file" ] && [ -f "$monthly_source_file.sha256" ] && [ ! -L "$monthly_source_file" ] || die "오늘의 일일 백업 또는 체크섬이 없습니다."
  [ "$(awk 'NR==1 {print $1}' "$monthly_source_file.sha256")" = "$monthly_digest" ] || die "일일 백업 파일과 성공 기록의 체크섬이 다릅니다."
  verify_backup "$monthly_source_file" "$monthly_source_file.sha256" "$(stat -c '%s' "$monthly_source_file")"
  monthly_filename="TDK_POS_${RUN_ID}.sql.gz"
  monthly_destination="$BACKUP_ROOT/Monthly/$monthly_filename"
  [ ! -e "$monthly_destination" ] && [ ! -e "$monthly_destination.sha256" ] || die "이번 달 월간 파일이 이미 있습니다."
  STAGE_FILE=$(mktemp "$BACKUP_ROOT/Monthly/.monthly-${RUN_ID}.part.XXXXXX") || die "월간 임시 파일을 만들 수 없습니다."
  STAGE_SUM=$(mktemp "$BACKUP_ROOT/Monthly/.monthly-${RUN_ID}.sha256.part.XXXXXX") || die "월간 체크섬 임시 파일을 만들 수 없습니다."
  cp "$monthly_source_file" "$STAGE_FILE" || die "월간 파일 복사에 실패했습니다."
  monthly_copy_digest=$(sha256sum "$STAGE_FILE" | awk '{print $1}')
  [ "$monthly_copy_digest" = "$monthly_digest" ] || die "월간 복사본 체크섬이 원본과 다릅니다."
  monthly_copy_size=$(stat -c '%s' "$STAGE_FILE")
  printf '%s  %s\n' "$monthly_copy_digest" "$monthly_filename" > "$STAGE_SUM"
  PUBLISHED_FILE=$monthly_destination; PUBLISHED_SUM="$monthly_destination.sha256"
  usb_is_safe || die "월간 파일 게시 전 USB 확인에 실패했습니다."
  mv "$STAGE_FILE" "$monthly_destination"; STAGE_FILE=
  mv "$STAGE_SUM" "$monthly_destination.sha256"; STAGE_SUM=
  verify_backup "$monthly_destination" "$monthly_destination.sha256" "$monthly_copy_size"
  publish_success "$monthly_destination" "$monthly_copy_size" "$monthly_copy_digest"
  PUBLISHED_FILE=; PUBLISHED_SUM=
}

if [ "${1:-}" = preflight ]; then
  READ_ONLY_PREFLIGHT=1
  inspect_usb_readonly
  validate_database
  log info "읽기 전용 사전 검사 완료. USB에는 파일이나 폴더를 만들지 않았습니다."
  exit 0
fi

validate_usb
log info "USB 마운트·UUID·쓰기 권한 확인 완료. freeBytes=$FREE_BYTES"

case "${1:-}" in
  morning) RUN_ID=$(date +%Y-%m-%d_%H%M%S); run_dump morning Morning ;;
  evening) RUN_ID=$(date +%Y-%m-%d_%H%M%S); run_dump evening Evening ;;
  daily) RUN_ID=$(date +%Y-%m-%d_%H%M%S); run_dump daily Daily ;;
  monthly) RUN_ID=$(date +%Y-%m-%d_%H%M%S); run_monthly_copy ;;
  retention-preview) JOB_KIND=retention-preview; RETENTION_MODE=preview; preview_or_apply_retention ;;
  retention-apply) JOB_KIND=retention-apply; [ -f "$LOG_DIR/restore-verified.marker" ] || die "복원 검증 전에는 정리를 적용할 수 없습니다."; RETENTION_MODE=apply; preview_or_apply_retention ;;
  *) printf '사용법: %s {preflight|morning|evening|daily|monthly|retention-preview|retention-apply}\n' "$0" >&2; exit 2 ;;
esac
