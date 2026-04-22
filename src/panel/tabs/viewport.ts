import { aitState } from '../../mock/state.js';
import type { LandscapeSide, ViewportOrientation, ViewportPresetId } from '../../mock/types.js';
import { h, monitoringNotice } from '../helpers.js';
import {
  AIT_NAV_BAR_HEIGHT,
  clampCustomDimension,
  computeSafeAreaInsets,
  effectiveOrientation,
  getPreset,
  resolveViewportSize,
  VIEWPORT_PRESETS,
} from '../viewport.js';

export function renderViewportTab(): HTMLElement {
  const s = aitState.state;
  const vp = s.viewport;
  const disabled = !s.panelEditable;
  const container = h('div');

  if (disabled) container.appendChild(monitoringNotice());

  // --- Preset selector ---
  const presetSelect = h('select', { className: 'ait-select' });
  if (disabled) presetSelect.disabled = true;
  for (const preset of VIEWPORT_PRESETS) {
    const label =
      preset.id === 'none' || preset.id === 'custom'
        ? preset.label
        : `${preset.label} (${preset.width}×${preset.height})`;
    const option = h('option', { value: preset.id }, label);
    if (preset.id === vp.preset) option.selected = true;
    presetSelect.appendChild(option);
  }
  presetSelect.addEventListener('change', () => {
    const id = presetSelect.value as ViewportPresetId;
    const patch: Partial<typeof vp> = { preset: id };
    // custom으로 전환할 때 현재 선택값을 custom 필드의 시드로 복사해둔다.
    if (id === 'custom') {
      const current = getPreset(vp.preset);
      if (current.width > 0) patch.customWidth = current.width;
      if (current.height > 0) patch.customHeight = current.height;
    }
    aitState.patch('viewport', patch);
  });

  // --- Orientation toggle ---
  const orientationSelect = h('select', { className: 'ait-select' });
  if (disabled) orientationSelect.disabled = true;
  for (const opt of ['auto', 'portrait', 'landscape'] as ViewportOrientation[]) {
    const option = h('option', { value: opt }, opt);
    if (opt === vp.orientation) option.selected = true;
    orientationSelect.appendChild(option);
  }
  orientationSelect.addEventListener('change', () => {
    aitState.patch('viewport', {
      orientation: orientationSelect.value as ViewportOrientation,
    });
  });

  // --- Landscape side (only meaningful when landscape) ---
  const landscapeSideSelect = h('select', { className: 'ait-select' });
  if (disabled) landscapeSideSelect.disabled = true;
  for (const opt of ['left', 'right'] as LandscapeSide[]) {
    const option = h('option', { value: opt }, opt);
    if (opt === vp.landscapeSide) option.selected = true;
    landscapeSideSelect.appendChild(option);
  }
  landscapeSideSelect.addEventListener('change', () => {
    aitState.patch('viewport', { landscapeSide: landscapeSideSelect.value as LandscapeSide });
  });

  // --- Custom width/height inputs (custom 모드에서만 활성화) ---
  const customRow = h('div', { className: 'ait-section' });
  if (vp.preset === 'custom') {
    const widthInput = h('input', {
      className: 'ait-input',
      type: 'number',
      min: '1',
      value: String(vp.customWidth),
    }) as HTMLInputElement;
    const heightInput = h('input', {
      className: 'ait-input',
      type: 'number',
      min: '1',
      value: String(vp.customHeight),
    }) as HTMLInputElement;
    if (disabled) {
      widthInput.disabled = true;
      heightInput.disabled = true;
    }
    widthInput.addEventListener('change', () => {
      const clamped = clampCustomDimension(Number(widthInput.value));
      if (clamped !== null) {
        aitState.patch('viewport', { customWidth: clamped });
        widthInput.value = String(clamped);
      }
    });
    heightInput.addEventListener('change', () => {
      const clamped = clampCustomDimension(Number(heightInput.value));
      if (clamped !== null) {
        aitState.patch('viewport', { customHeight: clamped });
        heightInput.value = String(clamped);
      }
    });
    customRow.append(
      h('div', { className: 'ait-section-title' }, 'Custom size'),
      h('div', { className: 'ait-row' }, h('label', {}, 'Width (px)'), widthInput),
      h('div', { className: 'ait-row' }, h('label', {}, 'Height (px)'), heightInput),
    );
  }

  // --- Frame decoration toggle ---
  const frameCheckbox = h('input', { type: 'checkbox' }) as HTMLInputElement;
  frameCheckbox.checked = vp.frame;
  if (disabled) frameCheckbox.disabled = true;
  frameCheckbox.addEventListener('change', () => {
    aitState.patch('viewport', { frame: frameCheckbox.checked });
  });

  // --- Apps in Toss nav bar toggle ---
  const navBarCheckbox = h('input', { type: 'checkbox' }) as HTMLInputElement;
  navBarCheckbox.checked = vp.aitNavBar;
  if (disabled) navBarCheckbox.disabled = true;
  navBarCheckbox.addEventListener('change', () => {
    aitState.patch('viewport', { aitNavBar: navBarCheckbox.checked });
  });

  // --- Status panel: applied size + HiDPI + safe area ---
  const size = resolveViewportSize(vp);
  const statusEl = h('div', { className: 'ait-section' });

  if (vp.preset === 'none' || size.width === 0) {
    statusEl.appendChild(
      h(
        'div',
        { style: 'color:#888;font-size:11px' },
        'No viewport constraint — body fills the window.',
      ),
    );
  } else {
    const preset = vp.preset === 'custom' ? null : getPreset(vp.preset);
    const effOrient = effectiveOrientation(vp);
    const landscape = effOrient === 'landscape';
    const rows: Array<HTMLElement> = [];

    // Viewport: CSS @DPR | physical
    const dpr = preset?.dpr ?? 1;
    const physW = Math.round(size.width * dpr);
    const physH = Math.round(size.height * dpr);
    const orientDisplay = vp.orientation === 'auto' ? `${effOrient} (auto)` : effOrient;
    rows.push(
      h(
        'div',
        { className: 'ait-status-row' },
        h('span', {}, 'CSS / physical'),
        h(
          'span',
          { className: 'ait-status-value' },
          `${size.width}×${size.height}@${dpr}x | ${physW}×${physH} ${orientDisplay}`,
        ),
      ),
    );

    if (preset) {
      const insets = computeSafeAreaInsets(preset, landscape, vp.landscapeSide);
      rows.push(
        h(
          'div',
          { className: 'ait-status-row' },
          h('span', {}, 'Safe area'),
          h(
            'span',
            { className: 'ait-status-value' },
            `T${insets.top} R${insets.right} B${insets.bottom} L${insets.left}`,
          ),
        ),
      );
    }

    if (vp.aitNavBar && !landscape) {
      rows.push(
        h(
          'div',
          { className: 'ait-status-row' },
          h('span', {}, 'AIT nav bar'),
          h('span', { className: 'ait-status-value' }, `${AIT_NAV_BAR_HEIGHT}px (excl. SafeArea)`),
        ),
      );
    }

    for (const row of rows) statusEl.appendChild(row);
  }

  // --- Compose ---
  const deviceSection = h(
    'div',
    { className: 'ait-section' },
    h('div', { className: 'ait-section-title' }, 'Device'),
    h('div', { className: 'ait-row' }, h('label', {}, 'Preset'), presetSelect),
    h('div', { className: 'ait-row' }, h('label', {}, 'Orientation'), orientationSelect),
  );

  // Landscape side row only shown when effective orientation is landscape and
  // the device has a notch (otherwise the value has no visible effect).
  if (effectiveOrientation(vp) === 'landscape' && vp.preset !== 'none' && vp.preset !== 'custom') {
    const notch = getPreset(vp.preset).notch;
    if (notch === 'notch' || notch === 'dynamic-island') {
      deviceSection.appendChild(
        h('div', { className: 'ait-row' }, h('label', {}, 'Notch side'), landscapeSideSelect),
      );
    }
  }

  container.append(
    deviceSection,
    customRow,
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Appearance'),
      h('div', { className: 'ait-row' }, h('label', {}, 'Show frame'), frameCheckbox),
      h(
        'div',
        { className: 'ait-row' },
        h('label', {}, 'Show Apps in Toss nav bar'),
        navBarCheckbox,
      ),
    ),
    statusEl,
  );

  return container;
}
