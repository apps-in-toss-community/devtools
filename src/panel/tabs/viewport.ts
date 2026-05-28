import { t } from '../../i18n/index.js';
import { aitState } from '../../mock/state.js';
import type {
  AitNavBarType,
  SafeAreaProvenance,
  ViewportOrientation,
  ViewportPresetId,
} from '../../mock/types.js';
import { h, monitoringNotice } from '../helpers.js';
import {
  clampCustomDimension,
  computeSafeAreaInsets,
  effectiveOrientation,
  getPreset,
  resolveViewportSize,
  VIEWPORT_PRESETS,
} from '../viewport.js';

/**
 * Renders a small inline provenance badge for safe-area values.
 * - `measured`     — no badge (confirmed value)
 * - `extrapolated` — "(추정치)" in muted gray
 * - `placeholder`  — "(미측정)" in amber
 */
function provenanceBadge(provenance: SafeAreaProvenance | undefined): HTMLElement | null {
  if (!provenance || provenance.source === 'measured') return null;
  const text = provenance.source === 'placeholder' ? '(미측정)' : '(추정치)';
  const color = provenance.source === 'placeholder' ? '#b45309' : '#888';
  const badge = h('span', {
    className: 'ait-provenance-badge',
    title:
      provenance.source === 'placeholder'
        ? 'safe-area 값이 미실측 추정치입니다. relay 세션에서 measure_safe_area로 실측 후 승급하세요.'
        : 'safe-area 값이 기기 스펙에서 유추한 추정치입니다. relay 세션에서 measure_safe_area로 확인하세요.',
  });
  badge.textContent = text;
  badge.style.cssText = `font-size:10px;color:${color};margin-left:4px`;
  return badge;
}

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
      h('div', { className: 'ait-section-title' }, t('viewport.section.custom')),
      h('div', { className: 'ait-row' }, h('label', {}, t('viewport.row.width')), widthInput),
      h('div', { className: 'ait-row' }, h('label', {}, t('viewport.row.height')), heightInput),
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

  // --- Nav bar type (partner / game) — only meaningful when aitNavBar is on ---
  const navBarTypeSelect = h('select', { className: 'ait-select' });
  if (disabled || !vp.aitNavBar) navBarTypeSelect.disabled = true;
  for (const opt of ['partner', 'game'] as AitNavBarType[]) {
    const option = h('option', { value: opt }, opt);
    if (opt === vp.aitNavBarType) option.selected = true;
    navBarTypeSelect.appendChild(option);
  }
  navBarTypeSelect.addEventListener('change', () => {
    aitState.patch('viewport', { aitNavBarType: navBarTypeSelect.value as AitNavBarType });
  });

  // --- Status panel: applied size + HiDPI + safe area ---
  const size = resolveViewportSize(vp);
  const statusEl = h('div', { className: 'ait-section' });

  if (vp.preset === 'none' || size.width === 0) {
    statusEl.appendChild(
      h('div', { style: 'color:#888;font-size:11px' }, t('viewport.status.noConstraint')),
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
    const orientDisplay =
      vp.orientation === 'auto'
        ? t('viewport.orientation.autoSuffix', { orient: effOrient })
        : effOrient;
    rows.push(
      h(
        'div',
        { className: 'ait-status-row' },
        h('span', {}, t('viewport.status.cssPhysical')),
        h(
          'span',
          { className: 'ait-status-value' },
          `${size.width}×${size.height}@${dpr}x | ${physW}×${physH} ${orientDisplay}`,
        ),
      ),
    );

    if (preset) {
      const insets = computeSafeAreaInsets(preset, landscape, vp.aitNavBar, vp.aitNavBarType);
      const safeAreaValueEl = h(
        'span',
        { className: 'ait-status-value' },
        `T${insets.top} R${insets.right} B${insets.bottom} L${insets.left}`,
      );
      const badge = provenanceBadge(preset.safeAreaProvenance);
      if (badge) safeAreaValueEl.appendChild(badge);
      rows.push(
        h(
          'div',
          { className: 'ait-status-row' },
          h('span', {}, t('viewport.status.safeArea')),
          safeAreaValueEl,
        ),
      );
    }

    if (vp.aitNavBar && !landscape) {
      // partner는 콘텐츠를 navBarHeight만큼 밀어내고, game은 투명 오버레이라 0.
      const navBarTop = vp.aitNavBarType === 'partner' ? (preset?.navBarHeight ?? 0) : 0;
      rows.push(
        h(
          'div',
          { className: 'ait-status-row' },
          h('span', {}, t('viewport.status.aitNavBar')),
          h(
            'span',
            { className: 'ait-status-value' },
            t('viewport.status.aitNavBarValue', {
              height: navBarTop,
              type: vp.aitNavBarType,
            }),
          ),
        ),
      );
    }

    for (const row of rows) statusEl.appendChild(row);
  }

  // --- Compose ---
  const deviceSection = h(
    'div',
    { className: 'ait-section' },
    h('div', { className: 'ait-section-title' }, t('viewport.section.device')),
    h('div', { className: 'ait-row' }, h('label', {}, t('viewport.row.preset')), presetSelect),
    h(
      'div',
      { className: 'ait-row' },
      h('label', {}, t('viewport.row.orientation')),
      orientationSelect,
    ),
  );

  // Landscape + notch 기기: iOS landscape에서 CSS env()와 SDK SafeAreaInsets 모두
  // left=right=notchInset(양쪽 대칭)을 반환하므로 side select가 더 이상 필요 없다.
  // (2026-05-28 iPhone 15 Pro relay 실측 #198/#232)

  container.append(
    deviceSection,
    customRow,
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, t('viewport.section.appearance')),
      h(
        'div',
        { className: 'ait-row' },
        h('label', {}, t('viewport.row.showFrame')),
        frameCheckbox,
      ),
      h(
        'div',
        { className: 'ait-row' },
        h('label', {}, t('viewport.row.showAitNavBar')),
        navBarCheckbox,
      ),
      h(
        'div',
        { className: 'ait-row' },
        h('label', {}, t('viewport.row.navBarType')),
        navBarTypeSelect,
      ),
    ),
    statusEl,
  );

  return container;
}
