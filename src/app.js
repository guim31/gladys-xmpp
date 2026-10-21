// -----------------------------------------------------------------------------
// The integration: an XMPP bot account wired to Gladys.
//
// - One session at a time (src/xmpp/connection.js), started again with a
//   backoff when it ends. Only the people of the "allowed" list are ever
//   answered or obeyed; everybody else is ignored.
// - One-to-one `chat` messages of an allowed person are a conversation with
//   Gladys (manifest `type: "communication"`): a link code links the XMPP
//   address to a Gladys user, then the messages go to the brain
//   (publishMessage) and the answers come back through onSendMessage.
// - Watched rooms (XEP-0045, configuration) only fire scenes: every message
//   of an allowed person fires `message_received`, a message starting with
//   the command prefix also fires `command_received`. Gladys never answers in
//   a room, where others can read.
// - Scene action `send_message`: a message to an address or a watched room.
// - Triggers `connection_lost` / `connection_restored`, the connection status
//   of the Configuration screen, the widget and the `test_connection` action.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, parseBareJid, parseServer } from './config.js';
import { XmppSession } from './xmpp/connection.js';
import { ERROR_KINDS, TRANSIENT_KINDS, XmppError } from './xmpp/errors.js';
import {
  MUC_STATUS,
  availablePresence,
  chatMessage,
  groupchatMessage,
  joinPresence,
  leavePresence,
  readMessage,
  readRoomPresence,
} from './xmpp/stanzas.js';
import { createFailureLog } from './log.js';
import { Store } from './store.js';
import { BOT_TEXT, REPORT_TEXT, ROOMS_STATUS, each, errorText, errorTexts, pick } from './texts.js';
import { CONNECTION, TEST_ACTION, WIDGET_KEY, buildWidgetContent } from './widgets.js';

const logger = createLogger({ name: 'xmpp' });

export const ACTION_KEY = 'test_connection';
export const SCENE_ACTION_KEY = 'send_message';
export const TRIGGERS = {
  MESSAGE: 'message_received',
  COMMAND: 'command_received',
  LOST: 'connection_lost',
  RESTORED: 'connection_restored',
};

// The resource of the bot: fixed, so a restart replaces a session left behind.
export const RESOURCE = 'gladys';
// Messages older than this when the bot reads them (offline messages kept by
// the server while Gladys was down) are skipped: a "!open garage" from two
// hours ago must not run now.
export const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;
// The connection is declared lost after failures lasting this long, never on one blip.
export const LOST_AFTER_MS = 60 * 1000;
export const RETRY_DELAYS_MS = [2000, 5000, 10_000, 30_000, 60_000];
// Refused credentials or certificate: retry slowly, in case the server is the cause.
export const CREDENTIALS_RETRY_MS = 5 * 60 * 1000;
// Another connection with the same resource took over: do not fight it every 2 s.
export const REPLACED_RETRY_MS = 60 * 1000;
// An XMPP ping of the server this often: a silently dead TCP connection is noticed.
export const PING_INTERVAL_MS = 2 * 60 * 1000;
export const JOIN_TIMEOUT_MS = 10_000;
export const RECENT_KEPT = 5;
// Gladys waits 5 s for the ack of a message: answer before, even if the server is slow.
export const MESSAGE_TIMEOUT_MS = 4500;
// How long a message of Gladys waits for the first connection, within that deadline.
export const CONNECT_WAIT_MS = 2000;
// Gladys link codes: 8 characters of an alphabet without 0/O/1/I/L.
// Join errors worth a new attempt (the others: forbidden, not a member, banned...).
const TRANSIENT_JOIN_ERRORS = new Set([
  'service-unavailable',
  'remote-server-not-found',
  'remote-server-timeout',
  'internal-server-error',
  'resource-constraint',
  'recipient-unavailable',
  'timeout',
]);
const LINK_CODE = /^[A-HJ-KM-NP-Z2-9]{8}$/i;
const MAX_TEXT_LENGTH = 4096; // the limit of publishMessage

/** Parses a command: "!lights off" → { command: "lights", args: "off" }. */
export function parseCommand(text, prefix) {
  if (!text.startsWith(prefix)) {
    return null;
  }
  const rest = text.slice(prefix.length);
  const match = rest.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) {
    return null;
  }
  return { command: match[1].toLowerCase(), args: (match[2] ?? '').trim() };
}

