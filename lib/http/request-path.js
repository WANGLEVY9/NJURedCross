function invalidPath() {
  return Object.assign(
    new Error('请求路径格式不正确。'),
    {
      statusCode: 400,
      code: 'invalid_request_path',
    },
  );
}

export function assertApiRequestPath(pathname) {
  if (
    typeof pathname !== 'string'
    || !pathname.startsWith('/api/')
  ) {
    throw invalidPath();
  }

  let decoded;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw invalidPath();
  }

  if (/[\u0000-\u001f\u007f]/.test(decoded)) {
    throw invalidPath();
  }
}