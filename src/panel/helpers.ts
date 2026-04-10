/**
 * 공통 DOM 헬퍼 함수
 */

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') el.className = v;
      else el.setAttribute(k, v);
    }
  }
  for (const child of children) {
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

export function selectRow(
  label: string,
  options: string[],
  value: string,
  onChange: (v: string) => void,
  disabled = false,
): HTMLElement {
  const select = h('select', { className: 'ait-select' });
  if (disabled) select.disabled = true;
  for (const opt of options) {
    const option = h('option', { value: opt }, opt);
    if (opt === value) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  return h('div', { className: 'ait-row' }, h('label', {}, label), select);
}

export function inputRow(label: string, value: string, onChange: (v: string) => void, disabled = false): HTMLElement {
  const input = h('input', { className: 'ait-input', value });
  if (disabled) input.disabled = true;
  input.addEventListener('change', () => onChange(input.value));
  return h('div', { className: 'ait-row' }, h('label', {}, label), input);
}

export function monitoringNotice(): HTMLElement {
  return h('div', { className: 'ait-monitoring-notice' },
    'Read-only — mock responses are controlled at build time.',
  );
}
