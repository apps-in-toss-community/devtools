import { beforeEach, describe, expect, it } from 'vitest';
import { fetchAlbumPhotos, getDefaultPlaceholderImages, openCamera } from '../mock/device/index.js';
import { aitState } from '../mock/state.js';

describe('Camera & Album Photos mock', () => {
  beforeEach(() => {
    aitState.reset();
  });

  describe('openCamera', () => {
    it('mock 모드에서 placeholder 이미지를 반환한다', async () => {
      const result = await openCamera();
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('dataUri');
      expect(result.dataUri).toMatch(/^data:image\/(png|svg\+xml);base64,/);
    });

    it('mock 모드에서 반환된 이미지가 기본 placeholder 중 첫 번째이다', async () => {
      const placeholders = getDefaultPlaceholderImages();
      const result = await openCamera();
      expect(result.dataUri).toBe(placeholders[0]);
    });

    it('mockData.images가 설정되면 해당 이미지를 사용한다', async () => {
      const customImage = 'data:image/png;base64,customImageData';
      aitState.update({ mockData: { ...aitState.state.mockData, images: [customImage] } });
      const result = await openCamera();
      expect(result.dataUri).toBe(customImage);
    });

    it('mockData.images가 비어있으면 기본 placeholder로 fallback한다', async () => {
      aitState.update({ mockData: { ...aitState.state.mockData, images: [] } });
      const placeholders = getDefaultPlaceholderImages();
      const result = await openCamera();
      expect(result.dataUri).toBe(placeholders[0]);
    });

    it('camera 권한이 denied이면 에러를 throw한다', async () => {
      aitState.patch('permissions', { camera: 'denied' });
      await expect(openCamera()).rejects.toThrow('denied');
    });

    it('getPermission()이 부착되어 있다', async () => {
      expect(typeof openCamera.getPermission).toBe('function');
      const status = await openCamera.getPermission();
      expect(status).toBe('allowed');
    });

    it('openPermissionDialog()가 부착되어 있다', async () => {
      expect(typeof openCamera.openPermissionDialog).toBe('function');
      const result = await openCamera.openPermissionDialog();
      expect(result).toBe('allowed');
    });

    it('getPermission()이 denied 상태를 반환한다', async () => {
      aitState.patch('permissions', { camera: 'denied' });
      const status = await openCamera.getPermission();
      expect(status).toBe('denied');
    });

    it('openPermissionDialog()가 denied를 allowed로 전환한다', async () => {
      aitState.patch('permissions', { camera: 'denied' });
      const result = await openCamera.openPermissionDialog();
      expect(result).toBe('allowed');
      expect(aitState.state.permissions.camera).toBe('allowed');
    });
  });

  describe('fetchAlbumPhotos', () => {
    it('mock 모드에서 placeholder 이미지 배열을 반환한다', async () => {
      const result = await fetchAlbumPhotos();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      result.forEach((item) => {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('dataUri');
        expect(item.dataUri).toMatch(/^data:image\/(png|svg\+xml);base64,/);
      });
    });

    it('maxCount 파라미터로 반환 개수를 제한한다', async () => {
      const result = await fetchAlbumPhotos({ maxCount: 1 });
      expect(result).toHaveLength(1);
    });

    it('maxCount를 지정하지 않으면 기본값 10이 적용된다 (placeholder는 3개이므로 3개 반환)', async () => {
      const result = await fetchAlbumPhotos();
      const placeholders = getDefaultPlaceholderImages();
      expect(result).toHaveLength(placeholders.length);
    });

    it('maxCount가 이미지 수보다 크면 가능한 만큼만 반환한다', async () => {
      const result = await fetchAlbumPhotos({ maxCount: 100 });
      const placeholders = getDefaultPlaceholderImages();
      expect(result).toHaveLength(placeholders.length);
    });

    it('photos 권한이 denied이면 에러를 throw한다', async () => {
      aitState.patch('permissions', { photos: 'denied' });
      await expect(fetchAlbumPhotos()).rejects.toThrow('denied');
    });

    it('getPermission()이 부착되어 있다', async () => {
      expect(typeof fetchAlbumPhotos.getPermission).toBe('function');
      const status = await fetchAlbumPhotos.getPermission();
      expect(status).toBe('allowed');
    });

    it('openPermissionDialog()가 부착되어 있다', async () => {
      expect(typeof fetchAlbumPhotos.openPermissionDialog).toBe('function');
      const result = await fetchAlbumPhotos.openPermissionDialog();
      expect(result).toBe('allowed');
    });

    it('각 항목의 id가 고유하다', async () => {
      const result = await fetchAlbumPhotos({ maxCount: 3 });
      const ids = result.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('mockData.images가 설정되면 해당 이미지를 사용한다', async () => {
      const customImages = ['data:image/png;base64,img1', 'data:image/png;base64,img2'];
      aitState.update({ mockData: { ...aitState.state.mockData, images: customImages } });
      const result = await fetchAlbumPhotos({ maxCount: 5 });
      expect(result).toHaveLength(2);
      expect(result[0].dataUri).toBe(customImages[0]);
      expect(result[1].dataUri).toBe(customImages[1]);
    });
  });
});
