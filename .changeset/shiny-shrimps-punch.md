---
'@ait-co/devtools': patch
---

Fix telemetry "내 데이터 삭제" button + the 30-day re-prompt after "No, thanks":

- `deleteMyData` was calling `DELETE https://t.aitc.dev/?anon_id=…` (missing `/e`). Now hits `DELETE /e?anon_id=…` and rotates the local `anon_id` to a fresh UUID on success so future events are unlinkable from deleted history.
- `shouldShowToast` only re-prompted when consent was `undecided`, so users who picked "No, thanks" never saw the toast again. It now re-prompts denied users once when `reprompt_after` (30 days, or version-bump) has elapsed, and respects `MAX_SAFE_INTEGER` as permanent silence after a second decline.
