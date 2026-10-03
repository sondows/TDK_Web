# ASUSTOR Docker deployment

This deployment runs only the Next.js app. It connects to the existing NAS MariaDB; the Compose file does not create a database.

## Before starting

1. Copy `.env.production.example` to `.env.production` on the NAS. Fill in the five `DB_*` values and a long random `ADMIN_GRANT_SECRET`. Keep `.env.production` private; it is Git ignored and excluded from the Docker build context. `DATABASE_URL` is not used by the application DB pool.
2. Set `DB_HOST` to an address reachable from the container, normally the NAS LAN IP or DNS name. `localhost` in the container is not the NAS. MariaDB must listen on that address and allow the selected DB account to connect from the Docker network. Restrict firewall and grants to the required source/network.
3. Ensure NAS port 3000 is free. Compose maps NAS port 3000 to container port 3000.
4. Prepare the existing upload directories in the project directory on the NAS:

   ```sh
   mkdir -p public/uploads/menu storage/receipt-logo
   ```

   The container runs as the `node` user (UID/GID 1000 in the selected image). Grant that user read/write access to both bind-mounted directories using the NAS ACL or ownership settings. Copy existing menu uploads and receipt logos into these directories before starting. Back up both directories with the database. Menu image URLs and the selected receipt logo filename are stored in MariaDB, while the image bytes are files.

5. Production session/grant cookies use the `Secure` flag. Put an HTTPS reverse proxy in front of the app for browser use. Port 3000 remains the configured upstream and direct port mapping. Verify the NAS reverse proxy and firewall settings before opening access outside the LAN.

## Start and inspect

```sh
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f tdk-pos
```

The healthcheck calls the existing `GET /api/pos-settings/login-mode` endpoint from inside the container. It checks that the server responds and can read `system_settings` from MariaDB. Docker does not automatically restart a merely unhealthy container; `restart: unless-stopped` restarts it after process exit or host restart.

The menu image directory is mounted at its existing default `/app/public/uploads/menu`; the receipt logo directory is mounted at `/app/storage/receipt-logo`. Static assets elsewhere under `public` are copied into the image. Uploaded menu images are served through the existing `/api/menu-images/...` route. Do not change the storage path environment variables unless the matching bind mounts are changed too.

## Database preparation

There is no complete baseline database migration in this repository. `drizzle.config.ts` currently filters to `dining_tables`, so do not run a blanket `drizzle-kit push` against an empty production database. Start with a backup/copy of the existing compatible `TDK_POS` schema and data. Compare the target schema with `src/db/schema.ts` and apply **only missing** SQL files manually, in dependency order:

1. `sql/20260923_table_session_discounts.sql` and `sql/add_admin_login.sql` (independent additions).
2. `sql/create_customers.sql` (only when `customers` does not already exist).
3. `sql/add_card_overpayment_prepaid_ledger.sql` (adds payment columns, then the original ledger).
4. `sql/extend_customer_prepaid_ledger_payment_methods.sql`.
5. `sql/extend_customer_trade_ledger.sql`.
6. `sql/add_other_payment_cash_change_threshold.sql`.
7. `sql/allow_amount_other_payment_cash_change.sql`.
8. `sql/add_customer_payment_method.sql`.

Most scripts are not idempotent. Check which columns, constraints, and rows are already present before running them; do not rerun applied ALTER scripts. `sql/proposed_customer_postpaid_permission.sql` is a proposal and must not be applied. Compose does not run migrations automatically.

## Existing Device Agent limitation

`/api/sales` currently accepts a receipt reprint Device Agent URL only on loopback (`127.0.0.1`, `localhost`, `::1`). Inside this Docker container, loopback means the container itself. A Device Agent running on a separate POS PC cannot be reached by changing `DEVICE_AGENT_URL` to that PC's LAN IP under the current code. Receipt reprinting through this server therefore needs a separately planned Agent deployment/integration; this Docker setup does not change the printer code.
