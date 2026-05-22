/**
 * Camera & Album Photos & Album Items mock
 * mock/web/prompt 모드 지원
 */

import { checkPermission, withPermission } from '../permissions.js';
import { aitState } from '../state.js';
import { getMockImages, waitForPromptResponse } from './_helpers.js';

// --- 타입 ---

export type AlbumItemType = 'PHOTO' | 'VIDEO';

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
    let settled = false;
    input.onchange = () => {
      settled = true;
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ id: crypto.randomUUID(), dataUri: reader.result as string });
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    };
    // Detect file picker cancel via focus heuristic.
    // Note: unreliable on some mobile browsers and Safari where focus events differ.
    const onFocus = () => {
      setTimeout(() => {
        if (!settled) reject(new Error('File picker cancelled'));
        window.removeEventListener('focus', onFocus);
      }, 300);
    };
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

async function openCameraPrompt(): Promise<{ id: string; dataUri: string }> {
  const dataUri = await waitForPromptResponse<string>('camera');
  return { id: crypto.randomUUID(), dataUri };
}

const _openCamera = async (_options?: {
  base64?: boolean;
  maxWidth?: number;
}): Promise<{ id: string; dataUri: string }> => {
  checkPermission('camera', 'openCamera');
  const mode = aitState.state.deviceModes.camera;
  if (mode === 'web') return openCameraWeb();
  if (mode === 'prompt') return openCameraPrompt();
  return openCameraMock();
};
export const openCamera = withPermission(_openCamera, 'camera');

// --- Album Photos ---

async function fetchAlbumPhotosMock(
  maxCount: number,
): Promise<Array<{ id: string; dataUri: string }>> {
  const images = getMockImages();
  return images.slice(0, maxCount).map((dataUri) => ({ id: crypto.randomUUID(), dataUri }));
}

async function fetchAlbumPhotosWeb(
  maxCount: number,
): Promise<Array<{ id: string; dataUri: string }>> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    let settled = false;
    input.onchange = async () => {
      settled = true;
      const files = Array.from(input.files ?? []).slice(0, maxCount);
      if (files.length === 0) {
        reject(new Error('No files selected'));
        return;
      }
      const results = await Promise.all(
        files.map(
          (file) =>
            new Promise<{ id: string; dataUri: string }>((res, rej) => {
              const reader = new FileReader();
              reader.onload = () =>
                res({ id: crypto.randomUUID(), dataUri: reader.result as string });
              reader.onerror = () => rej(new Error('Failed to read file'));
              reader.readAsDataURL(file);
            }),
        ),
      );
      resolve(results);
    };
    const onFocus = () => {
      setTimeout(() => {
        if (!settled) reject(new Error('File picker cancelled'));
        window.removeEventListener('focus', onFocus);
      }, 300);
    };
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

async function fetchAlbumPhotosPrompt(
  maxCount: number,
): Promise<Array<{ id: string; dataUri: string }>> {
  const dataUris = await waitForPromptResponse<string[]>('photos');
  return dataUris.slice(0, maxCount).map((dataUri) => ({ id: crypto.randomUUID(), dataUri }));
}

const _fetchAlbumPhotos = async (options?: {
  maxCount?: number;
  maxWidth?: number;
  base64?: boolean;
}): Promise<Array<{ id: string; dataUri: string }>> => {
  checkPermission('photos', 'fetchAlbumPhotos');
  const maxCount = options?.maxCount ?? 10;
  const mode = aitState.state.deviceModes.photos;
  if (mode === 'web') return fetchAlbumPhotosWeb(maxCount);
  if (mode === 'prompt') return fetchAlbumPhotosPrompt(maxCount);
  return fetchAlbumPhotosMock(maxCount);
};
export const fetchAlbumPhotos = withPermission(_fetchAlbumPhotos, 'photos');

// --- Album Items (사진·동영상 복합 선택) ---

export interface FetchAlbumItemsOptions {
  types?: AlbumItemType[];
  maxCount?: number;
  maxWidth?: number;
  base64?: boolean;
}

export interface AlbumItemResponse {
  id: string;
  dataUri: string;
  type: AlbumItemType;
}

async function fetchAlbumItemsMock(
  maxCount: number,
  types: AlbumItemType[],
): Promise<AlbumItemResponse[]> {
  const images = getMockImages();
  return images
    .slice(0, maxCount)
    .filter(() => types.includes('PHOTO'))
    .map((dataUri) => ({ id: crypto.randomUUID(), dataUri, type: 'PHOTO' as AlbumItemType }));
}

async function fetchAlbumItemsWeb(
  maxCount: number,
  types: AlbumItemType[],
): Promise<AlbumItemResponse[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = types.includes('VIDEO') ? 'image/*,video/*' : 'image/*';
    input.multiple = true;
    let settled = false;
    input.onchange = async () => {
      settled = true;
      const files = Array.from(input.files ?? []).slice(0, maxCount);
      if (files.length === 0) {
        resolve([]);
        return;
      }
      const results = await Promise.all(
        files.map(
          (file) =>
            new Promise<AlbumItemResponse>((res, rej) => {
              const itemType: AlbumItemType = file.type.startsWith('video/') ? 'VIDEO' : 'PHOTO';
              const reader = new FileReader();
              reader.onload = () =>
                res({ id: crypto.randomUUID(), dataUri: reader.result as string, type: itemType });
              reader.onerror = () => rej(new Error('Failed to read file'));
              reader.readAsDataURL(file);
            }),
        ),
      );
      resolve(results);
    };
    const onFocus = () => {
      setTimeout(() => {
        if (!settled) resolve([]);
        window.removeEventListener('focus', onFocus);
      }, 300);
    };
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

async function fetchAlbumItemsPrompt(maxCount: number): Promise<AlbumItemResponse[]> {
  const dataUris = await waitForPromptResponse<string[]>('photos');
  return dataUris
    .slice(0, maxCount)
    .map((dataUri) => ({ id: crypto.randomUUID(), dataUri, type: 'PHOTO' as AlbumItemType }));
}

const _fetchAlbumItems = async (options?: FetchAlbumItemsOptions): Promise<AlbumItemResponse[]> => {
  checkPermission('photos', 'fetchAlbumItems');
  const maxCount = options?.maxCount ?? 10;
  const types = options?.types ?? ['PHOTO'];
  const mode = aitState.state.deviceModes.photos;
  if (mode === 'web') return fetchAlbumItemsWeb(maxCount, types);
  if (mode === 'prompt') return fetchAlbumItemsPrompt(maxCount);
  return fetchAlbumItemsMock(maxCount, types);
};
export const fetchAlbumItems = withPermission(_fetchAlbumItems, 'photos');
