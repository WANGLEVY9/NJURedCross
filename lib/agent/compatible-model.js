import {
  buildAgentMessages,
  parseAgentModelOutput,
} from './model-contract.js';

export class AgentModelError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'AgentModelError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function failure(statusCode, code, message) {
  return new AgentModelError(statusCode, code, message);
}

async function readResponse(response) {
  const maximumBytes = 1024 * 1024;
  const reader = response.body?.getReader();
  if (!reader) {
    throw failure(502, 'agent_model_response_invalid', '模型接口未返回有效响应');
  }

  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        throw failure(502, 'agent_model_response_large', '模型响应过大，请缩小任务后重试');
      }

      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // 保留原始错误，取消读取失败不覆盖它。
    }

    if (error instanceof AgentModelError) throw error;
    throw failure(502, 'agent_model_response_invalid', '模型接口响应格式不正确');
  } finally {
    reader.releaseLock();
  }
}

export function createCompatibleAgentModel({
  baseUrl,
  apiKey,
  modelName,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30000,
  maxTokens = 3000,
  thinking = null,
}) {
  let endpoint;

  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error('invalid endpoint');
    }

    url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
    endpoint = url.href;
  } catch {
    throw new Error('模型接口地址必须是有效的 HTTPS 基础地址');
  }

  if (
    typeof apiKey !== 'string' ||
    !apiKey.trim() ||
    /\s/.test(apiKey) ||
    apiKey.length > 5000
  ) {
    throw new Error('启用真实模型前需要配置有效的服务端 API Key');
  }

  if (
    typeof modelName !== 'string' ||
    !modelName.trim() ||
    modelName.length > 120
  ) {
    throw new Error('请配置有效的模型名称');
  }

  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120000 ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 256 ||
    maxTokens > 8000 ||
    typeof fetchImpl !== 'function'
  ) {
    throw new Error('模型请求配置不正确');
  }

  if (thinking !== null && !['enabled', 'disabled'].includes(thinking)) {
    throw new Error('思考模式配置不正确');
  }

  return {
    provider: 'compatible',

    async generate({ task, instruction = '' }) {
      const messages = buildAgentMessages({ task, instruction });
      const body = JSON.stringify({
        model: modelName.trim(),
        messages,
        stream: false,
        response_format: { type: 'json_object' },
        max_tokens: maxTokens,
        ...(thinking === null ? {} : { thinking: { type: thinking } }),
      });

      if (body.length > 200000) {
        throw failure(400, 'agent_model_context_large', '任务上下文过大，请缩小历史内容后重试');
      }

      const controller = new AbortController();
      let timer;
      let timedOut = false;

      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(failure(
            504,
            'agent_model_timeout',
            '模型请求超时，已有内容仍保留，请稍后重试',
          ));
        }, timeoutMs);
      });

      async function execute() {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body,
          signal: controller.signal,
        });

        if (!response.ok) {
          if (response.body) {
            try {
              await response.body.cancel();
            } catch {
              // 不读取或展示上游错误正文。
            }
          }

          if ([401, 403].includes(response.status)) {
            throw failure(502, 'agent_model_auth', '模型服务认证失败，请检查服务端配置');
          }

          if (response.status === 429) {
            throw failure(429, 'agent_model_rate_limit', '模型服务暂时繁忙或额度不足，请稍后重试');
          }

          throw failure(502, 'agent_model_upstream', '模型服务暂时不可用，已有内容仍保留');
        }

        const payload = await readResponse(response);
        const choice = payload?.choices?.[0];

        if (
          choice?.finish_reason !== 'stop' ||
          choice.message?.refusal ||
          choice.message?.tool_calls?.length ||
          typeof choice.message?.content !== 'string'
        ) {
          throw failure(502, 'agent_model_incomplete', '模型未返回完整方案，请稍后重试');
        }

        let output;
        try {
          output = parseAgentModelOutput(task, choice.message.content);
        } catch {
          throw failure(502, 'agent_model_output_invalid', '模型方案格式不符合要求，请重新生成');
        }

        return {
          provider: 'compatible',
          simulated: false,
          output,
        };
      }

      try {
        return await Promise.race([execute(), timeout]);
      } catch (error) {
        if (timedOut) {
          throw failure(504, 'agent_model_timeout', '模型请求超时，已有内容仍保留，请稍后重试');
        }

        if (error instanceof AgentModelError) throw error;
        throw failure(502, 'agent_model_network', '模型连接失败，已有内容仍保留，请稍后重试');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}