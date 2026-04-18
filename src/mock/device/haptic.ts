/**
 * Haptic Feedback & saveBase64Data mock
 */

import { aitState } from '../state.js';

export async function generateHapticFeedback(options: { type: string }): Promise<void> {
  console.log(`[@ait-co/devtools] haptic: ${options.type}`);
  aitState.logAnalytics({ type: 'haptic', params: { hapticType: options.type } });
}

export async function saveBase64Data(params: {
  data: string;
  fileName: string;
  mimeType: string;
}): Promise<void> {
  const a = document.createElement('a');
  a.href = `data:${params.mimeType};base64,${params.data}`;
  a.download = params.fileName;
  a.click();
}
