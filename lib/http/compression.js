import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const zip = promisify(gzip);
export function acceptsGzip(req) {
  const choices = String(req?.headers?.['accept-encoding'] || '').split(',').map(part => {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    const q = params.find(value => value.trim().startsWith('q='));
    return { name, quality: q ? Number(q.trim().slice(2)) : 1 };
  });
  const explicit = choices.find(value => value.name === 'gzip');
  return (explicit || choices.find(value => value.name === '*'))?.quality > 0;
}

/** Public text only. Browser/proxy negotiation must vary by encoding. */
export async function encodePublicText(req, contents) {
  const plain = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  if (plain.length < 1024 || !acceptsGzip(req)) return { body: plain, headers: { Vary: 'Accept-Encoding' } };
  const zipped = await zip(plain, { level: 4 });
  return zipped.length < plain.length
    ? { body: zipped, headers: { Vary: 'Accept-Encoding', 'Content-Encoding': 'gzip' } }
    : { body: plain, headers: { Vary: 'Accept-Encoding' } };
}
