import net from 'node:net';
import tls from 'node:tls';
import nodemailer from 'nodemailer';
import { runExternalRequest } from './external-request.js';

/**
 * 一次 SMTP 传输失败后，这封信还能不能安全重发，只取决于服务器有没有拿到正文：
 *
 * - `not_sent`：连接、握手、认证、信封（MAIL FROM / RCPT TO）阶段失败，正文一个字都
 *   没出去；服务器回了 4xx/5xx 也一样——负回执意味着这封信没有被接收。
 * - 不标记：`DATA` 已经写上线之后连接断了。服务器可能已经收下，只是回执没送到，
 *   重发就会重复投递，调用方只能记为「结果不明」。
 *
 * 判据用「DATA 是否已经写出」而不是 nodemailer 的 `error.code`：断在哪一步，
 * `code` 都只说 `ECONNECTION`，不说是哪一步。
 */
function smtpFailureOutcome(error, dataStarted) {
  if (!error || typeof error !== 'object') return undefined;
  // 服务器回过话：错误里带的必然是负回执，这封信没被接收。
  if (Number.isInteger(error.responseCode)) return 'not_sent';
  // DATA 还没写出，正文不可能已经交出去。
  if (!dataStarted) return 'not_sent';
  return undefined;
}

/** 命令按整段 buffer 写出（pipelining 时 MAIL/RCPT/DATA 同段），逐行匹配即可。 */
const DATA_COMMAND = /(?:^|\r\n)DATA\r\n/;
/** 只看开头一小段：正文块不必整段解码。 */
const COMMAND_WINDOW = 512;

function commandHead(chunk) {
  if (typeof chunk === 'string') return chunk.slice(0, COMMAND_WINDOW);
  if (chunk && typeof chunk.subarray === 'function') {
    return Buffer.from(chunk.subarray(0, COMMAND_WINDOW)).toString('latin1');
  }
  return '';
}

/**
 * A dedicated socket for one SMTP operation.
 * Only direct SMTP connections are supported here.
 *
 * `onDataStart` 在 `DATA` 写进 socket 之前触发，调用方用来把「正文已经发出」落盘：
 * 进程若在等回执时退出，重启后才能判定为结果不明，而不是重发一遍。
 */
export async function sendSmtpMail(options, message, requestOptions = {}) {
  const { onDataStart, ...externalOptions } = requestOptions || {};
  let dataStarted = false;

  const noteDataStart = () => {
    if (dataStarted) return;
    dataStarted = true;
    try {
      onDataStart?.();
    } catch {
      // 落盘失败不能阻断发送；本进程内仍按 dataStarted 判断，异常时退化为结果不明。
    }
  };

  return runExternalRequest(async signal => {
    let socket;
    let transport;

    const abort = () => {
      socket?.destroy();
    };

    signal.addEventListener('abort', abort, { once: true });

    try {
      signal.throwIfAborted();

      transport = nodemailer.createTransport({
        ...options,
        pool: false,
        getSocket(connectionOptions, callback) {
          if (signal.aborted) {
            callback(signal.reason);
            return;
          }

          let returned = false;
          const done = (error, value) => {
            if (returned) return;
            returned = true;
            callback(error, value);
          };

          const settings = {
            host: connectionOptions.host,
            port: connectionOptions.port
              || (connectionOptions.secure ? 465 : 587),
          };
          // SNI identifies a DNS host, never an IPv4/IPv6 address (Node 26
          // rejects IP literals). Keep an explicit hostname or empty SNI;
          // omitting SNI still verifies an IP certificate against `host`.
          const servername = connectionOptions.tls?.servername
            ?? connectionOptions.host ?? 'localhost';

          socket = connectionOptions.secure
            ? tls.connect({
              ...connectionOptions.tls,
              ...settings,
              servername: net.isIP(servername) ? undefined : servername,
            })
            : net.connect(settings);

          // 先记「DATA 已写出」再真正写 socket：顺序反了，进程恰好在两者之间退出，
          // 重启后就会以为正文没发出去而重发一遍。
          const write = socket.write;
          socket.write = function (chunk, ...rest) {
            if (!dataStarted && DATA_COMMAND.test(commandHead(chunk))) noteDataStart();
            return write.call(this, chunk, ...rest);
          };

          socket.once('error', error => done(error));
          socket.once('close', () => done(
            signal.aborted
              ? signal.reason
              : new Error('SMTP connection closed before setup completed'),
          ));

          socket.once(
            connectionOptions.secure ? 'secureConnect' : 'connect',
            () => {
              if (signal.aborted) {
                socket.destroy();
                done(signal.reason);
                return;
              }
              done(null, {
                connection: socket,
                secured: Boolean(connectionOptions.secure),
              });
            },
          );
        },
      });

      try {
        return await transport.sendMail(message);
      } catch (error) {
        const outcome = smtpFailureOutcome(error, dataStarted);
        if (outcome && error && typeof error === 'object') error.deliveryOutcome = outcome;
        throw error;
      }
    } finally {
      signal.removeEventListener('abort', abort);
      socket?.destroy();
      transport?.close();
    }
  }, { ...externalOptions, service:'smtp', operation:'send' });
}
