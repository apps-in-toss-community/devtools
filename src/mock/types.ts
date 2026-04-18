export type Primitive = string | number | boolean | null | undefined | symbol;

export type PlatformOS = 'ios' | 'android';
export type OperationalEnvironment = 'toss' | 'sandbox';
export type NetworkStatus = 'OFFLINE' | 'WIFI' | '2G' | '3G' | '4G' | '5G' | 'WWAN' | 'UNKNOWN';
export type PermissionStatus = 'notDetermined' | 'denied' | 'allowed';
export type PermissionName =
  | 'clipboard'
  | 'contacts'
  | 'photos'
  | 'geolocation'
  | 'camera'
  | 'microphone';
export type HapticFeedbackType =
  | 'tickWeak'
  | 'tap'
  | 'tickMedium'
  | 'softMedium'
  | 'basicWeak'
  | 'basicMedium'
  | 'success'
  | 'error'
  | 'wiggle'
  | 'confetti';

export type DeviceApiMode = 'mock' | 'web' | 'prompt';

export interface DeviceModes {
  camera: DeviceApiMode;
  photos: DeviceApiMode;
  location: DeviceApiMode;
  network: 'mock' | 'web';
  clipboard: 'mock' | 'web';
}

export interface MockData {
  images: string[];
  clipboardText: string;
}

export interface LocationCoords {
  latitude: number;
  longitude: number;
  altitude: number;
  accuracy: number;
  altitudeAccuracy: number;
  heading: number;
}

export interface MockLocation {
  coords: LocationCoords;
  timestamp: number;
  accessLocation?: 'FINE' | 'COARSE';
}

export interface MockContact {
  name: string;
  phoneNumber: string;
}

export interface MockIapProduct {
  sku: string;
  type: 'CONSUMABLE' | 'NON_CONSUMABLE' | 'SUBSCRIPTION';
  displayName: string;
  displayAmount: string;
  iconUrl: string;
  description: string;
  renewalCycle?: 'WEEKLY' | 'MONTHLY' | 'YEARLY';
}

export type IapNextResult =
  | 'success'
  | 'USER_CANCELED'
  | 'INVALID_PRODUCT_ID'
  | 'PAYMENT_PENDING'
  | 'NETWORK_ERROR'
  | 'ITEM_ALREADY_OWNED'
  | 'INTERNAL_ERROR';

export interface AnalyticsLogEntry {
  timestamp: number;
  type: string;
  params: Record<string, unknown>;
}

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
