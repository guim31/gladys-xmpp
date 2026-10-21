// -----------------------------------------------------------------------------
// The integration wired to the fake Gladys of the SDK and to a fake XMPP
// server (sessions answering like Prosody 13: the stanzas of
// test/fixtures/xmpp/ were recorded from it). No network, a virtual clock,
// manual sleeps and timers.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import parse from '@xmpp/xml/lib/parse.js';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { ERROR_KINDS, XmppError } from '../../src/xmpp/errors.js';

export const fixture = (name) =>
  readFileSync(new URL(`../fixtures/xmpp/${name}.xml`, import.meta.url), 'utf8').trim();

export const BOT = 'gladys@xmpp.test';
export const ALICE = 'alice@xmpp.test';
export const MALLORY = 'mallory@xmpp.test';
export const PASSWORD = 'robot-pass-123';
export const ROOM = 'famille@conference.xmpp.test';
export const START = Date.parse('2026-10-21T08:00:00Z');

export const BASE_CONFIG = {
  jid: BOT,
  password: PASSWORD,
  allowed_users: ALICE,
  rooms: ROOM,
  language: 'en',
};

const MUC_USER = 'http://jabber.org/protocol/muc#user';

const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const delay = (at) =>
  at === undefined ? '' : `<delay xmlns="urn:xmpp:delay" stamp="${new Date(at).toISOString()}"/>`;

/** A one-to-one message, shaped like chat-message.xml. */
export const chat = (from, body, { at, type = 'chat' } = {}) =>
  `<message type="${type}" from="${from}/phone" to="${BOT}"><body>${escape(body)}</body>${delay(at)}</message>`;

/** A room message, shaped like groupchat-message.xml. */
export const groupchat = (nick, body, { room = ROOM, at } = {}) =>
  `<message type="groupchat" from="${room}/${nick}" to="${BOT}/gladys"><body>${escape(body)}</body>${delay(at)}</message>`;

const occupantPresence = (room, nick, jid, statuses = [], type) =>
  `<presence${type ? ` type="${type}"` : ''} from="${room}/${nick}" to="${BOT}/gladys"><x xmlns="${MUC_USER}">${statuses
    .map((code) => `<status code="${code}"/>`)
    .join('')}<item jid="${jid}/res" role="participant" affiliation="none"/></x></presence>`;

class FakeSession extends EventEmitter {
  constructor(server, options) {
    super();
    this.server = server;
    this.options = options;
    this.closed = false;
  }

  async start() {
    this.server.starts += 1;
    if (this.server.down) {
      throw new XmppError(this.server.down, `Fake failure: ${this.server.down}`);
    }
    if (this.options.password !== PASSWORD) {
      throw new XmppError(ERROR_KINDS.BAD_LOGIN, 'not-authorized');
    }
    this.server.session = this;
    return `${this.options.username}@${this.options.domain}`;
  }

  async send(stanza) {
    if (this.closed) {
      throw new XmppError(ERROR_KINDS.UNREACHABLE, 'Not connected');
    }
    if (this.server.sendFails) {
      throw new XmppError(ERROR_KINDS.UNREACHABLE, 'write EPIPE');
    }
    this.server.sent.push(stanza);
    const to = stanza.attrs.to ?? '';
    if (stanza.is('presence') && stanza.getChild('x', 'http://jabber.org/protocol/muc')) {
      const [room, nick] = to.split('/');
      setImmediate(() => this.answerJoin(room, nick));
    }
  }

  answerJoin(room, nick) {
    const known = this.server.rooms.get(room);
    if (this.server.silentRooms.has(room)) {
      return;
    }
    if (!known) {
      this.deliver(occupantPresence(room, nick, `${BOT}`, ['201', '110']));
      return;
    }
    if (known.refuse) {
      this.deliver(
        `<presence type="error" from="${room}/${nick}"><error type="auth"><${known.refuse} xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error></presence>`,
      );
      return;
    }
    for (const [occupant, jid] of known.occupants) {
      this.deliver(occupantPresence(room, occupant, jid));
    }
    this.deliver(occupantPresence(room, nick, BOT, ['110']));
  }

