/**
 * 로컬 HTTP 서버 — QR 페이지를 `http://127.0.0.1:<port>` 에서 서빙한다.
 *
 * file:// origin 대신 HTTP origin을 쓰는 이유: 브라우저 보안 정책상 file://에서
 * 로드된 페이지는 외부 fetch/script가 전부 차단되며, file:// 절대 경로를 <img src>에
 * 넣으면 브라우저에 따라 빈 화면이 된다. 127.0.0.1 HTTP는 modern 브라우저가 fully trust.
 *
 * SECRET-HANDLING:
 *   - 127.0.0.1 바인딩만 — 외부 노출 0.
 *   - attachUrl은 HTML 본문과 /qr.png query에만 들어간다 (의도된 전달 경로).
 *   - stdout/stderr/로그에 별도 출력하지 않는다.
 *   - tmp 파일 만들지 않음 — 모든 응답을 메모리에서 생성.
 */

import type { Server } from 'node:http';
import { createServer } from 'node:http';

export interface QrHttpServer {
  port: number;
  /** `http://127.0.0.1:<port>/attach?u=<encoded>` URL 생성 헬퍼. */
  buildAttachPageUrl(attachUrl: string): string;
  close(): Promise<void>;
}

/**
 * 로컬 HTTP 서버를 127.0.0.1 random port(또는 `AIT_DEBUG_HTTP_PORT` env)로 시작한다.
 * MCP debug server 생애주기에 묶어 사용 — `runDebugServer` shutdown 시 `close()`로 정리.
 */
export async function startQrHttpServer(): Promise<QrHttpServer> {
  const { default: QRCode } = await import('qrcode');

  const server: Server = createServer((req, res) => {
    const rawUrl = req.url ?? '/';
    const [path, query = ''] = rawUrl.split('?', 2) as [string, string | undefined];
    const params = new URLSearchParams(query ?? '');

    if (path === '/attach') {
      const encodedU = params.get('u') ?? '';
      let attachUrl: string;
      try {
        attachUrl = decodeURIComponent(encodedU);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('잘못된 u 파라미터입니다.');
        return;
      }

      // deploymentId 라벨 — attachUrl에서 _deploymentId 파라미터만 추출 (at= 노출 방지).
      let deploymentIdLabel = 'attach';
      try {
        const dpMatch = attachUrl.match(/[?&]_deploymentId=([^&]+)/);
        if (dpMatch?.[1]) {
          deploymentIdLabel = decodeURIComponent(dpMatch[1]).slice(0, 36);
        }
      } catch {
        // best-effort
      }

      // QR을 base64 data URL로 인라인 생성 — 외부 fetch 없이 self-contained HTML.
      QRCode.toDataURL(attachUrl, { type: 'image/png', errorCorrectionLevel: 'M' })
        .then((dataUrl: string) => {
          const safeLabel = deploymentIdLabel.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
          const safeAttachUrl = attachUrl.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
          const html = buildAttachHtml(dataUrl, safeLabel, safeAttachUrl);
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end(html);
        })
        .catch(() => {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('QR 생성에 실패했습니다.');
        });
      return;
    }

    if (path === '/qr.png') {
      const encodedU = params.get('u') ?? '';
      let attachUrl: string;
      try {
        attachUrl = decodeURIComponent(encodedU);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('잘못된 u 파라미터입니다.');
        return;
      }

      QRCode.toBuffer(attachUrl, { type: 'png', errorCorrectionLevel: 'M' })
        .then((buf: Buffer) => {
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-store',
            'Content-Length': String(buf.length),
          });
          res.end(buf);
        })
        .catch(() => {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('QR PNG 생성에 실패했습니다.');
        });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });

  const listenPort = Number(process.env.AIT_DEBUG_HTTP_PORT ?? 0);

  await new Promise<void>((resolve, reject) => {
    server.listen(listenPort, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('qr-http-server: server.address()가 예상하지 못한 형태입니다.');
  }
  const port = address.port;

  return {
    port,
    buildAttachPageUrl(attachUrl: string): string {
      return `http://127.0.0.1:${port}/attach?u=${encodeURIComponent(attachUrl)}`;
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

/**
 * QR 스캔 페이지 HTML 본문.
 * dark theme, inline style, 외부 fetch 없음.
 */
function buildAttachHtml(qrDataUrl: string, safeLabel: string, safeAttachUrl: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AIT 디버그 세션 — QR 스캔</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0d1117; color: #c9d1d9;
      display: flex; flex-direction: column; align-items: center;
      min-height: 100vh; margin: 0; padding: 2rem 1rem;
      gap: 1.5rem;
    }
    h1 { font-size: 1.25rem; font-weight: 600; color: #e6edf3; margin: 0; text-align: center; }
    .label { font-size: 0.8rem; opacity: 0.5; font-family: monospace; margin: 0; }
    img.qr {
      width: min(90vw, 360px); height: auto;
      image-rendering: pixelated;
      background: #fff; padding: 1rem; border-radius: 12px;
    }
    section { width: 100%; max-width: 480px; }
    h2 { font-size: 1rem; font-weight: 600; color: #e6edf3; margin: 0 0 0.5rem; }
    ol, ul { margin: 0; padding-left: 1.25rem; }
    li { margin-bottom: 0.4rem; font-size: 0.9rem; line-height: 1.5; }
    .url-box {
      font-family: monospace; font-size: 0.72rem;
      word-break: break-all; opacity: 0.4;
      background: #161b22; padding: 0.75rem 1rem;
      border-radius: 6px; border: 1px solid #30363d;
    }
    hr { border: none; border-top: 1px solid #21262d; width: 100%; margin: 0.5rem 0; }
  </style>
</head>
<body>
  <h1>AIT 디버그 세션 — QR 스캔</h1>
  <p class="label">deployment: ${safeLabel}</p>
  <img class="qr" src="${qrDataUrl}" alt="attach QR" />

  <section>
    <h2>스캔 절차</h2>
    <ol>
      <li>토스 앱을 실행하세요.</li>
      <li>폰 카메라 앱으로 QR 코드를 스캔하세요.</li>
      <li>팝업이 뜨면 <strong>"토스로 열기"</strong>를 탭하세요.</li>
      <li>미니앱이 열리고 디버그 세션이 자동으로 attach됩니다.</li>
    </ol>
  </section>

  <hr />

  <section>
    <h2>진단 체크리스트</h2>
    <ul>
      <li><strong>토스 앱이 안 열리는 경우</strong> — 앱 버전 확인, 카메라 앱으로 스캔 (토스 앱 내 QR 리더 X)</li>
      <li><strong>미니앱이 PREPARE 상태에서 멈추는 경우</strong> — deep-link에 <code>_deploymentId</code> 파라미터가 있는지 확인</li>
      <li><strong>Chii 주입 실패 / 콘솔이 비어 있는 경우</strong> — 미니앱 번들에 <code>in-app</code> debug import가 있는지 확인</li>
      <li><strong>TOTP gate Layer C가 비활성인 경우</strong> — relay 서버에 <code>AIT_DEBUG_TOTP_SECRET</code>이 설정돼 있는지 확인</li>
    </ul>
  </section>

  <hr />

  <section>
    <h2>URL (fallback)</h2>
    <p class="url-box">${safeAttachUrl}</p>
  </section>
</body>
</html>`;
}
