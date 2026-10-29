# Multiple security owners

## Data and rollout

The current database stores one `owner_staff_id` and one security password hash in `admin_security_settings`. The additive migration creates one credential row per staff member in `admin_security_owners`, then copies the existing owner ID and hash unchanged. The legacy settings row remains intact for rollback; the application reads the new table after migration.

1. Take and verify the normal database backup. Do not change the backup job.
2. Apply `20261029_multiple_security_owners_test.sql` to `TDK_POS_TEST` and verify exactly the existing owner appears with status `ACTIVE` (or `SETUP_PENDING` only if the old hash was empty).
3. Apply `20261029_owner_password_reset_state_test.sql` to `TDK_POS_TEST`. Verify existing hashes show `ACTIVE`; NULL hashes remain `SETUP_PENDING`. The new `RESET_REQUIRED` state is reserved for an approved reset and is not inferred from a NULL hash.
4. Test old owner sign-in, second-factor verification, approved reset with executing-owner password reauthentication, target re-enrollment, and security pages against the test app.
5. Get separate approval before applying either production SQL file to `TDK_POS` or deploying the application. The current production schema was previously confirmed to lack `staff.employee_pin_hash`; the unified-PIN migration/enrollment therefore also needs a reviewed, approved plan before deploying the current app. Do not copy test PIN hashes to production.
6. Apply both production SQL files before deploying the code. Existing owner login and password remain valid because the old hash is copied verbatim.
7. After deployment, existing owners add only active staff with ADM access and an already configured common staff PIN. Newly assigned accounts get a NULL security hash and must create their own password after their next ADM sign-in.

The migration does not delete the legacy singleton row, change staff records, PIN hashes, or sessions. Re-running it is safe: the table creation is idempotent and seeding uses `INSERT IGNORE`.

## Owner rules

- Only a logged-in security owner with a fresh second-factor session and ADM write permission can add, reset, or revoke owners.
- Membership changes are serialized on the existing singleton security settings row.
- At least one owner membership remains. Removing/resetting the last owner with a configured password is rejected; an additional setup-pending owner is not counted as a usable recovery owner.
- Password reset requires both the actor's fresh second-factor session and a fresh verification of their own security password. It clears only the target owner's second-factor hash, marks `RESET_REQUIRED`, and clears all of the target's fresh-auth timestamps. Their staff login, common PIN, permissions, and records are retained. They create a new password themselves at their next ADM page request; setup changes the state to `ACTIVE` once and cannot be repeated without another approved reset.
- Security passwords are scrypt hashes, unique per owner, and are never displayed to other owners. The UI recommends 12 or more characters; current compatibility validation requires at least 10 characters and a special character, up to 128 characters.

## Last-owner recovery

There is no fixed or shared recovery password. If no configured owner can authenticate, a verified NAS/database administrator must use the approved out-of-band identity process, select an existing active employee whose ADM access and common PIN are already valid, and insert that employee into `admin_security_owners` with a NULL `password_hash`. The employee then signs in with their own ID and common PIN and creates their own security password. Do not remove old owner rows or alter any staff PIN during recovery. Record who approved and performed the change, and remove the temporary database operator's elevated access afterward.

Example recovery SQL (manual, approved DBA operation only; replace the staff ID after verifying it independently):

```sql
SET @recovery_staff_id = 1;
INSERT IGNORE INTO TDK_POS.admin_security_owners (staff_id, password_hash, assigned_by_staff_id)
SELECT staff_id, NULL, NULL
FROM TDK_POS.staff
WHERE staff_id = @recovery_staff_id
  AND is_active = 1 AND admin_enabled = 1
  AND admin_enabled = 1
  AND employee_pin_hash IS NOT NULL AND employee_pin_hash <> ''
  AND staff_code <> '000';

SELECT o.staff_id, s.admin_login_id,
       IF(o.password_hash IS NULL, 'SETUP_PENDING', 'ACTIVE') AS status
FROM TDK_POS.admin_security_owners o
JOIN TDK_POS.staff s ON s.staff_id = o.staff_id
WHERE o.staff_id = @recovery_staff_id;
```

This recovery example cannot run against the currently reported production schema until the separately reviewed common-PIN schema and enrollment are complete. Do not use it as an unapproved shortcut.
