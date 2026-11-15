/**
 * Offline Media Queue (IndexedDB)
 * Safely persists media recordings and pending uploads when offline or on flaky connections.
 * Automatically retries when online connectivity returns.
 */

export interface QueuedUploadItem {
  id: string; // unique queue uuid
  bucket: string;
  storagePath: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  mediaType: 'voice_recording' | 'customer_image' | 'rider_profile';
  status: 'pending' | 'uploading' | 'failed' | 'completed';
  retryCount: number;
  lastError?: string;
  orderPayload?: {
    customerPhone: string;
    orderType: 'text' | 'voice';
    orderDescription?: string;
  };
  createdAt: number;
  updatedAt: number;
}

export type QueueSubscriber = (items: QueuedUploadItem[]) => void;

const DB_NAME = 'okada_media_db';
const DB_VERSION = 1;
const STORE_NAME = 'pending_media_queue';
const MAX_QUEUE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB safe storage cap
const MAX_QUEUE_ITEMS = 20;

let dbInstance: IDBDatabase | null = null;
let isProcessing = false;
const subscribers: Set<QueueSubscriber> = new Set();

/**
 * Open or initialize IndexedDB connection
 */
function openQueueDatabase(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported on this platform.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('idx_status', 'status', { unique: false });
        store.createIndex('idx_createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

/**
 * Notify all UI subscribers of queue updates
 */
async function notifySubscribers(): Promise<void> {
  if (subscribers.size === 0) return;
  try {
    const items = await offlineMediaQueue.getPendingUploads();
    subscribers.forEach((callback) => callback(items));
  } catch (err) {
    console.warn('Error notifying offline queue subscribers:', err);
  }
}

export const offlineMediaQueue = {
  /**
   * Subscribe to queue state updates (e.g. For showing pending sync pill)
   */
  subscribe(callback: QueueSubscriber): () => void {
    subscribers.add(callback);
    // Initial emission
    this.getPendingUploads().then(callback).catch(() => {});
    return () => {
      subscribers.delete(callback);
    };
  },

  /**
   * Enqueue a media item for deferred or retry upload
   */
  async enqueueUpload(
    item: Omit<QueuedUploadItem, 'id' | 'status' | 'retryCount' | 'createdAt' | 'updatedAt'>
  ): Promise<QueuedUploadItem> {
    const db = await openQueueDatabase();

    // Check storage caps before enqueuing
    const existing = await this.getAllItems();
    if (existing.length >= MAX_QUEUE_ITEMS) {
      // Evict oldest completed or failed item
      const evictable = existing.find((i) => i.status === 'completed' || i.status === 'failed');
      if (evictable) {
        await this.removeQueueItem(evictable.id);
      } else {
        throw new Error('Offline upload queue is full. Please reconnect to upload pending items.');
      }
    }

    const totalBytes = existing.reduce((sum, i) => sum + i.fileSizeBytes, 0);
    if (totalBytes + item.fileSizeBytes > MAX_QUEUE_SIZE_BYTES) {
      throw new Error('Offline media storage limit (50 MB) exceeded. Please reconnect to upload.');
    }

    const newItem: QueuedUploadItem = {
      ...item,
      id: crypto.randomUUID(),
      status: 'pending',
      retryCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(newItem);

      req.onsuccess = () => {
        notifySubscribers();
        resolve(newItem);
      };

      req.onerror = () => {
        reject(req.error || new Error('Failed to enqueue item in IndexedDB.'));
      };
    });
  },

  /**
   * Retrieve all items currently in the queue
   */
  async getAllItems(): Promise<QueuedUploadItem[]> {
    const db = await openQueueDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Retrieve active pending or failed uploads (excluding completed)
   */
  async getPendingUploads(): Promise<QueuedUploadItem[]> {
    const all = await this.getAllItems();
    return all.filter((item) => item.status === 'pending' || item.status === 'uploading' || item.status === 'failed');
  },

  /**
   * Update item status and error
   */
  async updateStatus(
    id: string,
    status: QueuedUploadItem['status'],
    lastError?: string
  ): Promise<void> {
    const db = await openQueueDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const item = getReq.result as QueuedUploadItem | undefined;
        if (!item) {
          resolve();
          return;
        }

        item.status = status;
        item.updatedAt = Date.now();
        if (status === 'failed') {
          item.retryCount += 1;
        }
        if (lastError !== undefined) {
          item.lastError = lastError;
        }

        const putReq = store.put(item);
        putReq.onsuccess = () => {
          notifySubscribers();
          resolve();
        };
        putReq.onerror = () => reject(putReq.error);
      };

      getReq.onerror = () => reject(getReq.error);
    });
  },

  /**
   * Remove an item from the queue
   */
  async removeQueueItem(id: string): Promise<void> {
    const db = await openQueueDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);

      req.onsuccess = () => {
        notifySubscribers();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Process all pending items in the queue with a provided upload worker
   */
  async processQueue(
    uploader: (item: QueuedUploadItem) => Promise<boolean>
  ): Promise<void> {
    if (isProcessing) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return; // Still offline
    }

    isProcessing = true;
    try {
      const pending = await this.getPendingUploads();
      for (const item of pending) {
        if (item.retryCount >= 5) {
          await this.updateStatus(item.id, 'failed', 'Max retry limit reached (5 attempts).');
          continue;
        }

        await this.updateStatus(item.id, 'uploading');
        try {
          const success = await uploader(item);
          if (success) {
            await this.updateStatus(item.id, 'completed');
            // Auto clean after 5 seconds
            setTimeout(() => {
              this.removeQueueItem(item.id).catch(() => {});
            }, 5000);
          } else {
            await this.updateStatus(item.id, 'failed', 'Upload attempt was unsuccessful.');
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown network failure';
          await this.updateStatus(item.id, 'failed', message);
        }
      }
    } finally {
      isProcessing = false;
      notifySubscribers();
    }
  }
};

// Automatic listener: process queue when network connectivity returns
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    // Notify subscribers that we are back online
    notifySubscribers();
  });
}
