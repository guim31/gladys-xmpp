// -----------------------------------------------------------------------------
// Integration configuration (the `config_schema` of the manifest), normalized
// so the rest of the code never deals with `undefined`, stray spaces or a
// half-typed address.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js).
export const DEFAULT_CONFIG = {
  jid: '',
  password: '',
  server: '',
  allow_self_signed: false,
  allowed_users: '',
  rooms: '',
  nickname: 'Gladys',
  command_prefix: '!',
  language: 'fr',
};

export const PORTS = { 'xmpp:': 5222, 'xmpps:': 5223 };

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

// A bare JID as people type it: local@domain, no resource, no space.
const BARE_JID = /^[^\s@/"&'<>:]+@[^\s@/"&'<>:#]+$/;

/** A bare JID in lower case, or null when the text is not one. */
export function parseBareJid(value) {
  const text = trimmed(value).toLowerCase();
  return BARE_JID.test(text) ? text : null;
}

/** Splits a list typed in a text field: commas, semicolons, spaces or new lines. */
export function parseList(value) {
  const items = trimmed(value)
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return [...new Set(items)];
}

/** The valid bare JIDs of a typed list, in lower case, without duplicates. */
export const parseJidList = (value) => [
  ...new Set(parseList(value).map(parseBareJid).filter(Boolean)),
];

/**
 * The server to connect to, as an @xmpp/client service URI:
 * - empty: null, the domain of the JID is looked up (DNS SRV records);
 * - `host` or `host:5222`: STARTTLS (xmpp://);
 * - `host:5223`, or any `xmpps://` address: direct TLS.
 * @returns {string|null|undefined} undefined when the text is not understood
 */
export function parseServer(value) {
  const text = trimmed(value).replace(/\/+$/, '');
  if (text === '') {
    return null;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text)?.[1]?.toLowerCase();
  if (scheme && !['xmpp', 'xmpps'].includes(scheme)) {
    return undefined;
  }
  try {
    const url = new URL(scheme ? `xmpp${text.slice(scheme.length)}` : `xmpp://${text}`);
    if (!url.hostname || url.username || url.password || (url.pathname && url.pathname !== '/')) {
      return undefined;
    }
    const port = Number(url.port) || (scheme === 'xmpps' ? PORTS['xmpps:'] : PORTS['xmpp:']);
    const direct = scheme === 'xmpps' || (!scheme && port === PORTS['xmpps:']);
    return `${direct ? 'xmpps' : 'xmpp'}://${url.hostname}:${port}`;
  } catch {
    return undefined;
  }
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = raw ?? {};
  const prefix = trimmed(config.command_prefix);
  // A nickname is a resource: no slash, at most 64 characters.
  const nickname = trimmed(config.nickname)
    .replace(/[/\s]+/g, ' ')
    .slice(0, 64)
    .trim();
  return {
    jid: trimmed(config.jid),
    password: typeof config.password === 'string' ? config.password : '',
    server: trimmed(config.server),
    allow_self_signed: config.allow_self_signed === true || config.allow_self_signed === 'true',
    allowed_users: parseJidList(config.allowed_users),
    rooms: parseJidList(config.rooms),
    nickname: nickname || DEFAULT_CONFIG.nickname,
    // One to three characters, no space: "!" by default, "/" for the habits of Telegram.
    command_prefix:
      prefix === '' || prefix.length > 3 || /\s/.test(prefix)
        ? DEFAULT_CONFIG.command_prefix
        : prefix,
    language: LANGUAGES.includes(config.language) ? config.language : DEFAULT_CONFIG.language,
  };
}
