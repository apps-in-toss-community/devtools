/**
 * 디바이스 기능 mock
 * Storage, Location, Camera, Photos, Contacts, Clipboard, Haptic
 */

import { aitState, type MockLocation } from '../state.js';
import { createMockProxy } from '../proxy.js';
import { withPermission, checkPermission } from '../permissions.js';

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

const _getCurrentLocation = async (_options?: { accuracy: Accuracy }): Promise<MockLocation> => {
  checkPermission('geolocation', 'getCurrentLocation');
  return buildLocation();
};
export const getCurrentLocation = withPermission(_getCurrentLocation, 'geolocation');

interface StartUpdateLocationEventParams {
  onEvent: (response: MockLocation) => void;
  onError: (error: unknown) => void;
  options: { accuracy: Accuracy; timeInterval: number; distanceInterval: number };
}

function _startUpdateLocation(eventParams: StartUpdateLocationEventParams): () => void {
  const { onEvent, options } = eventParams;
  const interval = Math.max(options.timeInterval, 500);
  const id = setInterval(() => {
    // 약간의 jitter를 추가해서 현실감 있게
    const loc = buildLocation();
    loc.coords.latitude += (Math.random() - 0.5) * 0.0001;
    loc.coords.longitude += (Math.random() - 0.5) * 0.0001;
    onEvent(loc);
  }, interval);
  return () => clearInterval(id);
}

export const startUpdateLocation = Object.assign(_startUpdateLocation, {
  getPermission: () => withPermission(_getCurrentLocation, 'geolocation').getPermission(),
  openPermissionDialog: () => withPermission(_getCurrentLocation, 'geolocation').openPermissionDialog(),
});

// --- Camera ---

const _openCamera = async (options?: { base64?: boolean; maxWidth?: number }): Promise<{ id: string; dataUri: string }> => {
  checkPermission('camera', 'openCamera');

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { reject(new Error('No file selected')); return; }
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          id: crypto.randomUUID(),
          dataUri: reader.result as string,
        });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });
};
export const openCamera = withPermission(_openCamera, 'camera');

// --- Album Photos ---

const _fetchAlbumPhotos = async (options?: { maxCount?: number; maxWidth?: number; base64?: boolean }): Promise<Array<{ id: string; dataUri: string }>> => {
  checkPermission('photos', 'fetchAlbumPhotos');
  const maxCount = options?.maxCount ?? 10;

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
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
};
export const getClipboardText = withPermission(_getClipboardText, 'clipboard');

const _setClipboardText = async (text: string): Promise<void> => {
  checkPermission('clipboard', 'setClipboardText');
  await navigator.clipboard.writeText(text);
};
export const setClipboardText = withPermission(_setClipboardText, 'clipboard');

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
