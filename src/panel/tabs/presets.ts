import { deleteUserPreset, listUserPresets, saveUserPreset } from '../../mock/preset-store.js';
import {
  applyPreset,
  builtInPresets,
  captureCurrentState,
  type MockPreset,
  matchesPreset,
} from '../../mock/presets.js';
import { type AitDevtoolsState, aitState } from '../../mock/state.js';
import { h, monitoringNotice } from '../helpers.js';

export function renderPresetsTab(refreshPanel: () => void): HTMLElement {
  const disabled = !aitState.state.panelEditable;
  const container = h('div');
  if (disabled) container.appendChild(monitoringNotice());

  const userPresets = listUserPresets();
  const snapshot = aitState.state;

  container.append(
    renderSection('Built-in scenarios', builtInPresets, disabled, snapshot, refreshPanel, false),
  );

  container.append(
    renderSection(
      `Saved presets (${userPresets.length})`,
      userPresets,
      disabled,
      snapshot,
      refreshPanel,
      true,
    ),
  );

  // Save current state as preset
  const saveBtn = h('button', { className: 'ait-btn ait-btn-sm' }, 'Save current as preset');
  if (disabled) saveBtn.disabled = true;
  saveBtn.addEventListener('click', () => {
    const label = window.prompt('Preset label?');
    if (label === null) return;
    try {
      saveUserPreset(label, captureCurrentState(aitState.state));
    } catch (err) {
      window.alert((err as Error).message);
      return;
    }
    refreshPanel();
  });

  container.append(
    h(
      'div',
      { className: 'ait-section' },
      h('div', { className: 'ait-section-title' }, 'Save'),
      h(
        'div',
        { style: 'color:#888;font-size:11px;margin-bottom:6px' },
        'Capture network / permissions / auth / IAP / ads / payment slices.',
      ),
      saveBtn,
    ),
  );

  return container;
}

function renderSection(
  title: string,
  presets: readonly MockPreset[],
  disabled: boolean,
  snapshot: AitDevtoolsState,
  refreshPanel: () => void,
  deletable: boolean,
): HTMLElement {
  const section = h(
    'div',
    { className: 'ait-section' },
    h('div', { className: 'ait-section-title' }, title),
  );

  if (presets.length === 0) {
    section.append(
      h(
        'div',
        { style: 'color:#555;font-size:12px' },
        deletable ? 'No saved presets yet.' : 'No built-in presets.',
      ),
    );
    return section;
  }

  for (const preset of presets) {
    const isActive = matchesPreset(snapshot, preset.state);

    const labelEl = h(
      'span',
      { className: 'ait-preset-label' },
      isActive ? `✓ ${preset.label}` : preset.label,
    );

    const applyBtn = h(
      'button',
      { className: 'ait-btn ait-btn-sm' },
      isActive ? 'Re-apply' : 'Apply',
    );
    if (disabled) applyBtn.disabled = true;
    applyBtn.addEventListener('click', () => {
      applyPreset(preset.state);
      refreshPanel();
    });

    const buttons: Node[] = [applyBtn];
    if (deletable) {
      const delBtn = h('button', { className: 'ait-btn ait-btn-sm ait-btn-danger' }, 'Delete');
      if (disabled) delBtn.disabled = true;
      delBtn.addEventListener('click', () => {
        if (!window.confirm(`Delete preset "${preset.label}"?`)) return;
        deleteUserPreset(preset.id);
        refreshPanel();
      });
      buttons.push(delBtn);
    }

    const actions = h('span', { className: 'ait-preset-actions' }, ...buttons);

    const row = h(
      'div',
      { className: `ait-preset-row${isActive ? ' ait-preset-active' : ''}` },
      labelEl,
      actions,
    );
    section.append(row);

    if (preset.description) {
      section.append(h('div', { className: 'ait-preset-description' }, preset.description));
    }
  }

  return section;
}
