# TDKON database structure audit — 2026-11-01

Read-only comparison of `TDK_POS_TEST` and `TDK_POS` using the project `.env.local` connection settings. Both databases were independently confirmed with `SELECT DATABASE()`; both are MariaDB 10.11.18 on `AS5304T-SON:3306`. SELECT checks succeeded. No database writes, source-code edits, migrations, or credential/token reads were performed for this audit.

## Schema findings

- Both databases have 91 objects: 85 base tables and 6 views. Table engine/collation metadata, all 324 index entries, and all 120 foreign-key columns/rules match.
- Test has 753 columns; production has 754. Production alone has `staff.hos_enabled`. `managed_devices.device_type` is `ENUM('POS','KDS','ADM','HOS')` in test and `ENUM('POS','KDS')` in production. Thirty-four existing columns have different ordinal positions, caused by additive columns being inserted in different positions. No other column attributes differ.
- The six views have the same names and result-column shape. Development DB permission denied `SHOW CREATE VIEW`, so the actual test definitions could not be read. The readable production definitions explicitly qualify `TDK_POS`; whether test definitions reference test or production remains unverified. No triggers, procedures, functions, or events exist in either DB.

## Account and authentication findings

- Both databases contain only `sondows` and `jindows`; shared `000` and practice `003` are absent. The old staff IDs have zero remaining staff foreign-key references, including authentication-related references.
- Both have two active, non-terminated employees, both with common PIN hashes. Master password hashes exist for both in test and for neither in production. `sondows` has OWNER membership in both. HOS permission is off for both in test and on for both in production.
- Legacy `staff.pin_hash`, `staff.admin_pin_hash`, and `staff.kds_pin_hash` columns remain in both DBs; non-NULL row counts are test 1/1/0 and production 2/2/0. These values were counted without reading or outputting hashes.
- Auth schema exists in both. Program trust tokens: test 8 (7 unrevoked, 1 revoked), production 0. Staff sessions: test 181, production 208. Auth-attempt row counts differ by environment.
- Active staff sessions: test POS/ADM/KDS 1 each; production POS 4, ADM 10, KDS 3. `sondows` has one `admin_security_owners` membership in each DB; `jindows` has none. Managed-device inventory also differs (test 3 rows, production 6).

## Migration and data findings

- Neither DB has a migration history/ledger table. The repository has 49 SQL files, including diagnostics; file presence alone cannot prove application history.
- `staff_common_pin_hos_test.sql` effects are incomplete in test: `employee_pin_hash` exists but `staff.hos_enabled` does not. Production has both. The separate `managed_devices_add_adm_hos.sql` expansion is present in test and absent in production, consistent with its file comment requiring explicit production approval.
- Current `20261031_retire_shared_staff_account.sql` describes preserving `000`; it is stale relative to the later explicit deletion and must not be used as current state evidence.
- Row counts differ in 34 base tables; these are data differences. Orders: test 331 / production 1,411. Payments: 274 / 551. Other counts are documented in `PLANS.md`.

## Conclusion

**STRUCTURAL DRIFT.** Keep DBs unchanged until the development view definitions can be read and reviewed. If aligning, apply only reviewed additive migrations to test first; production remains a separate approved action. HOS permissions must not be bulk-enabled as part of schema alignment.
