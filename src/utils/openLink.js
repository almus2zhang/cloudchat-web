export async function openExternalLink(url) {
  if (!url) return;
  const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);

  if (isTauri) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_file', { path: url });
      return;
    } catch (e) {
      console.warn('Tauri open_file invoke failed:', e);
    }
  }

  // Web Browser fallback
  window.open(url, '_blank', 'noopener,noreferrer');
}
