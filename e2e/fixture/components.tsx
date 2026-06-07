// React components that emit the e2e fixture's testid contract.
//
// Each component emits a DOM structure byte-identical to the previous vanilla
// DOM helpers so every data-testid contract (section-<id>, <id>-btn,
// <id>-result, <id>-input, <id>-value, <id>-log, <id>-empty) is preserved
// unchanged. The e2e suite in panel.test.ts must pass without any modification.

import { useCallback, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// ApiSection
// ---------------------------------------------------------------------------

interface ApiSectionProps {
  id: string;
  title: string;
  children: React.ReactNode;
}

export function ApiSection({ id, title, children }: ApiSectionProps): React.JSX.Element {
  return (
    <section data-testid={`section-${id}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ApiButton
// ---------------------------------------------------------------------------

interface ApiButtonProps<T = unknown> {
  id: string;
  label?: string;
  run: (values: Record<string, string>) => Promise<T> | T;
  formatResult?: (value: T) => string;
  withInputs?: string[];
}

function formatValue<T>(value: T, formatResult?: (v: T) => string): string {
  if (formatResult) return formatResult(value);
  if (value === undefined || value === null) return 'done';
  if (value === '') return '(empty)'; // avoids not.toBeEmpty() false-timeout on empty string
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function ApiButton<T = unknown>({
  id,
  label,
  run,
  formatResult,
  withInputs,
}: ApiButtonProps<T>): React.JSX.Element {
  const [result, setResult] = useState('');

  const handleClick = useCallback(async () => {
    const values: Record<string, string> = {};
    for (const inputId of withInputs ?? []) {
      const el = document.querySelector<HTMLInputElement>(`[data-testid="${inputId}-input"]`);
      values[inputId] = el?.value ?? '';
    }
    try {
      const value = await run(values);
      setResult(formatValue(value, formatResult));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult(`error:${msg}`);
    }
  }, [run, formatResult, withInputs]);

  return (
    <div className="row">
      <button type="button" data-testid={`${id}-btn`} onClick={() => void handleClick()}>
        {label ?? id}
      </button>
      <div className="result" data-testid={`${id}-result`}>
        {result}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ApiInput
// ---------------------------------------------------------------------------

interface ApiInputProps {
  id: string;
  label: string;
}

export function ApiInput({ id, label }: ApiInputProps): React.JSX.Element {
  // Uncontrolled input — withInputs in ApiButton reads the DOM value directly,
  // matching the vanilla helper's document.querySelector approach.
  const inputId = `${id}-input-label`;
  return (
    <div className="row">
      <label htmlFor={inputId}>{label}</label>
      <input type="text" id={inputId} data-testid={`${id}-input`} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ApiValue
// ---------------------------------------------------------------------------

interface ApiValueProps {
  id: string;
  label: string;
  value: string;
}

export function ApiValue({ id, label, value }: ApiValueProps): React.JSX.Element {
  return (
    <div className="row">
      <span className="label">{label}</span>
      <span className="value" data-testid={`${id}-value`}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ApiSubscriber
// ---------------------------------------------------------------------------

interface ApiSubscriberProps {
  id: string;
  label?: string;
  subscribe: (onEvent: (payload: unknown) => void) => void;
}

interface LogEntry {
  key: number;
  text: string;
}

export function ApiSubscriber({ id, label, subscribe }: ApiSubscriberProps): React.JSX.Element {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [subscribed, setSubscribed] = useState(false);
  const keyRef = useRef(0);

  const handleClick = useCallback(() => {
    subscribe((payload) => {
      setEntries((prev) => [
        ...prev,
        {
          key: ++keyRef.current,
          text: payload === undefined ? '(event)' : JSON.stringify(payload),
        },
      ]);
    });
    // { once: true } semantics: disable button after first click.
    setSubscribed(true);
  }, [subscribe]);

  const showEmpty = entries.length === 0;

  return (
    <div className="row">
      <button type="button" data-testid={`${id}-btn`} disabled={subscribed} onClick={handleClick}>
        {label ?? `subscribe ${id}`}
      </button>
      {showEmpty && <span data-testid={`${id}-empty`}>(no events)</span>}
      <div data-testid={`${id}-log`}>
        {entries.map((e) => (
          <div key={e.key}>{e.text}</div>
        ))}
      </div>
    </div>
  );
}
