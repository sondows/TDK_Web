# TDK-POS MariaDB USB backup

This job backs up the MariaDB server installed by ASUSTOR App Central. It connects on the NAS itself through the MariaDB client tools under `/volume1/.@plugins/AppCentral/mariadb/data/binary/bin/`; it does not use Docker for database access.

## Verified values supplied by the NAS operator

- USB mount: `/share/USB21`
- USB filesystem UUID: `341e7431-a839-41eb-91d7-ddbacc786db8`
- MariaDB dump: `/volume1/.@plugins/AppCentral/mariadb/data/binary/bin/mariadb-dump`
- MariaDB client: `/volume1/.@plugins/AppCentral/mariadb/data/binary/bin/mariadb`
- Candidate production schema: `TDK_POS`; confirm it matches the effective `DB_NAME` of the running POS app before the first backup. The workstation `.env.local` is test configuration (`TDK_POS_TEST`) and must not be copied to the NAS.

## Safety

- Checks both the exact mount path and filesystem UUID before any backup-folder write. A missing or different USB filesystem stops the job.
- Creates or uses only `/share/USB21/TDK_POS_Backup/{Morning,Evening,Daily,Monthly,Logs}`. No directory outside that tree is scanned for retention or deleted.
- Uses the NAS-local `mariadb-dump` with `--single-transaction`, `--quick`, routines, triggers, events, views, binary-safe hex output, and UTF-8. The preflight rejects schemas containing non-InnoDB base tables because those cannot be covered by the same consistent snapshot.
- Supports verified Unix-socket root authentication (the job then runs as OS root) or a separate mode-600 MariaDB option file. It never logs authentication values.
- Uses POSIX `/bin/sh`; it does not require Bash on ADM.
- Stages compressed output under a temporary name; publishes final names only after dump exit, gzip integrity, minimum size, free-space, and SHA-256 checks pass. Existing successful backups are not overwritten.
- Serializes runs with an atomic lock directory under `/tmp`. Retention remains `preview`; applying it also requires a restore-verification marker.

## NAS installation and first backup

1. On the NAS, inspect the effective POS app `DB_NAME` without displaying other container environment values:

   ```sh
   for c in $(docker ps --format '{{.Names}}'); do
     db_name=$(docker exec "$c" sh -c 'printf "%s" "${DB_NAME-}"' 2>/dev/null || true)
     [ -z "$db_name" ] || printf '%s\t%s\n' "$c" "$db_name"
   done
   ```

   Continue only if the active POS app reports `TDK_POS`. Do not use `TDK_POS_TEST`.

2. Check socket authentication and the USB identity read-only:

   ```sh
   sudo /volume1/.@plugins/AppCentral/mariadb/data/binary/bin/mariadb --protocol=socket --user=root --batch --skip-column-names --execute 'SELECT CURRENT_USER(), VERSION()'
   awk '$2=="/share/USB21" {print "target=" $2, "source=" $1, "type=" $3, "options=" $4}' /proc/mounts
   blkid -s UUID -o value /dev/sdd1
   df -h /share/USB21
   ```

   The socket query must succeed without changing MariaDB. The mount must show target `/share/USB21`, UUID `341e7431-a839-41eb-91d7-ddbacc786db8`, and `rw`. If socket authentication fails, stop and configure the separate option-file mode; do not reset the MariaDB password or alter users as part of this install.

3. From the workstation, transfer `backup-mariadb.sh` and `tdk-pos-backup.conf.example` to the NAS user's `/tmp` using SCP/SFTP. On the NAS, run as root: `install -d -o root -g root -m 700 /volume1/tdk-pos-backup`; install the script as `/volume1/tdk-pos-backup/backup-mariadb.sh` mode 700 and the config as `/volume1/tdk-pos-backup/tdk-pos-backup.conf` mode 600. This keeps the executable and non-secret settings on the persistent data volume. Keep the credential file, if needed, outside this repository.

4. Edit `/volume1/tdk-pos-backup/tdk-pos-backup.conf`; confirm the DB name and retain `RETENTION_MODE="preview"`. Set owner root and mode 600. The socket mode requires no DB password file. For defaults-file mode, set `DB_AUTH_MODE="defaults-file"`, set `DB_CLIENT_CNF` to a protected file containing the MariaDB account options, and set that file to root:root mode 600.

5. Run `backup-mariadb.sh preflight`. It checks the USB mount/UUID, disk space, MariaDB connection, schema size, and storage engines without creating files or taking a lock. If it passes, run `backup-mariadb.sh daily` once manually.

6. Verify the new `.sql.gz`, `.sha256`, and `Logs/last-run.json`; run `gzip -t` and `sha256sum -c`. Keep retention in preview mode.

7. Restore the dump only into an isolated test MariaDB instance using the same MariaDB version. Use a unique test database and temporary test-only storage, no production connection, and no production restore command. Verify 80 tables and key customer, prepaid, orders, payments, checkout, and sales data. Record the test in `Logs/restore-verified.marker` only after it passes. Do not enable retention deletion until then.

## Schedule (Asia/Seoul)

Register the four tasks only after the first manual backup is verified. They must run as root for local socket authentication. First check the current ADM version for a supported user-script scheduler; do not assume a GUI Task Scheduler exists. If there is no supported UI, use the NAS root crontab only after confirming it is ADM-persistent on this firmware. Keep the script on `/volume1`, not under a temporary system directory:

```cron
0 15 * * * /volume1/tdk-pos-backup/backup-mariadb.sh morning
0 21 * * * /volume1/tdk-pos-backup/backup-mariadb.sh evening
0 0 * * * /volume1/tdk-pos-backup/backup-mariadb.sh daily
15 0 1 * * /volume1/tdk-pos-backup/backup-mariadb.sh monthly
```

The monthly task copies only a verified Daily backup created after midnight that same day. If the midnight backup is missing, fails, or finishes too late, monthly copy fails instead of selecting an older file. After registration, confirm the entries survive a NAS reboot before relying on them.

## Retention

- Morning / Evening: 14 days
- Daily: 90 days
- Monthly: 12 calendar months

Retention remains preview-only until isolated restore validation is documented. Menu images, receipt logos, and other files outside MariaDB are not included.
