# TDKHOS smartphone HTTPS development

This setup is for the Windows development PC and `TDK_POS_TEST` only. It does not change the production NAS, production database, router, or Device Agent.

## Start

Run from the `tdk-pos` project directory.

1. Confirm the local DB target without making changes:

   ```powershell
   node deploy\verify-dev-test-db.cjs
   ```

   The command refuses to connect unless `DB_NAME` resolves to `TDK_POS_TEST`, then verifies `SELECT DATABASE()`.

2. The existing development certificate is valid for the LAN IP `192.168.0.54`, has that IP in its SAN, and chains to the local CA `TDKON Local Development CA`. The HTTPS listener currently uses this certificate on port 3000. Do not regenerate it unless it is expired, the LAN IP changes, or its private key is compromised; generation creates a new CA and requires reinstalling the new public CA certificate on every test phone.

   To generate a replacement only when needed:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy\setup-dev-https.ps1 -LanIp 192.168.0.54
   ```

   The leaf certificate has an IP SAN for `192.168.0.54`. The private PFX and its password are kept in `%LOCALAPPDATA%\TDKON\DevHttps`; only `root-ca.cer` is copied to the phone. The CA is not trusted automatically.

3. Start the Next.js development server in terminal 1. The app listens only on loopback port 3001, and the environment is pinned to the test DB with Secure session cookies:

   ```powershell
   $env:NODE_ENV = 'development'
   $env:PORT = '3001'
   $env:TDK_APP_BIND_HOST = '127.0.0.1'
   $env:DB_NAME = 'TDK_POS_TEST'
   $env:SESSION_COOKIE_SECURE = 'true'
   npm.cmd run dev
   ```

4. Start the TLS front in terminal 2:

   ```powershell
   $env:DEV_HTTPS_PORT = '3000'
   $env:DEV_HTTPS_UPSTREAM_PORT = '3001'
   node deploy\dev-https-proxy.cjs
   ```

   The TLS front binds only to `192.168.0.54:3000`; it forwards to `127.0.0.1:3001`. It rewrites the upstream Host and Origin to the loopback development origin so the server's existing local-development ingress attestation is used. It strips client-supplied `x-tdk-*` headers. The authentication functions and checks are unchanged.

5. Optional read-only smoke check:

   ```powershell
   $env:DEV_HTTPS_PORT = '3000'
   node deploy\verify-dev-https.cjs
   ```

   The invalid enrollment request is rejected before DB access; other checks are GETs.

## Trust the certificate

Transfer `%LOCALAPPDATA%\TDKON\DevHttps\root-ca.cer` to the Galaxy tablet using a trusted local method. Do not transfer `server.pfx` or `pfx-password.txt`.

   On a Galaxy phone, copy only `%LOCALAPPDATA%\TDKON\DevHttps\root-ca.cer` to the phone (for example, to Downloads using USB). Do not copy `server.pfx` or `pfx-password.txt`.

   Open **Settings → Security and privacy → More security settings → Install from device storage → CA certificate**, choose `root-ca.cer`, continue, authenticate with the screen lock, and confirm the installation. Menu names vary slightly by One UI version. Android may warn that user-installed certificates can be used to monitor network traffic; this is expected for a development CA. After installation, check **Settings → Security and privacy → More security settings → User certificates** for `TDKON Local Development CA`.

   Fully close and reopen Chrome. Do not proceed past a certificate warning or use a Chrome certificate-check bypass. If the warning remains, verify the phone's date/time, confirm the same current `root-ca.cer` is installed, and confirm the phone is opening the IP `192.168.0.54` that appears in the certificate SAN. The root CA is not automatically trusted by Windows or Android.

For testing in a Windows browser, import the same public `root-ca.cer` into **Current User → Trusted Root Certification Authorities → Certificates** with `certmgr.msc`. This is optional for the phone test. Do not import the server PFX as a trusted root.

## Phone test

1. Confirm the tablet is on the same Wi-Fi as the PC.
2. Open `https://192.168.0.54:3000/tdkhos`.
3. Check that there is no certificate warning. If there is one, confirm the CA was installed and regenerate/reinstall it only if the setup script was rerun.
4. Use a dedicated development employee in `TDK_POS_TEST` with HOS permission. Enter the ID, complete master-password device enrollment if required, then use that employee's PIN.
5. Confirm the HOS table view and inspect one table/order screen. Do not use an operational employee or production data.

The server process logs `DB_NAME=TDK_POS_TEST` at startup. Stop both terminal processes with Ctrl+C when finished. Do not forward port 3000 on the router. If Windows Firewall blocks Node, allow this development listener only on the private network; do not create a WAN/router rule.

The local root CA is generated anew each time the setup script runs. Reinstall the new `root-ca.cer` on clients after regeneration. The current HOS manifest serves distinct 192px, 512px, and maskable HOS icons; `node deploy\verify-dev-https.cjs` checks the HTTPS route, manifest, icons, and HOS auth route. The server-side smoke check does not prove that Android trusts the CA or that Chrome offers installation; those must be verified on the phone.
