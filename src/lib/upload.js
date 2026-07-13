import { api } from './api.js';

// Downscale + JPEG-encode client-side (keeps field photos ~200-500KB), then
// POST as base64 to /api/uploads. Returns the stored public URL.
export async function uploadImage(file, maxDim = 1600) {
  const dataUrl = await resizeToDataUrl(file, maxDim);
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(5, dataUrl.indexOf(';')); // between "data:" and ";base64"
  const b64 = dataUrl.slice(comma + 1);
  const { url } = await api.post('/uploads', { filename: file.name, contentType: meta, data: b64 });
  return url;
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
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
