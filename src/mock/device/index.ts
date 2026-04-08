/**
 * 디바이스 기능 mock
 * Storage, Location, Camera, Photos, Contacts, Clipboard, Haptic
 *
 * 각 API는 deviceModes 설정에 따라 mock/web/prompt 모드로 동작한다.
 */

import { aitState, type MockLocation, type NetworkStatus } from '../state.js';
import { createMockProxy } from '../proxy.js';
import { withPermission, checkPermission } from '../permissions.js';

// --- Placeholder Image Generator ---

export function generatePlaceholderImage(width: number, height: number, text: string, color: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
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
  return cachedPlaceholders;
}

function getMockImages(): string[] {
  const images = aitState.state.mockData.images;
  if (images.length > 0) return images;
  return getDefaultPlaceholderImages();
}

// --- Prompt Mode Helper ---

const PROMPT_TIMEOUT_MS = 30_000;

function waitForPromptResponse<T>(type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const eventName = '__ait:prompt-response:' + type;
    const timer = setTimeout(() => {
      window.removeEventListener(eventName, handler);
      reject(new Error(`[ait-devtools] Prompt timeout for "${type}" after ${PROMPT_TIMEOUT_MS / 1000}s. Is ait-devtools/panel imported?`));
    }, PROMPT_TIMEOUT_MS);

    const handler = (e: Event) => {
      clearTimeout(timer);
      window.removeEventListener(eventName, handler);
      resolve((e as CustomEvent).detail as T);
    };
    window.addEventListener(eventName, handler);
    window.dispatchEvent(new CustomEvent('__ait:prompt-request', { detail: { type } }));
  });
}

// --- Storage ---

export const Storage = createMockProxy('Storage', {
  getItem: async (key: string): Promise<string | null> => {
    return localStorage.getItem(`__ait_storage:${key}`);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    localStorage.setItem(`__ait_storage:${key}`, value);
  },
  removeItem: async (key: string): Promise<void> => {
    localStorage.removeItem(`__ait_storage:${key}`);
  },
  clearItems: async (): Promise<void> => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('__ait_storage:'));
    keys.forEach(k => localStorage.removeItem(k));
  },
});

// --- Location ---

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
      console.warn('[ait-devtools] Geolocation API not available, falling back to mock');
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
        console.warn('[ait-devtools] Geolocation failed, falling back to mock');
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
    console.warn('[ait-devtools] Geolocation API not available, falling back to mock');
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

function _startUpdateLocation(eventParams: StartUpdateLocationEventParams): () => void {
  const mode = aitState.state.deviceModes.location;
  if (mode === 'web') return startUpdateLocationWeb(eventParams);
  if (mode === 'prompt') return startUpdateLocationPrompt(eventParams);
  return startUpdateLocationMock(eventParams);
}

export const startUpdateLocation = Object.assign(_startUpdateLocation, {
  getPermission: () => withPermission(_getCurrentLocation, 'geolocation').getPermission(),
  openPermissionDialog: () => withPermission(_getCurrentLocation, 'geolocation').openPermissionDialog(),
});

// --- Camera ---

async function openCameraMock(): Promise<{ id: string; dataUri: string }> {
  const images = getMockImages();
  return { id: crypto.randomUUID(), dataUri: images[0] };
}

async function openCameraWeb(): Promise<{ id: string; dataUri: string }> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { reject(new Error('No file selected')); return; }
      const reader = new FileReader();
      reader.onload = () => resolve({ id: crypto.randomUUID(), dataUri: reader.result as string });
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

async function openCameraPrompt(): Promise<{ id: string; dataUri: string }> {
  const dataUri = await waitForPromptResponse<string>('camera');
  return { id: crypto.randomUUID(), dataUri };
}

const _openCamera = async (_options?: { base64?: boolean; maxWidth?: number }): Promise<{ id: string; dataUri: string }> => {
  checkPermission('camera', 'openCamera');
  const mode = aitState.state.deviceModes.camera;
  if (mode === 'web') return openCameraWeb();
  if (mode === 'prompt') return openCameraPrompt();
  return openCameraMock();
};
export const openCamera = withPermission(_openCamera, 'camera');

// --- Album Photos ---

async function fetchAlbumPhotosMock(maxCount: number): Promise<Array<{ id: string; dataUri: string }>> {
  const images = getMockImages();
  return images.slice(0, maxCount).map(dataUri => ({ id: crypto.randomUUID(), dataUri }));
}

