# Shared staff 000 reassignment and deletion — 2026-11-01

## Result

- `TDK_POS_TEST`: 1,752 staff-reference values across 19 columns were changed from shared staff `000` to `001` (`sondows`). The `000` staff row was deleted.
- `TDK_POS`: 5,654 staff-reference values across 18 columns were changed from shared staff `000` to `001` (`sondows`). The `000` staff row was deleted.
- The affected references include business rows, audit-log actors, and logged-out POS session history. Historical attribution therefore now points to `sondows`, as requested.
- Both databases retained the same row counts in all dependent business tables. The `sondows` and `jindows` staff rows were unchanged.
- Post-commit read-only verification found no `000` staff row and no remaining FK value pointing to the deleted staff ID in either DB.
- Per-DB rollback snapshots are stored in the ACL-restricted, git-ignored `checkpoints/private-staff-cleanup/` directory.
- The unused `scripts/ensure-shared-staff.mjs` account-creation script was removed; no callers were found.

## Restore material

- `checkpoints/private-staff-cleanup/20261101-TDK_POS_TEST-shared000-reassignment-backup.json`
- `checkpoints/private-staff-cleanup/20261101-TDK_POS-shared000-reassignment-backup.json`

The snapshots contain the removed staff row and original primary-key/reference-column values. They contain no plaintext password or PIN.
