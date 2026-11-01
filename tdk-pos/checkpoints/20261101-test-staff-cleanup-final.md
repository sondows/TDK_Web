# Test staff cleanup final — 2026-11-01

- Verified database identity separately for TDK_POS_TEST and TDK_POS.
- Deleted the inactive practice row (`staff_code=003`) once in each DB after backup and exact-row checks; both transactions committed.
- Preserved sondows and jindows including full row, auth, permission, token, and session fingerprints.
- Preserved 13 audit rows per DB and all business table counts.
- Kept `staff_code=000`, the POS shared system employee, because application routes depend on it and business records reference it by FK.
- Restricted hash-containing JSON backups are outside this archive under `checkpoints/private-staff-cleanup/`; DPAPI was unavailable in this execution context. Do not share or commit them.
- No schema change. Staff-management unit/route tests: 7/7 PASS. Live authenticated Chrome staff UI was not tested.
