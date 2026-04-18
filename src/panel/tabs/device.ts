import { getDefaultPlaceholderImages } from '../../mock/device/index.js';
import { aitState } from '../../mock/state.js';
import { h, monitoringNotice, selectRow } from '../helpers.js';

// --- Prompt mode state ---
interface PendingPrompt {
  type: string;
}
let pendingPrompt: PendingPrompt | null = null;

let refreshPanel: () => void = () => {};

export function setDeviceRefreshPanel(fn: () => void) {
  refreshPanel = fn;
}

// Listen for prompt requests from device APIs
if (typeof window !== 'undefined') {
  window.addEventListener('__ait:prompt-request', (e: Event) => {
    const detail = (e as CustomEvent).detail as { type: string };
    pendingPrompt = { type: detail.type };
    // Auto-switch to device tab and open panel — handled by index.ts listener which also calls refreshPanel
    window.dispatchEvent(new CustomEvent('__ait:panel-switch-tab', { detail: { tab: 'device' } }));
  });
}

function resolvePrompt(type: string, data: unknown) {
  window.dispatchEvent(new CustomEvent(`__ait:prompt-response:${type}`, { detail: data }));
  pendingPrompt = null;
  refreshPanel();
}

function renderPromptBanner(): HTMLElement | null {
  if (!pendingPrompt) return null;

  const banner = h('div', { className: 'ait-prompt-banner' });

  if (pendingPrompt.type === 'camera') {
    banner.append(h('div', { className: 'ait-prompt-title' }, 'Camera Prompt — Select an image'));
    const input = h('input', {
      type: 'file',
      accept: 'image/*',
      style: 'font-size:11px;color:#aaa',
    });
    input.addEventListener('change', () => {
      const file = (input as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => resolvePrompt('camera', reader.result as string);
      reader.readAsDataURL(file);
    });
    banner.appendChild(input);
  } else if (pendingPrompt.type === 'photos') {
    banner.append(h('div', { className: 'ait-prompt-title' }, 'Photos Prompt — Select images'));
    const input = h('input', {
      type: 'file',
      accept: 'image/*',
      multiple: '',
      style: 'font-size:11px;color:#aaa',
    });
    input.addEventListener('change', () => {
      const files = Array.from((input as HTMLInputElement).files ?? []);
      if (files.length === 0) return;
      Promise.all(
        files.map(
          (file) =>
            new Promise<string>((res) => {
              const reader = new FileReader();
              reader.onload = () => res(reader.result as string);
              reader.readAsDataURL(file);
            }),
        ),
      ).then((dataUris) => resolvePrompt('photos', dataUris));
    });
    banner.appendChild(input);
  } else if (pendingPrompt.type === 'location' || pendingPrompt.type === 'location-update') {
    banner.append(
      h(
        'div',
        { className: 'ait-prompt-title' },
        pendingPrompt.type === 'location'
          ? 'Location Prompt — Enter coordinates'
          : 'Location Update — Send coordinates',
      ),
    );
    const latInput = h('input', {
      className: 'ait-input',
      value: String(aitState.state.location.coords.latitude),
      style: 'width:80px',
    });
    const lngInput = h('input', {
      className: 'ait-input',
      value: String(aitState.state.location.coords.longitude),
      style: 'width:80px',
    });
    const sendBtn = h('button', { className: 'ait-btn ait-btn-sm' }, 'Send');
    sendBtn.addEventListener('click', () => {
      const loc = {
        coords: {
          latitude: Number((latInput as HTMLInputElement).value),
          longitude: Number((lngInput as HTMLInputElement).value),
          altitude: 0,
          accuracy: 10,
          altitudeAccuracy: 0,
          heading: 0,
        },
        timestamp: Date.now(),
        accessLocation: 'FINE' as const,
      };
      resolvePrompt(pendingPrompt!.type, loc);
    });
    banner.append(
      h(
        'div',
        { className: 'ait-prompt-input-row' },
        h('label', {}, 'Lat'),
        latInput,
        h('label', {}, 'Lng'),
        lngInput,
        sendBtn,
      ),
    );
  } else {
    // Fallback for unknown prompt types
    banner.append(h('div', { className: 'ait-prompt-title' }, `Prompt: ${pendingPrompt.type}`));
  }

  // Cancel button for all prompt types
  const cancelBtn = h(
    'button',
    { className: 'ait-btn ait-btn-sm ait-btn-danger', style: 'margin-top:8px' },
    'Cancel',
  );
  cancelBtn.addEventListener('click', () => {
    pendingPrompt = null;
    window.dispatchEvent(new CustomEvent('__ait:prompt-cancel'));
    refreshPanel();
  });
  banner.appendChild(cancelBtn);

  return banner;
}

export function renderDeviceTab(): HTMLElement {
  const s = aitState.state;
  const disabled = !s.panelEditable;
  const container = h('div');

  if (disabled) container.appendChild(monitoringNotice());

  // Prompt banner (if active, only when panelEditable)
  if (s.panelEditable) {
    const promptBanner = renderPromptBanner();
    if (promptBanner) container.appendChild(promptBanner);
  }

  // Device API Mode selectors
  const modeEntries: Array<{ label: string; key: keyof typeof s.deviceModes; options: string[] }> =
    [
      { label: 'Camera', key: 'camera', options: ['mock', 'web', 'prompt'] },
      { label: 'Photos', key: 'photos', options: ['mock', 'web', 'prompt'] },
      { label: 'Location', key: 'location', options: ['mock', 'web', 'prompt'] },
      { label: 'Network', key: 'network', options: ['mock', 'web'] },
      { label: 'Clipboard', key: 'clipboard', options: ['mock', 'web'] },
    ];

  container.append(
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Device API Modes'),
      ...modeEntries.map((entry) =>
        selectRow(
          entry.label,
          entry.options,
          s.deviceModes[entry.key],
          (v) => {
            aitState.patch('deviceModes', { [entry.key]: v } as Partial<typeof s.deviceModes>);
          },
          disabled,
        ),
      ),
    ),
  );

  // Mock Images management
  const images = s.mockData.images;
  const imageGrid = h('div', { className: 'ait-image-grid' });
  images.forEach((dataUri, idx) => {
    const thumb = h('div', { className: 'ait-image-thumb' });
    const img = h('img', { src: dataUri });
    const removeBtn = h('button', { className: 'ait-image-remove' }, 'x');
    removeBtn.addEventListener('click', () => {
      const newImages = [...aitState.state.mockData.images];
      newImages.splice(idx, 1);
      aitState.patch('mockData', { images: newImages });
    });
    if (disabled) removeBtn.disabled = true;
    thumb.append(img, removeBtn);
    imageGrid.appendChild(thumb);
  });

  const addBtn = h('button', { className: 'ait-btn-secondary' }, '+ Add');
  addBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      Promise.all(
        files.map(
          (file) =>
            new Promise<string>((res) => {
              const reader = new FileReader();
              reader.onload = () => res(reader.result as string);
              reader.readAsDataURL(file);
            }),
        ),
      ).then((dataUris) => {
        aitState.patch('mockData', { images: [...aitState.state.mockData.images, ...dataUris] });
      });
    };
    input.click();
  });
  if (disabled) addBtn.disabled = true;

  const defaultsBtn = h('button', { className: 'ait-btn-secondary' }, 'Use defaults');
  defaultsBtn.addEventListener('click', () => {
    aitState.patch('mockData', { images: [...getDefaultPlaceholderImages()] });
  });
  if (disabled) defaultsBtn.disabled = true;

  const clearImagesBtn = h('button', { className: 'ait-btn-secondary' }, 'Clear');
  clearImagesBtn.addEventListener('click', () => {
    aitState.patch('mockData', { images: [] });
  });
  if (disabled) clearImagesBtn.disabled = true;

  container.append(
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, `Mock Images (${images.length})`),
      imageGrid,
      h('div', { className: 'ait-btn-row' }, addBtn, defaultsBtn, clearImagesBtn),
    ),
  );

  return container;
}