const defaultSleep = (ms, signal) =>
  new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {object} [options] replaced by the tests
 * @param {(options: object) => XmppSession} [options.createSession]
 * @param {{ load(): Promise<object>, save(data: object): Promise<void>, flush(): Promise<void> }} [options.store]
 * @param {() => number} [options.now] milliseconds
 * @param {(ms: number, signal: AbortSignal) => Promise<void>} [options.sleep] waits between attempts
 * @param {(ms: number, signal: AbortSignal) => Promise<void>} [options.timer] waits between pings, joins
 */
export function registerHandlers(gladys, options = {}) {
  const {
    createSession = (sessionOptions) => new XmppSession(sessionOptions),
    store = new Store(),
    now = () => Date.now(),
    sleep = defaultSleep,
    timer = defaultSleep,
  } = options;

  let data = {}; // persisted: { recent }
  const loaded = store.load().then((stored) => {
    data = stored ?? {};
  });

  let config = normalizeConfig({});
  let sessionOptions = null; // null: not configured (see configError)
  let session = null; // the connected session, or null
  let botJid = null; // the bare JID of the bot once connected
  let configError = new XmppError(ERROR_KINDS.NOT_CONFIGURED, 'Not configured yet');
  let connection = CONNECTION.NOT_CONFIGURED;
  let lastError = null;
  // Watched room → { joined, nick, occupants: Map(nick → real bare JID), failed, rejoin, waiter }
  let rooms = new Map();
  let controller = null; // aborts the running loop
  let running = null; // the running loop
  let stopped = false;
  let lastStatus = null;
  let lostFired = false; // connection_lost was fired: connection_restored may follow
  let applying = Promise.resolve(); // configurations are applied one at a time
  let readyWaiters = []; // onSendMessage calls waiting for the first connection
  const statusLog = createFailureLog(logger, { recovered: 'Connection status published again' });
  const connectLog = createFailureLog(logger, { recovered: 'XMPP connection works again' });
  const brainLog = createFailureLog(logger, { recovered: 'Messages reach Gladys again' });

  // --- Gladys side effects, never fatal --------------------------------------

  async function publishStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === lastStatus || !gladys.connected) {
      return;
    }
    try {
      await gladys.setConnectionStatus(connected, message);
      lastStatus = key;
      statusLog.ok();
    } catch (err) {
      statusLog.fail(`Cannot publish the connection status: ${err.message}`);
    }
  }

  async function fire(key, payload) {
    try {
      await gladys.publishSceneEvent(key, payload);
    } catch (err) {
      logger.warn(`Cannot fire the "${key}" trigger: ${err.message}`);
    }
  }

  function refreshWidget() {
    try {
      gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch (err) {
      logger.debug(`Widget refresh not requested: ${err.message}`);
    }
  }

  function setConnection(next) {
    if (connection !== next) {
      connection = next;
      refreshWidget();
    }
  }

  const joinedCount = () => [...rooms.values()].filter((room) => room.joined).length;
  const failedRooms = () =>
    [...rooms.entries()].filter(([, room]) => room.failed).map(([jid]) => jid);

  // --- Rooms -----------------------------------------------------------------------

  function newRoom() {
    return {
      joined: false,
      nick: config.nickname,
      occupants: new Map(),
      failed: '',
      rejoin: false,
      waiter: null,
    };
  }

  /** Joins a watched room; resolves once the room answered, or after JOIN_TIMEOUT_MS. */
  async function joinRoom(current, jid, signal) {
    const room = rooms.get(jid);
    room.joined = false;
    room.failed = '';
    room.occupants.clear();
    const answered = new Promise((resolve) => {
      room.waiter = resolve;
    });
    // The timeout ends with the answer (or the session): no timer left behind.
    const done = new AbortController();
    const onAbort = () => done.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await current.send(joinPresence(jid, room.nick));
      await Promise.race([answered, timer(JOIN_TIMEOUT_MS, done.signal)]);
    } finally {
      done.abort();
      signal?.removeEventListener('abort', onAbort);
    }
    if (room.waiter) {
      room.waiter = null;
      if (signal?.aborted) {
        return;
      }
      room.failed = 'timeout';
      room.rejoin = true; // tried again at the next ping
      logger.warn(`The room ${jid} did not answer the join`);
    }
  }

  async function joinRooms(current, signal) {
    await Promise.all(config.rooms.map((jid) => joinRoom(current, jid, signal)));
  }

  function settleJoin(room) {
    room.waiter?.();
    room.waiter = null;
  }

  function handleRoomPresence(presence) {
    const room = rooms.get(presence.room);
    if (!room) {
      return;
    }
    const self = presence.statuses.includes(MUC_STATUS.SELF) || presence.nick === room.nick;
    if (presence.type === 'error') {
      if (presence.nick === room.nick && !room.joined) {
        room.failed = presence.errorCondition || 'error';
        // The room service restarting or unreachable: tried again at the next ping.
        room.rejoin = TRANSIENT_JOIN_ERRORS.has(room.failed);
        logger.warn(`Cannot join the watched room ${presence.room}: ${room.failed}`);
        settleJoin(room);
        refreshWidget();
      }
      return;
    }
    if (presence.type === 'unavailable') {
      if (!self) {
        room.occupants.delete(presence.nick);
        return;
      }
      if (room.joined) {
        room.joined = false;
        room.failed = 'left';
        logger.warn(`The bot is no longer in the room ${presence.room}`);
        // Banned or kicked: stay out. Otherwise (room service restarted...) the next ping rejoins.
        room.rejoin = ![MUC_STATUS.BANNED, MUC_STATUS.KICKED].some((code) =>
          presence.statuses.includes(code),
        );
        refreshWidget();
      }
      return;
    }
    if (!self) {
      room.occupants.set(presence.nick, presence.realJid);
      return;
    }
    if (presence.statuses.includes(MUC_STATUS.CREATED)) {
      // The room did not exist: joining created it. Leave it (it vanishes) rather
      // than keep a room nobody else can enter, born from a typo.
      session?.send(leavePresence(presence.room, room.nick)).catch(() => {});
      room.failed = 'item-not-found';
      logger.warn(`The watched room ${presence.room} does not exist`);
      settleJoin(room);
      return;
    }
    if (!room.joined) {
      room.joined = true;
      room.failed = '';
      room.rejoin = false;
      logger.info(`Joined the watched room ${presence.room}`);
      settleJoin(room);
      refreshWidget();
    }
  }

  // --- Connection ----------------------------------------------------------------

  const roomsStatus = () => {
    const failed = failedRooms();
    return failed.length > 0 ? each(ROOMS_STATUS, (text) => text(failed.join(', '))) : undefined;
  };

  async function markConnected() {
    lastError = null;
    setConnection(CONNECTION.CONNECTED);
    readyWaiters.splice(0).forEach((wake) => wake());
    await publishStatus(true, roomsStatus());
    if (lostFired) {
      lostFired = false;
      logger.info('XMPP connection restored');
      await fire(TRIGGERS.RESTORED, { user: botJid ?? '' });
    }
  }

  /** Resolves once the bot is connected, or after `ms` at most. */
  function whenConnected(ms) {
    if (session && connection === CONNECTION.CONNECTED) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(wait);
        resolve();
      };
      const wait = setTimeout(() => {
        readyWaiters = readyWaiters.filter((entry) => entry !== wake);
        resolve();
      }, ms);
      readyWaiters.push(wake);
    });
  }

  /**
   * Resolves with the error that ended the session (null for an abort), pinging
   * the server meanwhile. The session may have ended before this is called.
   */
  function untilClosed(current, signal) {
    const ended = (error) =>
      error ?? new XmppError(ERROR_KINDS.UNREACHABLE, 'Connection closed by the server');
    if (signal.aborted) {
      return Promise.resolve(null);
    }
    if (current.closed) {
      return Promise.resolve(ended(current.closeError));
    }
    // Ends the pings and the listeners with the session.
    const watch = new AbortController();
    const onAbort = () => watch.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    return new Promise((resolve) => {
      const finish = (value) => {
        resolve(value);
        current.off('closed', onClosed);
        signal.removeEventListener('abort', onAbort);
        watch.abort();
      };
      const onClosed = (error) => finish(ended(error));
      current.once('closed', onClosed);
      watch.signal.addEventListener('abort', () => finish(null), { once: true });
      (async () => {
        while (!watch.signal.aborted) {
          await timer(PING_INTERVAL_MS, watch.signal);
          if (watch.signal.aborted) {
            return;
          }
          try {
            await current.ping();
            logger.debug('XMPP ping answered');
          } catch (err) {
            if (!current.closed) {
              current.stop();
            }
            finish(err);
            return;
          }
          for (const [jid, room] of rooms) {
            if (room.rejoin && !room.joined) {
              room.rejoin = false;
              joinRoom(current, jid, watch.signal).catch(() => {});
            }
          }
        }
      })();
    });
  }

  // --- The connection loop ---------------------------------------------------------

  async function loop(signal) {
    let failingSince = null;
    let attempt = 0;
    while (!signal.aborted) {
      const current = createSession(sessionOptions);
      try {
        current.on('stanza', (stanza) => {
          handleStanza(current, stanza).catch((err) =>
            logger.warn(`Stanza not handled: ${err.message}`),
          );
        });
        const address = await current.start(signal);
        if (signal.aborted) {
          await current.stop();
          return;
        }
        botJid = parseBareJid(address);
        session = current;
        await current.send(availablePresence());
        await joinRooms(current, signal);
        if (signal.aborted) {
          await current.stop();
          return;
        }
        failingSince = null;
        attempt = 0;
        connectLog.ok();
        logger.info(`Connected to XMPP as ${botJid}`);
        await markConnected();
        const ended = await untilClosed(current, signal);
        session = null;
        if (ended === null) {
          await current.stop();
          return;
        }
        throw ended;
      } catch (err) {
        session = null;
        if (signal.aborted) {
          await current.stop();
          return;
        }
        const error =
          err instanceof XmppError ? err : new XmppError(ERROR_KINDS.SERVER, err.message);
        const transient = TRANSIENT_KINDS.has(error.kind);
        lastError = error;
        let delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
        attempt += 1;
        if (!transient) {
          // The configuration is wrong: say it, and retry slowly in case the server is the cause.
          delay = CREDENTIALS_RETRY_MS;
        } else if (error.kind === ERROR_KINDS.REPLACED) {
          delay = Math.max(delay, REPLACED_RETRY_MS);
        }
        failingSince ??= now();
        connectLog.fail(`XMPP connection failed: ${error.message}`);
        if (!transient || now() - failingSince >= LOST_AFTER_MS) {
          if (connection !== CONNECTION.DISCONNECTED) {
            const wasConnected = connection === CONNECTION.CONNECTED;
            setConnection(CONNECTION.DISCONNECTED);
            logger.warn(`XMPP connection lost: ${error.message}`);
            if (wasConnected) {
              lostFired = true;
              await fire(TRIGGERS.LOST, { error: errorText(error, config.language) });
            }
          }
          await publishStatus(false, errorTexts(error));
        } else {
          // Try again when the minute is over, so the loss is declared on time.
          delay = Math.max(1000, Math.min(delay, failingSince + LOST_AFTER_MS - now()));
        }
        await sleep(delay, signal);
      }
    }
  }

  // --- Incoming stanzas ------------------------------------------------------------

  async function handleStanza(current, stanza) {
    if (current !== session && current.closed) {
      return;
    }
    const presence = readRoomPresence(stanza);
    if (presence) {
      handleRoomPresence(presence);
      return;
    }
    const message = readMessage(stanza);
    if (!message || message.body.trim() === '') {
      return; // chat states, receipts, room subjects, everything without a text
    }
    if (message.type === 'error') {
      logger.debug(`Message to ${message.from.bare} bounced: ${message.errorCondition}`);
      return;
    }
    if (message.type === 'groupchat') {
      await handleRoomMessage(message);
    } else if (message.type === 'chat') {
      await handleConversation(message);
    }
    // Headline and normal messages (server announcements...) are ignored.
  }

  async function handleRoomMessage(message) {
    const jid = message.from.bare;
    const room = rooms.get(jid);
    if (!room?.joined || message.delayedAt !== null) {
      return; // not a watched room, or its history: never replayed
    }
    const nick = message.from.resource;
    if (nick === room.nick || nick === '') {
      return; // the echo of what the bot wrote: no loop between a scene and its triggers
    }
    const sender = room.occupants.get(nick) ?? '';
    if (!config.allowed_users.includes(sender)) {
      logger.debug(`Message of ${nick} in ${jid} ignored: not an allowed person`);
      return;
    }
    const text = message.body.trim();
    data.recent = [
      { room: jid, sender: nick, text: text.slice(0, 500), at: new Date(now()).toISOString() },
      ...(data.recent ?? []),
    ].slice(0, RECENT_KEPT);
    store.save(data);
    refreshWidget();
    logger.debug(`Message from ${sender} in ${jid}`);
    const common = { room: jid, sender, nickname: nick, text: text.slice(0, 1000) };
    await fire(TRIGGERS.MESSAGE, common);
    const command = parseCommand(text, config.command_prefix);
    if (command) {
      await fire(TRIGGERS.COMMAND, {
        ...common,
        command: command.command.slice(0, 1000),
        arguments: command.args.slice(0, 1000),
      });
    }
  }

  async function reply(to, text) {
    try {
      await session?.send(chatMessage(to, text));
    } catch (err) {
      logger.warn(`Cannot answer in XMPP: ${err.message}`);
    }
  }

  async function handleConversation(message) {
    const sender = message.from.bare;
    if (sender === botJid) {
      return; // another session of the bot account
    }
    if (rooms.has(sender)) {
      return; // a private message through a room: the sender is a nickname, not an address
    }
    if (!config.allowed_users.includes(sender)) {
      logger.debug(`Message from ${sender} ignored: not an allowed person`);
      return;
    }
    if (message.delayedAt !== null && message.delayedAt < now() - MAX_MESSAGE_AGE_MS) {
      logger.debug(`Message from ${sender} skipped: too old`);
      return;
    }
    const text = message.body.trim();
    if (LINK_CODE.test(text)) {
      try {
        const user = await gladys.linkContact(text.toUpperCase(), sender, sender);
        logger.info(`XMPP address ${sender} linked to a Gladys user`);
        const language = BOT_TEXT[user?.language] ? user.language : config.language;
        await reply(sender, pick(BOT_TEXT, language).linked(user?.first_name || sender));
        return;
      } catch (err) {
        if (err?.status !== 404) {
          logger.warn(`Cannot link ${sender}: ${err.message}`);
          await reply(sender, pick(BOT_TEXT, config.language).unavailable);
          return;
        }
        // Not a valid code: maybe a word that looks like one, for the brain.
      }
    }
    try {
      await gladys.publishMessage(sender, text.slice(0, MAX_TEXT_LENGTH), {
        createdAt: new Date(message.delayedAt ?? now()),
      });
      brainLog.ok();
      logger.debug(`Message from ${sender} passed to Gladys`);
    } catch (err) {
      if (err?.status === 404) {
        logger.info(`Message from ${sender}, whose address is not linked: instructions sent`);
        await reply(sender, pick(BOT_TEXT, config.language).notLinked);
        return;
      }
      brainLog.fail(`Cannot pass a message to Gladys: ${err.message}`);
      await reply(sender, pick(BOT_TEXT, config.language).unavailable);
    }
  }

  // --- Configuration -------------------------------------------------------------

  async function stopLoop() {
    controller?.abort();
    await running;
    controller = null;
    running = null;
  }

  function applyConfig(raw) {
    // Serialized: two saves in a row must never leave two sessions running.
    applying = applying.then(() => doApplyConfig(raw));
    return applying;
  }

  async function doApplyConfig(raw) {
    await loaded;
    await stopLoop();
    config = normalizeConfig(raw);
    session = null;
    botJid = null;
    lastError = null;
    lostFired = false;
    sessionOptions = null;
    rooms = new Map(config.rooms.map((jid) => [jid, newRoom()]));
    const jid = parseBareJid(config.jid);
    const service = parseServer(config.server);
    if (!config.jid) {
      configError = new XmppError(ERROR_KINDS.NOT_CONFIGURED, 'No bot address');
    } else if (!jid) {
      configError = new XmppError(ERROR_KINDS.INVALID_JID, 'Bot address not understood');
    } else if (service === undefined) {
      configError = new XmppError(ERROR_KINDS.INVALID_SERVER, 'Server not understood');
    } else if (!config.password) {
      configError = new XmppError(ERROR_KINDS.NO_PASSWORD, 'No password');
    } else {
      configError = null;
    }
    if (configError) {
      setConnection(CONNECTION.NOT_CONFIGURED);
      await publishStatus(false, errorTexts(configError));
      return;
    }
    const [username, domain] = jid.split('@');
    sessionOptions = {
      domain,
      username,
      password: config.password,
      resource: RESOURCE,
      service: service ?? undefined,
      allowSelfSigned: config.allow_self_signed,
    };
    if (stopped) {
      return;
    }
    // Stays "connected" during a short outage: lost only after LOST_AFTER_MS (see loop).
    setConnection(CONNECTION.CONNECTING);
    controller = new AbortController();
    running = loop(controller.signal).catch((err) => logger.error('XMPP loop stopped', err));
  }

  function requireConnected() {
    if (!sessionOptions) {
      throw configError;
    }
    if (!session) {
      throw lastError ?? new XmppError(ERROR_KINDS.UNREACHABLE, 'Not connected to XMPP yet');
    }
    return session;
  }

  async function testConnection() {
    if (!sessionOptions) {
      return each(REPORT_TEXT, (text, lang) => text.failed(errorText(configError, lang)));
    }
    try {
      await requireConnected().ping();
      const lines = (text) => [
        text.connected(botJid),
        config.rooms.length > 0 ? text.rooms(joinedCount(), config.rooms.length) : text.noRooms,
        config.allowed_users.length > 0 ? text.users(config.allowed_users.length) : text.noUsers,
      ];
      return each(REPORT_TEXT, (text) => lines(text).join(' '));
    } catch (err) {
      return each(REPORT_TEXT, (text, lang) => text.failed(errorText(err, lang)));
    }
  }

  // --- Handlers ------------------------------------------------------------------

  gladys.onSendMessage(async (contact, message) => {
    const contactId = typeof contact?.id === 'string' ? contact.id : '';
    // Right after a start (the "Gladys updated" message), the bot may still be logging in.
    await whenConnected(CONNECT_WAIT_MS);
    if (!config.allowed_users.includes(contactId)) {
      // Linked once, then removed from the allowed people: nothing goes out to them.
      logger.debug(
        `Message to ${contactId || 'an unknown contact'} not sent: not an allowed person`,
      );
      return;
    }
    const text = typeof message?.text === 'string' ? message.text : '';
    if (text.trim() === '') {
      return; // an image alone: not supported over XMPP (see the documentation)
    }
    try {
      const deadline = AbortSignal.timeout(MESSAGE_TIMEOUT_MS - CONNECT_WAIT_MS);
      await Promise.race([
        requireConnected().send(chatMessage(contactId, text)),
        new Promise((_, reject) =>
          deadline.addEventListener('abort', () =>
            reject(new XmppError(ERROR_KINDS.TIMEOUT, 'No answer in time')),
          ),
        ),
      ]);
    } catch (err) {
      logger.warn(`Message not delivered to ${contactId}: ${err.message}`);
      throw new Error(`XMPP: ${errorText(err, 'en')}`, { cause: err });
    }
  });

  gladys.onSceneAction(SCENE_ACTION_KEY, async (fields) => {
    const to = parseBareJid(typeof fields?.to === 'string' ? fields.to : '');
    const text = typeof fields?.message === 'string' ? fields.message : '';
    if (text.trim() === '') {
      throw new Error('XMPP: the recipient and the message are required');
    }
    try {
      if (!to) {
        throw new XmppError(ERROR_KINDS.INVALID_TARGET, 'Recipient not understood');
      }
      const current = requireConnected();
      const room = rooms.get(to);
      if (room) {
        if (!room.joined) {
          throw new XmppError(ERROR_KINDS.NOT_IN_ROOM, 'Not in the room');
        }
        await current.send(groupchatMessage(to, text));
      } else {
        await current.send(chatMessage(to, text));
      }
      logger.info(`Scene message sent to ${to}`);
      return { sent: true, error: '' };
    } catch (err) {
      logger.warn(`Scene message not sent to ${to ?? fields?.to}: ${err.message}`);
      return { sent: false, error: errorText(err, config.language) };
    }
  });

  gladys.onAction(ACTION_KEY, () => testConnection());

  gladys.onWidgetGet(WIDGET_KEY, async ({ language }) => {
    await loaded;
    return buildWidgetContent(
      {
        connection,
        userId: botJid,
        rooms: { joined: joinedCount(), total: config.rooms.length },
        recent: data.recent ?? [],
      },
      language,
    );
  });

  gladys.onWidgetAction(WIDGET_KEY, async (actionKey) => {
    if (actionKey !== TEST_ACTION) {
      throw new Error(`Unknown widget action "${actionKey}"`);
    }
    const report = await testConnection();
    return each(report, (text) => (text.length > 200 ? `${text.slice(0, 199)}…` : text));
  });

  gladys.onConfigUpdated((raw) => applyConfig(raw));

  gladys.on('connected', () => {
    lastStatus = null; // a new connection: publish the status again
    return applyConfig(gladys.config).catch((err) =>
      logger.error('Cannot apply the configuration', err),
    );
  });

  return {
    get config() {
      return config;
    },
    get connection() {
      return connection;
    },
    get data() {
      return data;
    },
    get rooms() {
      return rooms;
    },
    async stop() {
      stopped = true;
      await stopLoop();
      await store.flush();
    },
  };
}
