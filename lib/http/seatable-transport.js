import { createRequire } from 'node:module';
import {
  DEFAULT_EXTERNAL_TIMEOUT_MS,
  runExternalRequest,
} from './external-request.js';

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('seatable-api'));
const axios = sdkRequire('axios');
let installed = false;

/**
 * Install before SDK authentication creates its HTTP clients.
 * Applies to the Axios copy resolved by seatable-api in this process.
 */
export function installSeaTableTransport() {
  if (installed) return;

  const originalAdapter = axios.getAdapter(axios.defaults.adapter);

  axios.defaults.adapter = async config => {
    const timeoutMs = config.timeout > 0
      ? config.timeout
      : DEFAULT_EXTERNAL_TIMEOUT_MS;

    const result = await runExternalRequest(async signal => {
      try {
        const response = await originalAdapter({
          ...config,
          signal,
          // The shared deadline also covers connection and body reading.
          timeout: 0,
        });
        return { response };
      } catch (error) {
        // Preserve HTTP status for existing upstream error handling.
        if (error.response) return { httpError: error };
        throw error;
      }
    }, {
      timeoutMs,
      signal: config.signal,
    });

    if (result.httpError) throw result.httpError;
    return result.response;
  };

  installed = true;
}