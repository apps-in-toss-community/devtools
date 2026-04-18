// DOM helpers that enforce the testid convention used by e2e/panel.test.ts.
//
// testid 규약:
//   section-<id>   — 도메인 섹션 <section> 루트
//   <id>-btn       — API 실행 버튼
//   <id>-result    — 실행 결과 표시 영역 (.textContent)
//   <id>-input     — 사용자 입력 필드
//   <id>-value     — 페이지 로드 시 즉시 표시되는 읽기 전용 값
//   <id>-log       — 구독형 이벤트 수신 로그 컨테이너
//   <id>-empty     — 구독형 로그의 empty state sentinel
//
// id는 dash-case 권장. 동일 id가 여러 도메인에서 재사용되면 안 된다.

export function apiSection(parent: HTMLElement, id: string, title: string): HTMLElement {
  const section = document.createElement('section');
  section.setAttribute('data-testid', `section-${id}`);
  const heading = document.createElement('h2');
  heading.textContent = title;
  section.appendChild(heading);
  parent.appendChild(section);
  return section;
}

export interface ApiButtonOptions<T> {
  label?: string;
  formatResult?: (value: T) => string;
  withInputs?: string[];
}

export function apiButton<T = unknown>(
  parent: HTMLElement,
  id: string,
  run: (values: Record<string, string>) => Promise<T> | T,
  opts: ApiButtonOptions<T> = {},
): void {
  const row = document.createElement('div');
  row.className = 'row';

  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-testid', `${id}-btn`);
  button.textContent = opts.label ?? id;
  row.appendChild(button);

  const result = document.createElement('div');
  result.className = 'result';
  result.setAttribute('data-testid', `${id}-result`);
  row.appendChild(result);

  parent.appendChild(row);

  button.addEventListener('click', async () => {
    const values: Record<string, string> = {};
    for (const inputId of opts.withInputs ?? []) {
      const el = document.querySelector<HTMLInputElement>(`[data-testid="${inputId}-input"]`);
      values[inputId] = el?.value ?? '';
    }
    try {
      const value = await run(values);
      if (opts.formatResult) {
        result.textContent = opts.formatResult(value);
      } else if (value === undefined || value === null) {
        result.textContent = 'done';
      } else if (typeof value === 'object') {
        result.textContent = JSON.stringify(value);
      } else {
        result.textContent = String(value);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.textContent = `error:${msg}`;
    }
  });
}

export function apiInput(parent: HTMLElement, id: string, label: string): void {
  const row = document.createElement('div');
  row.className = 'row';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  row.appendChild(lbl);

  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('data-testid', `${id}-input`);
  row.appendChild(input);

  parent.appendChild(row);
}

export function apiValue(parent: HTMLElement, id: string, label: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  row.appendChild(lbl);

  const value = document.createElement('span');
  value.className = 'value';
  value.setAttribute('data-testid', `${id}-value`);
  row.appendChild(value);

  parent.appendChild(row);
  return value;
}

export interface ApiSubscriberOptions {
  label?: string;
}

export function apiSubscriber(
  parent: HTMLElement,
  id: string,
  subscribe: (onEvent: (payload: unknown) => void) => void,
  opts: ApiSubscriberOptions = {},
): void {
  const row = document.createElement('div');
  row.className = 'row';

  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-testid', `${id}-btn`);
  button.textContent = opts.label ?? `subscribe ${id}`;
  row.appendChild(button);

  const empty = document.createElement('span');
  empty.setAttribute('data-testid', `${id}-empty`);
  empty.textContent = '(no events)';
  row.appendChild(empty);

  const log = document.createElement('div');
  log.setAttribute('data-testid', `${id}-log`);
  row.appendChild(log);

  parent.appendChild(row);

  button.addEventListener(
    'click',
    () => {
      subscribe((payload) => {
        if (empty.isConnected) empty.remove(); // idempotent: subsequent events are no-ops
        const entry = document.createElement('div');
        entry.textContent = payload === undefined ? '(event)' : JSON.stringify(payload);
        log.appendChild(entry);
      });
      button.disabled = true;
    },
    { once: true },
  );
}