  deliver(text) {
    if (!this.closed) {
      this.emit('stanza', parse(text));
    }
  }

  async ping() {
    if (this.closed || this.server.pingFails) {
      throw new XmppError(ERROR_KINDS.TIMEOUT, 'No pong');
    }
    this.server.pings += 1;
  }

  async stop() {
    this.closed = true;
  }

  /** The server ends the session (restart, network). */
  drop(error = new XmppError(ERROR_KINDS.UNREACHABLE, 'ECONNRESET')) {
    if (!this.closed) {
      this.closed = true;
      this.emit('closed', error);
    }
  }
}

/** A fake XMPP server: sessions, rooms, and everything the bot sent. */
export function createFakeServer() {
  const server = {
    down: null, // an error kind: every start fails with it
    starts: 0,
    pings: 0,
    pingFails: false,
    sendFails: false,
    session: null, // the last started session
    sessions: [],
    sent: [], // ltx elements
    rooms: new Map([
      [
        ROOM,
        {
          occupants: [
            ['Alice', ALICE],
            ['Mallory', MALLORY],
          ],
        },
      ],
    ]),
    silentRooms: new Set(),
  };
  server.createSession = (options) => {
    const session = new FakeSession(server, options);
    server.sessions.push(session);
    return session;
  };
  /** Delivers a stanza (XML text) to the bot, and lets it be handled. */
  server.deliver = async (text) => {
    server.session.deliver(text);
    await settle();
  };
  /** The messages the bot sent, as { to, type, body }. */
  server.messages = () =>
    server.sent
      .filter((stanza) => stanza.is('message'))
      .map((stanza) => ({
        to: stanza.attrs.to,
        type: stanza.attrs.type,
        body: stanza.getChildText('body'),
      }));
  return server;
}

export function createMemoryStore(initial = {}) {
  return {
    data: structuredClone(initial),
    writes: 0,
    async load() {
      return structuredClone(this.data);
    },
    async save(data) {
      this.data = structuredClone(data);
      this.writes += 1;
    },
    async flush() {},
  };
}

/** Lets pending promises and immediates settle. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Waits that a test ends by hand, moving the virtual clock. */
function manualWaits(clock) {
  const pending = [];
  const wait = (ms, signal) =>
    new Promise((resolve) => {
      const entry = { ms, resolve };
      pending.push(entry);
      signal?.addEventListener('abort', () => {
        pending.splice(pending.indexOf(entry) >>> 0, 1);
        resolve();
      });
    });
  /** Ends the oldest pending wait of this length (any length if omitted). */
  const end = async (ms) => {
    await settle();
    const index = pending.findIndex((entry) => ms === undefined || entry.ms === ms);
    if (index < 0) {
      throw new Error(`nothing is waiting${ms === undefined ? '' : ` ${ms} ms`}`);
    }
    const [entry] = pending.splice(index, 1);
    clock.time += entry.ms;
    entry.resolve();
    await settle();
    return entry.ms;
  };
  return { pending, wait, end };
}

export async function createWorld({
  config = BASE_CONFIG,
  stored = {},
  server = createFakeServer(),
  linkedUser,
} = {}) {
  const gladys = createFakeGladys({ config, linkedUser });
  const store = createMemoryStore(stored);
  const clock = { time: START };
  const sleeps = manualWaits(clock);
  const timers = manualWaits(clock);
  const app = registerHandlers(gladys, {
    createSession: server.createSession,
    store,
    now: () => clock.time,
    sleep: sleeps.wait,
    timer: timers.wait,
  });
  await gladys.connect();
  await settle();
  return {
    gladys,
    fake: gladys.fake,
    server,
    store,
    clock,
    sleeps: sleeps.pending,
    /** Ends the oldest retry sleep. */
    wake: () => sleeps.end(),
    /** Ends the oldest timer of this length (pings, join timeouts). */
    tick: (ms) => timers.end(ms),
    app,
  };
}
