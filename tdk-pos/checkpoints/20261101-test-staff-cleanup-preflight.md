# Test staff deletion preflight — 2026-11-01

- Read-only database identity checks: TDK_POS_TEST and TDK_POS both matched their expected names.
- Each DB contains four staff rows. The two protected accounts and shared staff row were preserved.
- Only one practice-labelled inactive row was identified per DB; both rows appear to be copies of the same account, so the requested two distinct test accounts were not established.
- No foreign-key or integer staff-ID references to that row were found. Audit records exist and must be preserved.
- No backup or transaction was started; no data was changed because the exact target count did not match.
- Credential hashes and plaintext secrets are not included.
