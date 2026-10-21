// -----------------------------------------------------------------------------
// One XMPP session of the bot account, over @xmpp/client (TCP: STARTTLS on
// 5222 or direct TLS on 5223).
//
// What @xmpp/client does not do for us, and this file does:
// - It authenticates over a clear-text stream when the server offers no
//   STARTTLS: here the password is never sent unless the stream is encrypted.
// - Its TLS sockets take no options: a self-signed certificate is accepted
//   only when the user ticked the option (one client per process: the patch
//   of the shared TLS socket is module-wide).
// - Its built-in reconnection retries every second forever, even with a wrong
//   password: it is stopped, the integration retries with a backoff instead
//   (src/app.js), each time with a fresh session.
// - A connection that dies silently (no TCP reset) is detected by an XMPP
//   ping every few minutes.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { client, xml } from '@xmpp/client';
import TlsSocket from '@xmpp/tls/lib/Socket.js';
import WebSocketConnection from '@xmpp/websocket/lib/Connection.js';
import { ERROR_KINDS, XmppError, classifyError } from './errors.js';

export const CONNECT_TIMEOUT_MS = 20_000;
export const PING_TIMEOUT_MS = 15_000;

// Options of every TLS socket @xmpp/client opens (direct TLS and STARTTLS).
const tlsOptions = { rejectUnauthorized: true, servername: undefined };
const connectTls = TlsSocket.prototype.connect;
TlsSocket.prototype.connect = function connect(options = {}, ...rest) {
  const { servername, ...others } = tlsOptions;
  return connectTls.call(
    this,
    { ...options, ...others, ...(servername ? { servername } : {}) },
    ...rest,
  );
};

/**
 * @typedef {object} SessionOptions
 * @property {string} domain the domain of the bot JID
 * @property {string} username the local part of the bot JID
 * @property {string} password
 * @property {string} resource
 * @property {string} [service] xmpp://host:port or xmpps://host:port; the domain (DNS SRV) when omitted
 * @property {boolean} [allowSelfSigned]
 */

/** A connected XMPP session: emits `stanza` (ltx element) and `closed` (Error|null). */
export class XmppSession extends EventEmitter {
  /** @param {SessionOptions} options */
  constructor(options) {
    super();
    this.options = options;
    this.xmpp = null;
    this.jid = null;
    this.closed = false;
  }

  /** Connects and authenticates; resolves with the bare JID, rejects with an XmppError. */
  async start(signal) {
    const { domain, username, password, resource, service, allowSelfSigned } = this.options;
    tlsOptions.rejectUnauthorized = !allowSelfSigned;
    // The certificate must name the XMPP domain, whatever host serves it (RFC 6120, 13.7.2.1).
    tlsOptions.servername = domain;
    const xmpp = client({
      service: service || domain,
      domain,
      resource,
      timeout: CONNECT_TIMEOUT_MS,
      credentials: async (authenticate, mechanisms, _fast, entity) => {
        if (!entity.isSecure()) {
          throw new XmppError(ERROR_KINDS.INSECURE, 'The server offers no encryption');
        }
        await authenticate({ username, password }, mechanisms[0]);
      },
    });
    this.xmpp = xmpp;
    xmpp.reconnect.stop();
    // TCP and TLS only: the encryption check and the TLS options do not apply to WebSocket.
    xmpp.transports = xmpp.transports.filter((Transport) => Transport !== WebSocketConnection);

    let failure = null;
    xmpp.on('error', (err) => {
      failure ??= err;
    });
    xmpp.on('stanza', (stanza) => this.emit('stanza', stanza));
    const onAbort = () => xmpp.stop().catch(() => {});
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const timeout = AbortSignal.timeout(CONNECT_TIMEOUT_MS);
      const address = await Promise.race([
        xmpp.start(),
        new Promise((_, reject) => {
          timeout.addEventListener('abort', () =>
            reject(new XmppError(ERROR_KINDS.TIMEOUT, 'No answer from the server')),
          );
        }),
      ]);
      this.jid = address;
    } catch (err) {
      await xmpp.stop().catch(() => {});
      throw classifyError(failure ?? err);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    // From now on, any disconnection ends the session.
    xmpp.on('error', (err) => {
      failure = err;
    });
    xmpp.on('status', (status) => {
      if (status === 'disconnect' || status === 'offline') {
        this.#close(failure ? classifyError(failure) : null);
      }
    });
    return this.jid.bare().toString();
  }

  #close(error) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.xmpp?.stop().catch(() => {});
    this.emit('closed', error);
  }

  async send(stanza) {
    if (this.closed || !this.xmpp) {
      throw new XmppError(ERROR_KINDS.UNREACHABLE, 'Not connected');
    }
    try {
      await this.xmpp.send(stanza);
    } catch (err) {
      throw classifyError(err);
    }
  }

  /** XMPP ping (XEP-0199) of the server: proves the stream still works. */
  async ping(timeoutMs = PING_TIMEOUT_MS) {
    if (this.closed || !this.xmpp) {
      throw new XmppError(ERROR_KINDS.UNREACHABLE, 'Not connected');
    }
    try {
      await this.xmpp.iqCaller.request(
        xml(
          'iq',
          { type: 'get', to: this.options.domain },
          xml('ping', { xmlns: 'urn:xmpp:ping' }),
        ),
        timeoutMs,
      );
    } catch (err) {
      // A server without XEP-0199 answers with an error: it is alive all the same.
      if (err?.name === 'StanzaError') {
        return;
      }
      throw classifyError(err);
    }
  }

  /** Leaves cleanly (unavailable presence, end of stream). */
  async stop() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const { xmpp } = this;
    try {
      if (xmpp?.status === 'online') {
        await xmpp.send(xml('presence', { type: 'unavailable' }));
      }
      await xmpp?.stop();
    } catch {
      // Already gone.
    }
  }
}