async function fetchAlbumPhotosWeb(maxCount: number): Promise<Array<{ id: string; dataUri: string }>> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []).slice(0, maxCount);
      if (files.length === 0) { reject(new Error('No files selected')); return; }
      const results = await Promise.all(
        files.map(file => new Promise<{ id: string; dataUri: string }>((res) => {
          const reader = new FileReader();
          reader.onload = () => res({ id: crypto.randomUUID(), dataUri: reader.result as string });
          reader.readAsDataURL(file);
        })),
      );
      resolve(results);
    };
    input.click();
  });
}

async function fetchAlbumPhotosPrompt(maxCount: number): Promise<Array<{ id: string; dataUri: string }>> {
  const dataUris = await waitForPromptResponse<string[]>('photos');
  return dataUris.slice(0, maxCount).map(dataUri => ({ id: crypto.randomUUID(), dataUri }));
}

const _fetchAlbumPhotos = async (options?: { maxCount?: number; maxWidth?: number; base64?: boolean }): Promise<Array<{ id: string; dataUri: string }>> => {
  checkPermission('photos', 'fetchAlbumPhotos');
  const maxCount = options?.maxCount ?? 10;
  const mode = aitState.state.deviceModes.photos;
  if (mode === 'web') return fetchAlbumPhotosWeb(maxCount);
  if (mode === 'prompt') return fetchAlbumPhotosPrompt(maxCount);
  return fetchAlbumPhotosMock(maxCount);
};
export const fetchAlbumPhotos = withPermission(_fetchAlbumPhotos, 'photos');

// --- Contacts ---

const _fetchContacts = async (options: { size: number; offset: number; query?: { contains?: string } }) => {
  checkPermission('contacts', 'fetchContacts');
  let contacts = aitState.state.contacts;
  if (options.query?.contains) {
    const q = options.query.contains.toLowerCase();
    contacts = contacts.filter(c => c.name.toLowerCase().includes(q) || c.phoneNumber.includes(q));
  }
  const sliced = contacts.slice(options.offset, options.offset + options.size);
  const nextOffset = options.offset + options.size;
  return {
    result: sliced,
    nextOffset: nextOffset < contacts.length ? nextOffset : null,
    done: nextOffset >= contacts.length,
  };
};
export const fetchContacts = withPermission(_fetchContacts, 'contacts');

// --- Clipboard ---

const _getClipboardText = async (): Promise<string> => {
  checkPermission('clipboard', 'getClipboardText');
  const mode = aitState.state.deviceModes.clipboard;
  if (mode === 'mock') return aitState.state.mockData.clipboardText;
  // web mode (default)
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
};
export const getClipboardText = withPermission(_getClipboardText, 'clipboard');

const _setClipboardText = async (text: string): Promise<void> => {
  checkPermission('clipboard', 'setClipboardText');
  const mode = aitState.state.deviceModes.clipboard;
  if (mode === 'mock') {
    aitState.patch('mockData', { clipboardText: text });
    return;
  }
  // web mode (default)
  await navigator.clipboard.writeText(text);
};
export const setClipboardText = withPermission(_setClipboardText, 'clipboard');

// --- Network Status (mode-aware helper for navigation/index.ts) ---

export function getNetworkStatusByMode(): NetworkStatus | null {
  const mode = aitState.state.deviceModes.network;
  if (mode === 'mock') return null; // use default state-based logic
  if (mode === 'web') {
    if (!navigator.onLine) return 'OFFLINE';
    const conn = (navigator as unknown as Record<string, unknown>).connection as { effectiveType?: string } | undefined;
    if (conn?.effectiveType) {
      const mapping: Record<string, NetworkStatus> = { '4g': '4G', '3g': '3G', '2g': '2G', 'slow-2g': '2G' };
      return mapping[conn.effectiveType] ?? 'UNKNOWN';
    }
    return aitState.state.networkStatus;
  }
  // prompt mode: not supported for network, fall back to mock
  return null;
}

// --- Haptic Feedback ---

export function generateHapticFeedback(options: { type: string }): Promise<void> {
  console.log(`[ait-devtools] haptic: ${options.type}`);
  aitState.logAnalytics({ type: 'haptic', params: { hapticType: options.type } });
  return Promise.resolve();
}

// --- Save Base64 ---

export function saveBase64Data(params: { data: string; fileName: string; mimeType: string }): Promise<void> {
  const a = document.createElement('a');
  a.href = `data:${params.mimeType};base64,${params.data}`;
  a.download = params.fileName;
  a.click();
  return Promise.resolve();
}
