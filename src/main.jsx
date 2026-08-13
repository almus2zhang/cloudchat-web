import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Bridge localStorage to Tauri's store plugin so all existing code
// (cloudchat_web_profiles, cloudchat_web_active_profile_id, etc.)
// is persisted in %APPDATA%/CloudChatLight/cloudchat-store.json
// with zero changes to the React codebase.
// 仅当运行在 Tauri 环境（window.__TAURI__ 存在）时才启用，避免影响纯浏览器环境。
if (typeof window !== 'undefined' && window.__TAURI__) {
  (async () => {
    try {
      const { load } = await import('@tauri-apps/plugin-store');
      const store = await load('cloudchat-store.json', { autoSave: true });

      // Mirror store values into localStorage on startup so the app reads them
      const keys = await store.keys();
      for (const k of keys) {
        try {
          const v = await store.get(k);
          if (v != null) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        } catch (e) {}
      }

      // Override localStorage.setItem / removeItem to also write to the store
      const _setItem = localStorage.setItem.bind(localStorage);
      const _removeItem = localStorage.removeItem.bind(localStorage);
      localStorage.setItem = function (key, value) {
        _setItem(key, value);
        try { store.set(key, value); store.save(); } catch (e) {}
      };
      localStorage.removeItem = function (key) {
        _removeItem(key);
        try { store.delete(key); store.save(); } catch (e) {}
      };

      console.log('[tauri] store bridge ready, keys:', keys.length);
    } catch (e) {
      // Store bridge failure should not block rendering
      console.error('[tauri] store bridge failed:', e);
    }
  })();
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
