// -----------------------------------------------------------------------------
// Errors of the XMPP side, sorted into a few kinds the user can act on
// (src/texts.js explains each one in four languages).
// -----------------------------------------------------------------------------

export const ERROR_KINDS = {
  NOT_CONFIGURED: 'not_configured',
  INVALID_JID: 'invalid_jid',
  INVALID_SERVER: 'invalid_server',
  NO_PASSWORD: 'no_password',
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'timeout',
  BAD_LOGIN: 'bad_login',
  INSECURE: 'insecure',
  CERTIFICATE: 'certificate',
  HOST_UNKNOWN: 'host_unknown',
  REPLACED: 'replaced',
  REJECTED: 'rejected',
  INVALID_TARGET: 'invalid_target',
  NOT_IN_ROOM: 'not_in_room',
  SERVER: 'server',
};

// Worth retrying soon: the network, the server restarting, another login.
export const TRANSIENT_KINDS = new Set([
  ERROR_KINDS.UNREACHABLE,
  ERROR_KINDS.TIMEOUT,
  ERROR_KINDS.REPLACED,
  ERROR_KINDS.SERVER,
]);

export class XmppError extends Error {
  constructor(kind, message, options) {
    super(message, options);
    this.name = 'XmppError';
    this.kind = kind;
  }
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EPIPE',
]);

// Node TLS verification failures (tls.connect).
const CERTIFICATE_CODES = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/;

/** Sorts any error thrown by @xmpp/client (or the network below) into an XmppError. */
export function classifyError(err) {
  if (err instanceof XmppError) {
    return err;
  }
  const code = err?.code ?? err?.cause?.code;
  const message = err?.message ?? String(err);
  let kind = ERROR_KINDS.SERVER;
  if (err?.name === 'SASLError') {
    // not-authorized, account-disabled, credentials-expired...: the account, not the network.
    kind = ERROR_KINDS.BAD_LOGIN;
  } else if (typeof code === 'string' && CERTIFICATE_CODES.test(code)) {
    kind = ERROR_KINDS.CERTIFICATE;
  } else if (NETWORK_CODES.has(code) || /couldn't connect|no compatible/i.test(message)) {
    kind = ERROR_KINDS.UNREACHABLE;
  } else if (err?.name === 'TimeoutError') {
    kind = ERROR_KINDS.TIMEOUT;
  } else if (err?.name === 'StreamError') {
    if (err.condition === 'conflict') {
      kind = ERROR_KINDS.REPLACED;
    } else if (['host-unknown', 'improper-addressing'].includes(err.condition)) {
      kind = ERROR_KINDS.HOST_UNKNOWN;
    } else if (err.condition === 'policy-violation') {
      kind = ERROR_KINDS.REJECTED;
    }
  } else if (message === 'STARTTLS_FAILURE') {
    kind = ERROR_KINDS.INSECURE;
  }
  return new XmppError(kind, message, { cause: err });
}
