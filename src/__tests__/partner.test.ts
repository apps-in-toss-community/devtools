import { describe, expect, it } from 'vitest';
import { partner } from '../mock/partner/index.js';

describe('Partner mock', () => {
  it('addAccessoryButton: 에러 없이 실행된다', async () => {
    await expect(
      partner.addAccessoryButton({ id: 'btn1', title: 'Test', icon: { name: 'star' } }),
    ).resolves.toBeUndefined();
  });

  it('removeAccessoryButton: 에러 없이 실행된다', async () => {
    await expect(partner.removeAccessoryButton()).resolves.toBeUndefined();
  });
});
