// IndexedDB cache helper for attachment blobs
const DB_NAME = 'cloudchat_cache';
const DB_VERSION = 1;
const STORE_NAME = 'files';
let db = null;

export function initDB() {
    return new Promise((resolve) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve();
        };
        request.onerror = (e) => {
            console.error('IndexedDB init error:', e);
            resolve(); // Fallback to memory-only
        };
    });
}

export function cacheFile(id, blob) {
    if (!db) return;
    try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(blob, id);
    } catch (e) {
        console.error('Failed to cache file in DB:', e);
    }
}

export function getCachedFile(id) {
    return new Promise((resolve) => {
        if (!db) return resolve(null);
        try {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch (e) {
            resolve(null);
        }
    });
}

export function clearAllCache() {
    return new Promise((resolve) => {
        if (!db) return resolve();
        try {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        } catch (e) {
            console.warn('Failed to clear IndexedDB cache:', e);
            resolve();
        }
    });
}
