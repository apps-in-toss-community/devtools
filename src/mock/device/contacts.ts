/**
 * Contacts mock
 */

import type { PermissionStatus } from '@apps-in-toss/web-framework';
import { checkPermission } from '../permissions.js';
import { aitState } from '../state.js';

const _fetchContacts = async (options: {
  size: number;
  offset: number;
  query?: { contains?: string };
}) => {
  checkPermission('contacts', 'fetchContacts');
  let contacts = aitState.state.contacts;
  if (options.query?.contains) {
    const q = options.query.contains.toLowerCase();
    contacts = contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phoneNumber.includes(q),
    );
  }
  const sliced = contacts.slice(options.offset, options.offset + options.size);
  const nextOffset = options.offset + options.size;
  return {
    result: sliced,
    nextOffset: nextOffset < contacts.length ? nextOffset : null,
    done: nextOffset >= contacts.length,
  };
};

/**
 * 상류 SDK는 `fetchContacts`의 타입에 `.getPermission`/`.openPermissionDialog`를
 * `PermissionFunctionWithDialog`로 선언하지만, 실기기(2.x×iOS)에는 그 메서드가
 * **런타임에 붙어 있지 않다**(devtools#795 — 호출 시 `fetchContacts.getPermission
 * is not a function` native `TypeError`). standalone `getPermission({name:
 * 'contacts', access: 'access'})`는 실기기에서 정상 resolve하므로(env3 run11,
 * `../permissions.ts`) 부재는 fetchContacts에 **부착된** 메서드에만 해당하는
 * 상류 타입↔런타임 불일치다.
 *
 * mock은 다른 device API처럼 `withPermission()`으로 감싸지 않고, bare async fn을
 * 상류 시그니처로만 캐스트한다 — `.getPermission`/`.openPermissionDialog` 접근은
 * `undefined`가 되고, 호출하면 `undefined()` → native `TypeError`로 떨어져
 * 실기기와 일치한다(`__typecheck.ts`/`__typecheck-2x.ts`는 캐스트 타입에 두
 * 메서드가 여전히 남아 있어 그대로 통과). `_fetchContacts` 내부에서 이미
 * `checkPermission`을 호출하므로 메인 동작(권한 거부 시
 * `FetchContactsPermissionError`)은 변화 없다.
 *
 * 직접 관측된 것은 `getPermission` 부재뿐이다. `openPermissionDialog` 부재는
 * "상류가 fetchContacts에 권한 헬퍼 전체를 붙이지 않는다"는 합리적 추론이지
 * 별도 실측은 아니다. 다른 `withPermission` API(clipboard/camera/location)로는
 * 이 부재를 확장하지 않는다 — 그쪽 부착 메서드가 실기기에서 없다는 관측은
 * 없다(#783 "측정 밖 확장 금지" 원칙).
 */
export const fetchContacts = _fetchContacts as typeof _fetchContacts & {
  getPermission: () => Promise<PermissionStatus>;
  openPermissionDialog: () => Promise<'allowed' | 'denied'>;
};
