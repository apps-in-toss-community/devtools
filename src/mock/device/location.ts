/**
 * Location mock (getCurrentLocation, startUpdateLocation)
 * mock/web/prompt 모드 지원
 */

import { checkPermission, withPermission } from '../permissions.js';
import { aitState } from '../state.js';
import type { MockLocation } from '../types.js';
import { waitForPromptResponse } from './_helpers.js';

enum Accuracy {
  Lowest = 1,
  Low = 2,
  Balanced = 3,
  High = 4,
  Highest = 5,
  BestForNavigation = 6,
}

export { Accuracy };

function buildLocation(): MockLocation {
  return {
    coords: { ...aitState.state.location.coords },
    timestamp: Date.now(),
    accessLocation: aitState.state.location.accessLocation,
  };
}

// -- getCurrentLocation --

// 실기기(2.x×iOS) capture는 getCurrentLocation이 { coords, timestamp }만 반환하고
// accessLocation은 포함하지 않음을 보였다(devtools#770). aitState.state.location에는
// accessLocation을 계속 유지하되(상태 모델은 그대로), 이 함수의 반환값에서만 제외한다.
async function getCurrentLocationMock(): Promise<MockLocation> {
  const { coords, timestamp } = buildLocation();
  return { coords, timestamp };
}

async function getCurrentLocationWeb(): Promise<MockLocation> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.warn('[@ait-co/devtools] Geolocation API not available, falling back to mock');
      resolve(buildLocation());
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          coords: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            altitude: pos.coords.altitude ?? 0,
            accuracy: pos.coords.accuracy,
            altitudeAccuracy: pos.coords.altitudeAccuracy ?? 0,
            heading: pos.coords.heading ?? 0,
          },
          timestamp: pos.timestamp,
        });
      },
      () => {
        console.warn('[@ait-co/devtools] Geolocation failed, falling back to mock');
        resolve(buildLocation());
      },
    );
  });
}

async function getCurrentLocationPrompt(): Promise<MockLocation> {
  // 패널의 prompt 응답은 startUpdateLocation과 채널을 공유하므로 accessLocation을
  // 실어 온다. getCurrentLocation의 반환 shape는 모드와 무관해야 하므로(실기기엔
  // mock/web/prompt 구분이 없다) 여기서 걷어낸다 — mock 모드와 같은 층의 처리다.
  const { coords, timestamp } = await waitForPromptResponse<MockLocation>('location');
  return { coords, timestamp } as MockLocation;
}

const _getCurrentLocation = async (_options?: { accuracy: Accuracy }): Promise<MockLocation> => {
  checkPermission('geolocation', 'getCurrentLocation');
  const mode = aitState.state.deviceModes.location;
  if (mode === 'web') return getCurrentLocationWeb();
  if (mode === 'prompt') return getCurrentLocationPrompt();
  return getCurrentLocationMock();
};
export const getCurrentLocation = withPermission(_getCurrentLocation, 'geolocation');

// -- startUpdateLocation --

interface StartUpdateLocationEventParams {
  onEvent: (response: MockLocation) => void;
  onError: (error: unknown) => void;
  options: { accuracy: Accuracy; timeInterval: number; distanceInterval: number };
}

function startUpdateLocationMock(eventParams: StartUpdateLocationEventParams): () => void {
  const { onEvent, options } = eventParams;
  const interval = Math.max(options.timeInterval, 500);
  const id = setInterval(() => {
    const loc = buildLocation();
    loc.coords.latitude += (Math.random() - 0.5) * 0.0001;
    loc.coords.longitude += (Math.random() - 0.5) * 0.0001;
    onEvent(loc);
  }, interval);
  return () => clearInterval(id);
}

function startUpdateLocationWeb(eventParams: StartUpdateLocationEventParams): () => void {
  const { onEvent, onError } = eventParams;
  if (!navigator.geolocation) {
    console.warn('[@ait-co/devtools] Geolocation API not available, falling back to mock');
    return startUpdateLocationMock(eventParams);
  }
  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      onEvent({
        coords: {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          altitude: pos.coords.altitude ?? 0,
          accuracy: pos.coords.accuracy,
          altitudeAccuracy: pos.coords.altitudeAccuracy ?? 0,
          heading: pos.coords.heading ?? 0,
        },
        timestamp: pos.timestamp,
        accessLocation: 'FINE',
      });
    },
    (err) => onError(err),
  );
  return () => navigator.geolocation.clearWatch(watchId);
}

function startUpdateLocationPrompt(eventParams: StartUpdateLocationEventParams): () => void {
  const { onEvent } = eventParams;
  const handler = (e: Event) => {
    onEvent((e as CustomEvent).detail as MockLocation);
  };
  window.addEventListener('__ait:prompt-response:location-update', handler);
  window.dispatchEvent(
    new CustomEvent('__ait:prompt-request', { detail: { type: 'location-update' } }),
  );
  return () => window.removeEventListener('__ait:prompt-response:location-update', handler);
}

const _startUpdateLocation = (eventParams: StartUpdateLocationEventParams): (() => void) => {
  const mode = aitState.state.deviceModes.location;
  if (mode === 'web') return startUpdateLocationWeb(eventParams);
  if (mode === 'prompt') return startUpdateLocationPrompt(eventParams);
  return startUpdateLocationMock(eventParams);
};
export const startUpdateLocation = withPermission(_startUpdateLocation, 'geolocation');
