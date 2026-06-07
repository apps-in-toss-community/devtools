/**
 * Imperative drag / snap-to-edge / position-persistence for the floating toggle
 * button, packaged as a React hook.
 *
 * DESIGN (critique decision #1): the button position is NOT React state. It is
 * owned entirely by this hook as direct `style` mutation + `localStorage`
 * (`__ait_btn_pos`). Position must survive a locale-change re-render of the
 * surrounding `<Panel>` subtree, and a `useState`-backed position would be torn
 * down / re-seeded on every render. Keeping it in the DOM + storage means the
 * panel can re-render its strings freely without the button jumping.
 *
 * The pointer-drag / snap / clamp math is lifted verbatim from the previous
 * vanilla `makeDraggable` / `snapToEdge` / `updatePanelPosition` so behaviour is
 * byte-identical — this is the "keep imperative third-party/DOM logic imperative,
 * just wire it through a ref/effect" rule (critique decision #3).
 */

import { useEffect } from 'react';
import { PANEL_FULLSCREEN_BREAKPOINT, PANEL_HEIGHT, PANEL_WIDTH } from './styles.js';

const BTN_POS_STORAGE_KEY = '__ait_btn_pos';

function snapToEdge(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cx = rect.left + rect.width / 2;
  const margin = 16;

  if (cx < vw / 2) {
    el.style.left = `${margin}px`;
    el.style.right = 'auto';
  } else {
    el.style.left = 'auto';
    el.style.right = `${margin}px`;
  }

  const top = Math.max(margin, Math.min(vh - rect.height - margin, rect.top));
  el.style.top = `${top}px`;
  el.style.bottom = 'auto';
}

function updatePanelPosition(toggleEl: HTMLElement, panelEl: HTMLElement | null): void {
  if (!panelEl) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // On narrow viewports, CSS media query handles fullscreen — clear any inline positioning
  if (vw <= PANEL_FULLSCREEN_BREAKPOINT) {
    panelEl.style.top = '';
    panelEl.style.left = '';
    panelEl.style.right = '';
    panelEl.style.bottom = '';
    return;
  }

  const rect = toggleEl.getBoundingClientRect();
  const _panelWidth = PANEL_WIDTH;
  const panelHeight = PANEL_HEIGHT;
  const margin = 16;

  // Horizontal: place panel on the same side as the toggle button
  if (rect.left < vw / 2) {
    panelEl.style.left = `${margin}px`;
    panelEl.style.right = 'auto';
  } else {
    panelEl.style.left = 'auto';
    panelEl.style.right = `${margin}px`;
  }

  // Vertical: place below button if it's in top half, above if bottom half.
  // Clamp so panel stays within viewport
  if (rect.top < vh / 2) {
    const top = Math.min(rect.bottom + 8, vh - panelHeight - margin);
    panelEl.style.top = `${Math.max(margin, top)}px`;
    panelEl.style.bottom = 'auto';
  } else {
    const bottom = Math.min(vh - rect.top + 8, vh - panelHeight - margin);
    panelEl.style.top = 'auto';
    panelEl.style.bottom = `${Math.max(margin, bottom)}px`;
  }
}

function saveButtonPosition(el: HTMLElement): void {
  localStorage.setItem(
    BTN_POS_STORAGE_KEY,
    JSON.stringify({
      left: el.style.left,
      top: el.style.top,
      right: el.style.right,
      bottom: el.style.bottom,
    }),
  );
}

// Uses __ait_btn_pos (not the __ait_storage: prefix) — panel-internal state, not mock storage
function restoreButtonPosition(el: HTMLElement): void {
  const saved = localStorage.getItem(BTN_POS_STORAGE_KEY);
  if (saved) {
    try {
      const pos = JSON.parse(saved);
      if (typeof pos !== 'object' || pos === null) return;
      const allowedKeys = ['left', 'top', 'right', 'bottom'] as const;
      const validCssValue = /^(\d+px|auto)$/;
      for (const key of allowedKeys) {
        if (key in pos && typeof pos[key] === 'string' && validCssValue.test(pos[key])) {
          el.style[key] = pos[key];
        }
      }
    } catch {
      /* ignore */
    }
  } else {
    el.style.bottom = '16px';
    el.style.right = '16px';
  }
}

export interface UseDraggableOptions {
  /** Fired on a tap (pointerdown→up without movement) — toggles the panel. */
  onClickOnly: () => void;
  /** Live getter for the panel element so drag can reposition it when open. */
  getPanelEl: () => HTMLElement | null;
  /** Whether the panel is currently open (reposition the panel on drag only then). */
  isOpenRef: { current: boolean };
}

/**
 * Wire pointer-drag, snap-to-edge, position restore/persist, and resize
 * re-clamping onto the toggle button `ref`. All position lives in the DOM +
 * `localStorage`, never React state.
 */
export function useDraggable(
  ref: React.RefObject<HTMLButtonElement | null>,
  { onClickOnly, getPanelEl, isOpenRef }: UseDraggableOptions,
): void {
  // Keep the latest callbacks without re-binding listeners each render.
  const onClickRef = { current: onClickOnly };
  onClickRef.current = onClickOnly;

  // biome-ignore lint/correctness/useExhaustiveDependencies: ref objects are stable; this effect intentionally runs once to bind imperative listeners.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    restoreButtonPosition(el);
    // Re-clamp restored position to current viewport (e.g., saved on a wider screen)
    snapToEdge(el);
    saveButtonPosition(el);

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let hasMoved = false;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMoved = true;
        el.classList.add('dragging');
      }
      if (!hasMoved) return;

      el.style.left = `${startLeft + dx}px`;
      el.style.top = `${startTop + dy}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    };

    const settleDrag = () => {
      snapToEdge(el);
      if (isOpenRef.current) updatePanelPosition(el, getPanelEl());
      saveButtonPosition(el);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isDragging) return;
      isDragging = false;
      el.classList.remove('dragging');
      el.releasePointerCapture(e.pointerId);

      if (hasMoved) {
        settleDrag();
      } else {
        onClickRef.current();
      }
    };

    const onPointerCancel = (e: PointerEvent) => {
      isDragging = false;
      el.classList.remove('dragging');
      el.releasePointerCapture(e.pointerId);
      if (hasMoved) settleDrag();
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);

    // Re-clamp button + panel position on window resize (rAF-throttled).
    let resizeRaf = 0;
    const onResize = () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        snapToEdge(el);
        saveButtonPosition(el);
        if (isOpenRef.current) updatePanelPosition(el, getPanelEl());
      });
    };
    window.addEventListener('resize', onResize);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('resize', onResize);
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
    };
  }, []);
}

export { updatePanelPosition };
