import net from 'node:net';
import tls from 'node:tls';
import nodemailer from 'nodemailer';
import { runExternalRequest } from './external-request.js';

/**
 * A dedicated socket for one SMTP operation.
 * Only direct SMTP connections are supported here.
 */
export async function sendSmtpMail(options, message, requestOptions = {}) {
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

          socket = connectionOptions.secure
            ? tls.connect({
              ...connectionOptions.tls,
              ...settings,
              servername: connectionOptions.tls?.servername
                || connectionOptions.host,
            })
            : net.connect(settings);

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

      return await transport.sendMail(message);
    } finally {
      signal.removeEventListener('abort', abort);
      socket?.destroy();
      transport?.close();
    }
  }, requestOptions);
}