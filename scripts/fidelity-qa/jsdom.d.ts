/**
 * Minimal ambient declaration for jsdom (no @types/jsdom available).
 * Only declares the JSDOM constructor signature used by the mock runner.
 */
declare module 'jsdom' {
  interface JSDOMOptions {
    url?: string;
    pretendToBeVisual?: boolean;
    resources?: string;
    runScripts?: string;
  }

  class JSDOM {
    constructor(html?: string, options?: JSDOMOptions);
    readonly window: Window & typeof globalThis;
  }
}
