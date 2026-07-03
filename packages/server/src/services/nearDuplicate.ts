// Content-level (fuzzy) near-duplicate signatures. Complements the exact
// SHA-256 check (`hashBuffer`), which only catches byte-identical files: a
// re-scan / re-export / emailed copy of the same invoice has different bytes
// but nearly identical content. Both signals are advisory only — never a block.
//
// - Text docs get a 64-bit **SimHash** over their extracted text; two docs are
//   near-dupes when their SimHashes are within a few bits (Hamming distance).
// - Images get a 64-bit **dHash** (perceptual hash) over a downscaled
//   grayscale, robust to re-encoding/resave. Uses sharp to decode.
//
// Signatures are stored as plain 16-char hex strings (no `0x`).

import { readFile } from 'fs/promises';

// A near-dup is flagged when the incoming doc's signature is within this many
// bits (out of 64) of a stored one. SimHash of near-identical text is usually
// 0–3 bits out; a light image re-encode is usually well under 8.
export const SIMHASH_MAX_DISTANCE = 3;
export const PHASH_MAX_DISTANCE = 8;

// Below this, text is too short for a SimHash to mean much (a one-line receipt
// would collide with every other one-liner). Such docs get no text signature.
export const SIMHASH_MIN_CHARS = 200;

const MASK64 = (1n << 64n) - 1n;
const FNV_OFFSET = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;

// 64-bit FNV-1a over the UTF-8 bytes of a string.
function fnv1a64(feature: string): bigint {
  let hash = FNV_OFFSET;
  const bytes = Buffer.from(feature, 'utf8');
  for (const byte of bytes) {
    hash = (hash ^ BigInt(byte)) & MASK64;
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash;
}

function toHex64(value: bigint): string {
  return (value & MASK64).toString(16).padStart(16, '0');
}

function popcount64(value: bigint): number {
  let count = 0;
  let x = value & MASK64;
  while (x) {
    x &= x - 1n;
    count++;
  }
  return count;
}

// Hamming distance between two 16-hex signatures (0..64). Returns 64 (max
// distance = no match) if either side is missing/malformed.
export function hammingHex(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 64;
  try {
    return popcount64(BigInt(`0x${a}`) ^ BigInt(`0x${b}`));
  } catch {
    return 64;
  }
}

// SimHash of a document's text: 3-word shingles as features, each folded into a
// 64-bit signature by signed per-bit voting (a bit ends up 1 if more features
// have it set than not). Returns undefined for text that is empty or shorter
// than SIMHASH_MIN_CHARS.
export function simhash64(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.length < SIMHASH_MIN_CHARS) return undefined;

  const tokens = normalized.split(' ');
  // 3-word shingles capture local word order; fall back to single tokens when
  // there aren't enough words to form a shingle.
  const features: string[] = [];
  if (tokens.length >= 3) {
    for (let i = 0; i + 2 < tokens.length; i++) {
      features.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
    }
  } else {
    features.push(...tokens);
  }
  if (features.length === 0) return undefined;

  const votes = new Array<number>(64).fill(0);
  for (const feature of features) {
    const hash = fnv1a64(feature);
    for (let bit = 0; bit < 64; bit++) {
      votes[bit] += (hash >> BigInt(bit)) & 1n ? 1 : -1;
    }
  }

  let sig = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (votes[bit] > 0) sig |= 1n << BigInt(bit);
  }
  return toHex64(sig);
}

// Perceptual (difference) hash of an image buffer. Downscale to 9×8 grayscale
// and, per row, emit one bit per adjacent-column pair (left brighter than
// right) → 64 bits. HEIC/HEIF are decoded to JPEG first (sharp's HEIC support
// is platform-dependent; heic-convert is already a dependency). Never throws —
// a decode failure degrades to no signature.
export async function perceptualHash(buffer: Buffer, mimeType: string): Promise<string | undefined> {
  try {
    let input = buffer;
    if (mimeType === 'image/heic' || mimeType === 'image/heif') {
      const heicConvert = (await import('heic-convert')).default;
      const jpeg = await heicConvert({ buffer: buffer as unknown as ArrayBuffer, format: 'JPEG', quality: 0.9 });
      input = Buffer.from(jpeg as ArrayBuffer);
    }

    const sharp = (await import('sharp')).default;
    const width = 9;
    const height = 8;
    const pixels = await sharp(input)
      .resize(width, height, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    let sig = 0n;
    let bit = 0n;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width - 1; col++) {
        const left = pixels[row * width + col];
        const right = pixels[row * width + col + 1];
        if (left > right) sig |= 1n << bit;
        bit++;
      }
    }
    return toHex64(sig);
  } catch {
    return undefined;
  }
}

// Compute an image perceptual hash from a file on disk (convenience for the
// file/backfill paths). Non-image mimes and read/decode failures → undefined.
export async function perceptualHashFile(filePath: string, mimeType: string): Promise<string | undefined> {
  if (!mimeType.startsWith('image/')) return undefined;
  try {
    return await perceptualHash(await readFile(filePath), mimeType);
  } catch {
    return undefined;
  }
}
