// File uploads. On Supabase, images go to a public Storage bucket and we
// return the public URL. Without Supabase (in-memory dev), we return a
// data: URL so the image still renders — no external storage needed.
import { randomUUID } from 'node:crypto';
import { db } from './db.js';

const BUCKET = 'attachments';
let bucketReady = false;

async function ensureBucket() {
  if (bucketReady) return;
  const client = db();
  // Create once; ignore "already exists". createBucket is idempotent-ish.
  await client.storage.createBucket(BUCKET, { public: true }).catch(() => {});
  bucketReady = true;
}

// data is a base64 string (no data: prefix). Returns { url }.
export async function uploadFile(orgId, { filename, contentType, data }) {
  const safeName = String(filename || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
  const buffer = Buffer.from(data, 'base64');
  const client = db();

  if (!client) {
    // In-memory mode: echo back a data URL.
    return { url: `data:${contentType || 'image/jpeg'};base64,${data}` };
  }

  await ensureBucket();
  const path = `${orgId}/${randomUUID()}-${safeName}`;
  const { error } = await client.storage.from(BUCKET).upload(path, buffer, {
    contentType: contentType || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;
  const { data: pub } = client.storage.from(BUCKET).getPublicUrl(path);
  return { url: pub.publicUrl };
}
