/**
 * 디바이스 모듈 내부 공유 헬퍼
 */

import { aitState } from '../state.js';

// --- Placeholder Image Generator ---

function generatePlaceholderImage(width: number, height: number, text: string, color: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // jsdom 등 Canvas API 미지원 환경에서는 간단한 SVG data URI 반환
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect fill="${color}" width="${width}" height="${height}"/><text x="50%" y="50%" fill="white" font-size="16" text-anchor="middle" dominant-baseline="middle">${text}</text></svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'white';
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);
  return canvas.toDataURL('image/png');
}

const DEFAULT_PLACEHOLDERS = [
  { text: 'Mock Photo 1', color: '#3182F6' },
  { text: 'Mock Photo 2', color: '#27ae60' },
  { text: 'Mock Photo 3', color: '#e67e22' },
];

let cachedPlaceholders: string[] | null = null;

export function getDefaultPlaceholderImages(): string[] {
  if (!cachedPlaceholders) {
    cachedPlaceholders = DEFAULT_PLACEHOLDERS.map(p => generatePlaceholderImage(320, 240, p.text, p.color));
  }
  return [...cachedPlaceholders];
}

/** @internal device 모듈 내부 전용 */
export function getMockImages(): string[] {
  const images = aitState.state.mockData.images;
  if (images.length > 0) return images;
  return getDefaultPlaceholderImages();
}

// --- Prompt Mode Helper ---

const PROMPT_TIMEOUT_MS = 30_000;

/** @internal device 모듈 내부 전용 */
export function waitForPromptResponse<T>(type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const eventName = '__ait:prompt-response:' + type;
    const cancelName = '__ait:prompt-cancel';

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener(eventName, handler);
      window.removeEventListener(cancelName, cancelHandler);
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`[@ait-co/devtools] Prompt timeout for "${type}" after ${PROMPT_TIMEOUT_MS / 1000}s. Is @ait-co/devtools/panel imported?`));
    }, PROMPT_TIMEOUT_MS);

    const handler = (e: Event) => {
      cleanup();
      resolve((e as CustomEvent).detail as T);
    };

    const cancelHandler = () => {
      cleanup();
      reject(new Error(`[@ait-co/devtools] Prompt cancelled for "${type}"`));
    };

    window.addEventListener(eventName, handler);
    window.addEventListener(cancelName, cancelHandler);
    window.dispatchEvent(new CustomEvent('__ait:prompt-request', { detail: { type } }));
  });
}
