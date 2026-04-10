/**
 * Location mock (getCurrentLocation, startUpdateLocation)
 * mock/web/prompt 모드 지원
 */

import { aitState, type MockLocation } from '../state.js';
import { withPermission, checkPermission } from '../permissions.js';
import { waitForPromptResponse } from './_helpers.js';

enum Accuracy { Lowest = 1, Low = 2, Balanced = 3, High = 4, Highest = 5, BestForNavigation = 6 }
export { Accuracy };

function buildLocation(): MockLocation {
  return {
    coords: { ...aitState.state.location.coords },
    timestamp: Date.now(),
    accessLocation: aitState.state.location.accessLocation,
  };
}

// -- getCurrentLocation --

async function getCurrentLocationMock(): Promise<MockLocation> {
  return buildLocation();
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
          accessLocation: 'FINE',
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
  return waitForPromptResponse<MockLocation>('location');
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
  window.dispatchEvent(new CustomEvent('__ait:prompt-request', { detail: { type: 'location-update' } }));
  return () => window.removeEventListener('__ait:prompt-response:location-update', handler);
}

const _startUpdateLocation = (eventParams: StartUpdateLocationEventParams): () => void => {
  const mode = aitState.state.deviceModes.location;
  if (mode === 'web') return startUpdateLocationWeb(eventParams);
  if (mode === 'prompt') return startUpdateLocationPrompt(eventParams);
  return startUpdateLocationMock(eventParams);
};
export const startUpdateLocation = withPermission(_startUpdateLocation, 'geolocation');
