/**
 * Browser context probes
 * Captures browser/runtime globals available in both mock (jsdom) and relay (real WebView)
 */

import type { Probe } from '../types.js';

export const browserContextProbes: Probe[] = [
  {
    id: 'browser.navigatorUserAgent',
    domain: 'browser-context',
    async run() {
      return typeof navigator !== 'undefined' ? navigator.userAgent : null;
    },
  },
  {
    id: 'browser.screenWidth',
    domain: 'browser-context',
    async run() {
      return typeof screen !== 'undefined' ? screen.width : null;
    },
  },
  {
    id: 'browser.screenHeight',
    domain: 'browser-context',
    async run() {
      return typeof screen !== 'undefined' ? screen.height : null;
    },
  },
  {
    id: 'browser.devicePixelRatio',
    domain: 'browser-context',
    async run() {
      return typeof window !== 'undefined' ? window.devicePixelRatio : null;
    },
  },
  {
    id: 'browser.windowInnerWidth',
    domain: 'browser-context',
    async run() {
      return typeof window !== 'undefined' ? window.innerWidth : null;
    },
  },
  {
    id: 'browser.windowInnerHeight',
    domain: 'browser-context',
    async run() {
      return typeof window !== 'undefined' ? window.innerHeight : null;
    },
  },
  {
    id: 'browser.navigatorLanguage',
    domain: 'browser-context',
    async run() {
      return typeof navigator !== 'undefined' ? navigator.language : null;
    },
  },
  {
    id: 'browser.navigatorOnLine',
    domain: 'browser-context',
    async run() {
      return typeof navigator !== 'undefined' ? navigator.onLine : null;
    },
  },
];
