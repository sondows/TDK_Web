# KDS HTTPS rollout and recovery

This change has not been deployed to the NAS. The live Caddyfile, production environment, and database were not available from this workspace.

## Before rollout

1. Locate the active Caddyfile and save a timestamped copy outside its active directory. Merge deploy/Caddyfile.tdkon.example into the existing tdkon.myasustor.com site; preserve the root-to-admin, TLS, and certificate settings.
2. Confirm the router forwards HTTPS to Caddy only. Do not expose NAS port 3000 to the Internet.
3. Record the current image ID and save the deployed image to a new protected path. Verify the archive exists before proceeding:

       docker image inspect tdk-pos:1.0.0 --format '{{.Id}}'
       docker save tdk-pos:1.0.0 -o /share/tdk-pos-before-kds-https.tar

4. Generate a dedicated key with openssl rand -base64 32. Add it to NAS .env.production as KDS_TOTP_ENCRYPTION_KEY, restrict access to the file, and keep a secure separate copy. Never commit or log it. Losing the key prevents decrypting enrolled TOTP seeds.
5. Apply db-migrations/20261028_kds_https_devices_totp.sql to TDK_POS_TEST first. Verify all added fields/tables and test enrollment, login, PIN change, and device revocation. Only then apply the same additive migration to TDK_POS.
6. Build and inspect the candidate image before a maintenance window. The Compose service uses tdk-pos:1.0.0; keep the archived old image until production verification is complete.
7. Validate the merged Caddyfile with the installed Caddy binary before reload. Do not replace the full live file with the sample.

## Employee setup

In Admin Center, edit each KDS employee and set a temporary six-digit KDS PIN and an enrollment password of at least 12 characters. Deliver the password privately. It is required with the OTP to register additional devices. Resetting the enrollment password clears the authenticator enrollment, revokes trusted devices, and logs out KDS sessions. A temporary PIN must be changed after first sign-in.

Open https://tdkon.myasustor.com/tdkkds on each approved browser and choose Register device. Enter employee ID and enrollment password, add the displayed secret to Google Authenticator, and confirm its current code. Then sign in with employee ID and temporary PIN and choose a new PIN. To register another device, the employee supplies the password and current OTP. Admin Center can inspect and revoke individual devices. Device tokens expire after 90 days; KDS sessions expire after 12 hours.

## Caddy behavior

- /tdkkds and descendants proxy to the existing app with the original path and Host.
- Root-level /api/kitchen requests reach Next.js; KDS handlers require an employee KDS session bound to an active device token.
- POS pages and POS APIs remain behind the existing 192.168.0.0/24 gate and Next.js public-host policy.
- The sample does not proxy directly to any other NAS service.

## Recovery

If the new application fails health checks, load the archived old image and restart only tdk-pos. Do not use docker compose down -v:

       docker load -i /share/tdk-pos-before-kds-https.tar
       docker compose up -d --no-deps tdk-pos

Restore the saved Caddyfile, validate it, and reload Caddy using the installation's existing procedure. The SQL migration is additive, so the old image can ignore the extra columns and tables. Do not restore an old database snapshot over live data. Keep KDS_TOTP_ENCRYPTION_KEY unchanged while enrolled devices are in use.

## Verification after deployment

From mobile data and the restaurant LAN, verify KDS page access, enrollment, first PIN change, logout, and re-login. Unauthenticated /api/kitchen must return 401; authorized KDS API calls must work; disabled employees and revoked devices must be rejected. Confirm /tdkpos, /pos, and POS APIs remain blocked from public Internet and POS still works on LAN. Check Caddy logs and confirm public cookies have HttpOnly, Secure, SameSite=Lax, 12-hour session and 90-day device expiry. Exercise cooking start, completion, undo, and both KDS tabs in a test service before serving production traffic.
