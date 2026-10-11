/** Separate application rejection from upstream and internal failures. */
export function apiFailure(error) {
  if (error?.code === 'ERR_CANCELED') {
    return {
      status: 503,
      payload: {
        ok: false,
        code: 'external_request_cancelled',
        message: '外部服务请求已取消；写入结果可能需要核对。',
        seaTableStatus: null,
      },
    };
  }

  const applicationStatus = Number.isInteger(error?.statusCode)
    && error.statusCode >= 400
    && error.statusCode <= 599
    ? error.statusCode
    : null;

  const upstreamStatus = Number.isInteger(error?.response?.status)
    && error.response.status >= 400
    && error.response.status <= 599
    ? error.response.status
    : null;

  const upstreamAuth = applicationStatus === null
    && [401, 403].includes(upstreamStatus);

  const status = upstreamAuth
    ? 503
    : applicationStatus ?? (upstreamStatus === null ? 500 : 502);

  let code = null;
  if (upstreamAuth) {
    code = 'seatable_auth_failed';
  } else if (
    applicationStatus !== null
    && typeof error?.code === 'string'
    && /^[a-z][a-z0-9_]{0,79}$/.test(error.code)
  ) {
    code = error.code;
  }

  let message;

  if (upstreamAuth) {
    message = '数据服务连接暂时不可用，请稍后重试或联系管理员。';
  } else if (upstreamStatus !== null) {
    message = '数据服务请求失败；写入结果可能需要核对。';
  } else if (
    applicationStatus !== null
    && applicationStatus < 500
    && typeof error?.message === 'string'
    && error.message
  ) {
    message = error.message;
  } else {
    message = '服务暂时不可用；若请求涉及写入，请保留记录并核对处理结果。';
  }

  return {
    status,
    payload: {
      ok: false,
      code,
      message,
      seaTableStatus: upstreamStatus,
    },
  };
}