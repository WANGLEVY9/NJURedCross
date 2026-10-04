/** Keep upstream credential failures distinct from application authentication. */
export function apiFailure(error) {
  const upstreamStatus = error?.response?.status || null;
  const upstreamAuth = !error?.statusCode && [401, 403].includes(upstreamStatus);
  return {
    status: upstreamAuth ? 503 : error?.statusCode || (upstreamStatus ? 502 : 500),
    payload: {
      ok: false,
      code: upstreamAuth ? 'seatable_auth_failed' : error?.code || null,
      message: upstreamAuth ? '数据服务连接暂时不可用，请稍后重试或联系管理员。' : upstreamStatus ? '数据服务请求失败，请稍后重试。' : error?.message || '服务暂时不可用',
      seaTableStatus: upstreamStatus,
    },
  };
}
