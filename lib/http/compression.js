import { promisify } from 'node:util';
import {
  gzip,
  gzipSync,
  brotliCompress,
  brotliCompressSync,
  constants as zlibConstants,
} from 'node:zlib';

const zip = promisify(gzip);
const brotli = promisify(brotliCompress);

const BROTLI_QUALITY = 4;
const GZIP_LEVEL = 4;
const MIN_BYTES = 1024;

/** Parse `Accept-Encoding` into ordered name/quality choices. */
function parseAcceptEncoding(req) {
  return String(req?.headers?.['accept-encoding'] || '')
    .split(',')
    .map(part => {
      const [name, ...params] = part.trim().toLowerCase().split(';');
      const q = params.find(value => value.trim().startsWith('q='));
      const value=q?.trim().slice(2);
      return { name: name.trim(), quality: q ? (/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value) ? Number(value) : 0) : 1 };
    })
    .filter(choice => choice.name && Number.isFinite(choice.quality));
}

function qualityOf(choices, name) {
  const explicit = choices.find(choice => choice.name === name);
  if (explicit) return explicit.quality;
  const wildcard = choices.find(choice => choice.name === '*');
  return wildcard ? wildcard.quality : 0;
}

/**
 * Preferred response encoding for public text. Brotli is roughly 15–20 % smaller
 * than gzip at a comparable level, which matters a great deal on the slow, high
 * latency links this platform serves; gzip stays the fallback.
 */
export function preferredEncoding(req) {
  const choices = parseAcceptEncoding(req);
  const brotliQuality = qualityOf(choices, 'br');
  const gzipQuality = qualityOf(choices, 'gzip');
  const identityQuality=choices.find(choice=>choice.name==='identity')?.quality;
  if(identityQuality>Math.max(brotliQuality,gzipQuality))return 'identity';
  if (brotliQuality > 0 && brotliQuality >= gzipQuality) return 'br';
  if (gzipQuality > 0) return 'gzip';
  return 'identity';
}

/**
 * Deliberately gzip-specific: callers that can only speak gzip must never be
 * handed a brotli body. `preferredEncoding` is the negotiation point for
 * everything that accepts either.
 */
export function acceptsGzip(req) {
  return qualityOf(parseAcceptEncoding(req), 'gzip') > 0;
}

function compress(encoding, plain) {
  return encoding === 'br'
    ? brotli(plain, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } })
    : zip(plain, { level: GZIP_LEVEL });
}

function compressSync(encoding, plain) {
  return encoding === 'br'
    ? brotliCompressSync(plain, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } })
    : gzipSync(plain, { level: GZIP_LEVEL });
}

function negotiate(plain, encoding, compressed) {
  if (!compressed || compressed.length >= plain.length) {
    return { body: plain, headers: { Vary: 'Accept-Encoding' } };
  }
  return { body: compressed, headers: { Vary: 'Accept-Encoding', 'Content-Encoding': encoding } };
}

/** Public text only. Browser/proxy negotiation must vary by encoding. */
export async function encodePublicText(req, contents) {
  const plain = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  const encoding = preferredEncoding(req);
  if (plain.length < MIN_BYTES || encoding === 'identity') {
    return { body: plain, headers: { Vary: 'Accept-Encoding' } };
  }
  return negotiate(plain, encoding, await compress(encoding, plain));
}

/** Synchronous twin for response paths that cannot await. */
export function encodePublicTextSync(req, contents) {
  const plain = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  const encoding = preferredEncoding(req);
  if (plain.length < MIN_BYTES || encoding === 'identity') {
    return { body: plain, headers: { Vary: 'Accept-Encoding' } };
  }
  return negotiate(plain, encoding, compressSync(encoding, plain));
}
