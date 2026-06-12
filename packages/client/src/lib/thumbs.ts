import { pdfjsLib } from './pdf';

// First-page PDF thumbnails as data URLs, keyed by document id. Promises are
// cached so concurrent cards for the same doc share one render; failures are
// evicted so a retry is possible. FIFO-capped so a large stash can't pin
// hundreds of data URLs in memory for the whole session.
const cache = new Map<string, Promise<string>>();

const THUMB_WIDTH = 480;
const MAX_CACHED = 200;

export function pdfThumbnail(docId: string, url: string): Promise<string> {
  let pending = cache.get(docId);
  if (!pending) {
    pending = render(url);
    pending.catch(() => cache.delete(docId));
    cache.set(docId, pending);
    if (cache.size > MAX_CACHED) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  return pending;
}

async function render(url: string): Promise<string> {
  const task = pdfjsLib.getDocument(url);
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    task.destroy().catch(() => {});
  }
}
