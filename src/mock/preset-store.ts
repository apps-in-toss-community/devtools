/**
 * 사용자 저장 preset CRUD. localStorage `__ait_preset:<id>` 한 키당 하나로 저장한다.
 * 패널-내부 storage(`__ait_btn_pos`, `__ait_device_id`, `__ait_storage:`)와 같은
 * 패턴 — 새 storage 도입 없음.
 *
 * 외부 의존성 0. SSR 환경(Node)에서 import만 되어도 안전하도록 모든 접근은
 * `localStorage` 존재 여부를 확인한다.
 */

import type { MockPreset, MockPresetState } from './presets.js';

const PREFIX = '__ait_preset:';

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Storage에서 읽은 임의 JSON을 MockPreset으로 검증. id/label 필수, state는
 * object여야 함. 실패하면 null — caller가 storage entry를 무시하거나 정리하면 된다.
 *
 * `state`의 내부 키/값은 검증하지 않는다. `applyPreset`이 `pickKnownKeys`로
 * 키만 거른 뒤 그대로 state에 패치하므로 잘못된 enum 값이 통과될 수 있지만,
 * mock state라 보안 위협은 없다 — 새 enum 값이 추가됐을 때 저장된 preset을
 * reject하지 않으려는 의도.
 */
function parsePreset(raw: string): MockPreset | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return null;
    const { id, label, description, state } = parsed;
    if (typeof id !== 'string' || id.length === 0) return null;
    if (typeof label !== 'string' || label.length === 0) return null;
    if (!isObject(state)) return null;
    return {
      id,
      label,
      description: typeof description === 'string' ? description : undefined,
      state: state as MockPresetState,
    };
  } catch {
    return null;
  }
}

export function listUserPresets(): MockPreset[] {
  const ls = safeLocalStorage();
  if (!ls) return [];
  const out: MockPreset[] = [];
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const raw = ls.getItem(key);
    if (!raw) continue;
    const preset = parsePreset(raw);
    if (preset) out.push(preset);
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Preset을 저장한다. label에서 slug를 derive — 같은 slug가 이미 있으면 `-2`, `-3`
 * suffix를 붙여 새 entry를 만든다 (기존 entry 덮어쓰기 아님). UI는 label만 받으면 된다.
 *
 * Throws:
 * - label trim한 뒤 빈 문자열일 때
 * - localStorage 미가용 환경일 때 (SSR 등)
 * - `setItem` 실패 (`QuotaExceededError` 등) — caller가 처리해야 함
 */
export function saveUserPreset(
  label: string,
  state: MockPresetState,
  description?: string,
): MockPreset {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    throw new Error('Preset label cannot be empty');
  }
  const ls = safeLocalStorage();
  if (!ls) throw new Error('localStorage not available');
  const id = generateId(trimmed, ls);
  const preset: MockPreset = {
    id,
    label: trimmed,
    state,
    ...(description !== undefined && description.length > 0 ? { description } : {}),
  };
  ls.setItem(PREFIX + id, JSON.stringify(preset));
  return preset;
}

export function deleteUserPreset(id: string): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  ls.removeItem(PREFIX + id);
}

/** 충돌 시 `-2`, `-3` 등 suffix를 붙여 unique한 id 만든다. */
function generateId(label: string, ls: Storage): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'preset';
  let candidate = base;
  let n = 2;
  while (ls.getItem(PREFIX + candidate) !== null) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}
