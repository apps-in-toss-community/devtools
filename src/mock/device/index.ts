/**
 * 디바이스 기능 mock
 * Storage, Location, Camera, Photos, Contacts, Clipboard, Haptic, Network
 *
 * 각 도메인별 파일에서 구현하고, 이 파일에서 통합 re-export한다.
 */

export { getDefaultPlaceholderImages } from './_helpers.js';
export { fetchAlbumPhotos, openCamera } from './camera.js';
export { getClipboardText, setClipboardText } from './clipboard.js';
export { fetchContacts } from './contacts.js';
export { generateHapticFeedback, saveBase64Data } from './haptic.js';
export { Accuracy, getCurrentLocation, startUpdateLocation } from './location.js';
export { getNetworkStatusByMode } from './network.js';
export { Storage } from './storage.js';
