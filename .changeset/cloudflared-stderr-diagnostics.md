---
"@ait-co/devtools": patch
---

cloudflared 종료/타임아웃 에러에 stderr 진단 첨부: cloudflared가 URL 보고 전에 죽으면 이제 에러 메시지에 마지막 15줄의 stderr 출력이 포함되어 근본 원인(Cloudflare error 1101 등)을 즉시 확인할 수 있습니다. trycloudflare.com 호스트명은 `<HOST>.trycloudflare.com` 플레이스홀더로 마스킹됩니다. (#421)
