import { beforeEach, describe, expect, it } from 'vitest';
import { fetchContacts } from '../mock/device/index.js';
import { aitState } from '../mock/state.js';

describe('Contacts mock', () => {
  beforeEach(() => {
    aitState.reset();
  });

  describe('fetchContacts', () => {
    it('mock 모드에서 state.contacts를 반환한다', async () => {
      const result = await fetchContacts({ size: 10, offset: 0 });
      expect(result.result).toHaveLength(2);
      expect(result.result[0]).toEqual({ name: '홍길동', phoneNumber: '010-1234-5678' });
      expect(result.result[1]).toEqual({ name: '김토스', phoneNumber: '010-9876-5432' });
    });

    it('contacts 권한이 denied이면 에러를 throw한다', async () => {
      aitState.patch('permissions', { contacts: 'denied' });
      await expect(fetchContacts({ size: 10, offset: 0 })).rejects.toThrow('denied');
    });

    it('getPermission()이 부착되어 있다', async () => {
      expect(typeof fetchContacts.getPermission).toBe('function');
      const status = await fetchContacts.getPermission();
      expect(status).toBe('allowed');
    });

    it('openPermissionDialog()가 부착되어 있다', async () => {
      expect(typeof fetchContacts.openPermissionDialog).toBe('function');
      const result = await fetchContacts.openPermissionDialog();
      expect(result).toBe('allowed');
    });

    it('getPermission()이 denied 상태를 반환한다', async () => {
      aitState.patch('permissions', { contacts: 'denied' });
      const status = await fetchContacts.getPermission();
      expect(status).toBe('denied');
    });

    it('openPermissionDialog()가 denied를 allowed로 전환한다', async () => {
      aitState.patch('permissions', { contacts: 'denied' });
      const result = await fetchContacts.openPermissionDialog();
      expect(result).toBe('allowed');
      expect(aitState.state.permissions.contacts).toBe('allowed');
    });

    it('빈 contacts 배열일 때 빈 결과를 반환한다', async () => {
      aitState.update({ contacts: [] });
      const result = await fetchContacts({ size: 10, offset: 0 });
      expect(result.result).toHaveLength(0);
      expect(result.done).toBe(true);
      expect(result.nextOffset).toBeNull();
    });

    it('size로 페이지네이션이 동작한다', async () => {
      const page1 = await fetchContacts({ size: 1, offset: 0 });
      expect(page1.result).toHaveLength(1);
      expect(page1.result[0].name).toBe('홍길동');
      expect(page1.done).toBe(false);
      expect(page1.nextOffset).toBe(1);

      const page2 = await fetchContacts({ size: 1, offset: page1.nextOffset! });
      expect(page2.result).toHaveLength(1);
      expect(page2.result[0].name).toBe('김토스');
      expect(page2.done).toBe(true);
      expect(page2.nextOffset).toBeNull();
    });

    it('query.contains로 이름 검색이 동작한다', async () => {
      const result = await fetchContacts({ size: 10, offset: 0, query: { contains: '홍' } });
      expect(result.result).toHaveLength(1);
      expect(result.result[0].name).toBe('홍길동');
    });

    it('query.contains로 전화번호 검색이 동작한다', async () => {
      const result = await fetchContacts({ size: 10, offset: 0, query: { contains: '9876' } });
      expect(result.result).toHaveLength(1);
      expect(result.result[0].name).toBe('김토스');
    });

    it('query.contains 검색 결과가 없으면 빈 배열을 반환한다', async () => {
      const result = await fetchContacts({ size: 10, offset: 0, query: { contains: '없는이름' } });
      expect(result.result).toHaveLength(0);
      expect(result.done).toBe(true);
    });

    it('query.contains와 페이지네이션이 함께 동작한다', async () => {
      aitState.update({
        contacts: [
          { name: '이토스', phoneNumber: '010-1111-1111' },
          { name: '박토스', phoneNumber: '010-2222-2222' },
          { name: '홍길동', phoneNumber: '010-3333-3333' },
        ],
      });
      const page1 = await fetchContacts({ size: 1, offset: 0, query: { contains: '토스' } });
      expect(page1.result).toHaveLength(1);
      expect(page1.result[0].name).toBe('이토스');
      expect(page1.done).toBe(false);

      const page2 = await fetchContacts({
        size: 1,
        offset: page1.nextOffset!,
        query: { contains: '토스' },
      });
      expect(page2.result).toHaveLength(1);
      expect(page2.result[0].name).toBe('박토스');
      expect(page2.done).toBe(true);
    });
  });
});
