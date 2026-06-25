---
---

Comment-only accuracy pass on the run_tests / build_attach_url paths (no
runtime or API change, so no version bump):

- `renderAttachBanner` JSDoc called its QR "ASCII" — it is a unicode
  half-block matrix from `renderQr` (distinct from the `qrcode-terminal`
  ASCII art the unplugin banner uses).
- Documented that the effective `wait_for_attach` timeout on the
  `build_attach_url` path is 60 s (the factory's `waitForAttachTimeoutMs`),
  which overrides `waitForFirstTarget`'s own 90 s signature default.
- Noted the TOTP-mint asymmetry between the two relay branches: env 2
  (relay-mobile) mints the code inline and passes it to
  `buildLauncherAttachUrl`; env 3/4 passes the secret to `buildAttachUrl`,
  which mints internally. Both mint at call time.
