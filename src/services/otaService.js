import pkg from '../../package.json';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export const OTA_MANIFEST_URL = 'https://chat.a66.nasnas.site/web/c7x9k2m5p8q3v6w1n4t7b8d2/version.json';
export const APP_VERSION = pkg.version || '1.0.2';

export async function universalFetch(url, options = {}) {
  const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);
  if (isTauri) {
    try {
      return await tauriFetch(url, options);
    } catch (e) {
      console.warn('[OTA] tauriFetch error, falling back to window.fetch:', e);
    }
  }
  return await window.fetch(url, options);
}

// Compare semver: returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
export function compareVersions(v1, v2) {
  if (!v1 || !v2) return 0;
  const p1 = v1.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const p2 = v2.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

export async function checkDesktopUpdate(currentVersion = APP_VERSION) {
  try {
    const res = await universalFetch(OTA_MANIFEST_URL + '?t=' + Date.now(), {
      cache: 'no-store'
    });
    if (!res.ok) {
      console.warn('OTA check non-ok HTTP status:', res.status);
      return null;
    }
    const data = await res.json();
    const desktop = data.desktop;
    if (!desktop || !desktop.version || !desktop.downloadUrl) return null;

    if (compareVersions(desktop.version, currentVersion) > 0) {
      return desktop;
    }
    return null;
  } catch (err) {
    console.error('OTA check error:', err);
    throw err;
  }
}

export async function fetchFullVersionManifest() {
  try {
    const res = await universalFetch(OTA_MANIFEST_URL + '?t=' + Date.now(), {
      cache: 'no-store'
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('Fetch manifest error:', err);
    return null;
  }
}

export function getIgnoredDesktopVersion() {
  try {
    return localStorage.getItem('cloudchat_ignored_ota_version') || '';
  } catch (e) {
    return '';
  }
}

export function setIgnoredDesktopVersion(version) {
  try {
    localStorage.setItem('cloudchat_ignored_ota_version', version || '');
  } catch (e) {}
}

export function clearIgnoredDesktopVersion() {
  try {
    localStorage.removeItem('cloudchat_ignored_ota_version');
  } catch (e) {}
}

