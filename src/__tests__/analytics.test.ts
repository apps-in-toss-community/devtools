import { describe, it, expect, beforeEach } from 'vitest';
import { aitState } from '../mock/state.js';
import { Analytics, eventLog } from '../mock/analytics/index.js';

describe('Analytics mock', () => {
  beforeEach(() => {
    aitState.reset();
  });

  it('Analytics.screen: analyticsLog에 screen 타입으로 기록된다', async () => {
    await Analytics.screen({ log_name: 'home' });
    const logs = aitState.state.analyticsLog;
    expect(logs).toHaveLength(1);
    expect(logs[0].type).toBe('screen');
    expect(logs[0].params).toEqual({ log_name: 'home' });
  });

  it('Analytics.impression: analyticsLog에 impression 타입으로 기록된다', async () => {
    await Analytics.impression({ log_name: 'banner', position: 1 });
    const logs = aitState.state.analyticsLog;
    expect(logs).toHaveLength(1);
    expect(logs[0].type).toBe('impression');
    expect(logs[0].params).toEqual({ log_name: 'banner', position: 1 });
  });

  it('Analytics.click: analyticsLog에 click 타입으로 기록된다', async () => {
    await Analytics.click({ log_name: 'cta_button' });
    const logs = aitState.state.analyticsLog;
    expect(logs).toHaveLength(1);
    expect(logs[0].type).toBe('click');
  });

  it('eventLog: log_type과 params가 정확히 기록된다', async () => {
    await eventLog({
      log_name: 'purchase',
      log_type: 'event',
      params: { item: 'gem', count: 100 },
    });
    const logs = aitState.state.analyticsLog;
    expect(logs).toHaveLength(1);
    expect(logs[0].type).toBe('event');
    expect(logs[0].params).toEqual({ log_name: 'purchase', item: 'gem', count: 100 });
  });

  it('여러 이벤트가 순서대로 쌓인다', async () => {
    await Analytics.screen({ log_name: 'page1' });
    await Analytics.click({ log_name: 'btn1' });
    await eventLog({ log_name: 'custom', log_type: 'info', params: {} });

    expect(aitState.state.analyticsLog).toHaveLength(3);
    expect(aitState.state.analyticsLog.map(l => l.type)).toEqual(['screen', 'click', 'info']);
  });
});
