/**
 * Ads domain probes (read-only: check surface exists)
 */

import { GoogleAdMob, loadFullScreenAd, TossAds } from '../../../src/mock/ads/index.js';
import type { Probe } from '../types.js';

export const adsProbes: Probe[] = [
  {
    id: 'ads.GoogleAdMobIsLoadedExists',
    domain: 'ads',
    async run() {
      return typeof GoogleAdMob.isAppsInTossAdMobLoaded === 'function';
    },
  },
  {
    id: 'ads.GoogleAdMobIsLoaded',
    domain: 'ads',
    async run() {
      return await GoogleAdMob.isAppsInTossAdMobLoaded({});
    },
  },
  {
    id: 'ads.TossAdsInitExists',
    domain: 'ads',
    async run() {
      return typeof TossAds.initialize === 'function';
    },
  },
  {
    id: 'ads.loadFullScreenAdExists',
    domain: 'ads',
    async run() {
      return typeof loadFullScreenAd === 'function';
    },
  },
];
