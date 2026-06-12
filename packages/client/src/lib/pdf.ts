import * as pdfjsLib from 'pdfjs-dist';

// One-time worker wiring shared by the full viewer and grid thumbnails.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export { pdfjsLib };
