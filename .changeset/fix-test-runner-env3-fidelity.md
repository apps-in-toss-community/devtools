---
"@ait-co/devtools": patch
---

fix(test-runner): surface per-file failures (including evaluate timeouts) on stdout instead of only aggregate totals, and retry a timed-out file once before dropping it. Previously a file whose native call blocked past the evaluate timeout (e.g. camera's photo picker with no user gesture) was silently dropped to 0 tests and only counted in the aggregate 'N failed' line — two whole APIs could fail to run with no visible hint. The summary now prints each file's result (FAIL with error class, or OK with pass count) and a timed-out file gets one retry to ride out a transient native-dialog/GPS-cold-fix delay.
