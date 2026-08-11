import { api } from './api.js';
import { enqueue } from './outbox.js';

// Downscale + JPEG-encode client-side (keeps field photos ~200-500 KB), then
// POST as base64 to /api/uploads. Returns the stored public URL.
// When offline: queues an upload_and_attach outbox entry and returns the local
// data URL as a placeholder so the caller can show the image immediately.
export async function uploadImage(file, maxDim = 1600) {
  const dataUrl = await resizeToDataUrl(file, maxDim);
  const comma = dataUrl.indexOf(',');
  const contentType = dataUrl.slice(5, dataUrl.indexOf(';'));
  const b64 = dataUrl.slice(comma + 1);

  try {
    const { url } = await api.post('/uploads', { filename: file.name, contentType, data: b64 });
    return { url, pending: false };
  } catch (err) {
    if (err instanceof TypeError || !navigator.onLine) {
      // Network failure — caller must call enqueuePhoto to persist the outbox
      // entry with the entity context it knows. We return the local data URL
      // and the upload payload so the caller can do that in one shot.
      return { url: dataUrl, pending: true, b64, filename: file.name, contentType };
    }
    throw err;
  }
}

// Called by WorkOrderDetail after uploadImage returns pending:true. Stores
// the full upload + attach job in the outbox so it retries on reconnect.
export async function enqueuePhoto({ b64, filename, contentType, entityType, entityId, caption = '' }) {
  return enqueue({ type: 'upload_and_attach', entity_type: entityType, entity_id: entityId, b64, filename, contentType, caption });
}

function resizeToDataUrl(file, maxDim) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not load image'));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        // Prefer WebP (30-40% smaller than JPEG at equivalent quality).
        // Safari < 16 returns an empty result for image/webp — fall back to JPEG.
        const webp = canvas.toDataURL('image/webp', 0.85);
        resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
