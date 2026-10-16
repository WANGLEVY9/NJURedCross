import { TextDecoder } from 'node:util';
import { collectRequestBody } from './request-body.js';

function invalidBody() {
  return Object.assign(
    new Error('请求体必须是 UTF-8 编码的 JSON 对象。'),
    {
      statusCode: 400,
      code: 'invalid_json_body',
    },
  );
}

export async function readJsonObject(req) {
  const buffer = await collectRequestBody(req, 64 * 1024);
  if (!buffer.length) return {};

  let body;

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    body = JSON.parse(text);
  } catch {
    throw invalidBody();
  }

  if (
    body === null
    || typeof body !== 'object'
    || Array.isArray(body)
  ) {
    throw invalidBody();
  }

  return body;
}