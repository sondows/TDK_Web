# Shared staff deletion review — 2026-11-01

- TDK_POS_TEST and TDK_POS were checked read-only; no DB changes were made.
- The shared staff row has many RESTRICT foreign-key references to orders, payments, inventory, table sessions, checkouts and audit logs.
- Runtime POS routes still resolve staff_code=000 for shared operations.
- Deleting it would require changing historical business references and application behavior. It remains because login ID is NULL and auth paths exclude it.
