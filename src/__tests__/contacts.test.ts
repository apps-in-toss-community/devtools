import { beforeEach, describe, expect, it } from 'vitest';
import { fetchContacts } from '../mock/device/index.js';
import { FetchContactsPermissionError, PermissionError } from '../mock/permissions.js';
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

    it('contacts 권한이 denied이면 FetchContactsPermissionError를 throw한다', async () => {
      aitState.patch('permissions', { contacts: 'denied' });
      await expect(fetchContacts({ size: 10, offset: 0 })).rejects.toThrow(
        FetchContactsPermissionError,
      );
      await expect(fetchContacts({ size: 10, offset: 0 })).rejects.toThrow(PermissionError);
    });

    // devtools#795: 실기기(2.x×iOS)엔 fetchContacts에 .getPermission/.openPermissionDialog가
    // 런타임에 붙어있지 않다 — 상류가 타입에만 선언하고 런타임엔 부착하지 않는
    // type↔runtime 불일치. mock도 bare fn으로 두어(#775 원칙 확장) 접근 시
    // undefined, 호출 시 native TypeError로 떨어지는 실기기 동작을 그대로 재현한다.
    // (이 테스트가 과거 재현하던 "resolved" 동작은 비충실했다 — standalone
    // getPermission({name:'contacts'})는 여전히 resolved다, permissions.test.ts 참조.)
    it('getPermission이 부착되어 있지 않다 (실기기 실측)', () => {
      expect(fetchContacts.getPermission).toBeUndefined();
    });

    it('getPermission() 호출은 native TypeError를 던진다 (실기기 실측)', () => {
      expect(() => fetchContacts.getPermission()).toThrow(TypeError);
    });

    it('openPermissionDialog이 부착되어 있지 않다 (측정 밖 추론 — #783)', () => {
      expect(fetchContacts.openPermissionDialog).toBeUndefined();
    });

    it('openPermissionDialog() 호출은 native TypeError를 던진다 (측정 밖 추론 — #783)', () => {
      expect(() => fetchContacts.openPermissionDialog()).toThrow(TypeError);
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
