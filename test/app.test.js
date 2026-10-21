// -----------------------------------------------------------------------------
// The integration end to end: the fake Gladys of the SDK on one side, a fake
// XMPP server answering like Prosody 13 on the other.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import {
  ACTION_KEY,
  CREDENTIALS_RETRY_MS,
  JOIN_TIMEOUT_MS,
  LOST_AFTER_MS,
  MAX_MESSAGE_AGE_MS,
  PING_INTERVAL_MS,
  SCENE_ACTION_KEY,
  TRIGGERS,
  parseCommand,
} from '../src/app.js';
import { ERROR_KINDS } from '../src/xmpp/errors.js';
import { WIDGET_KEY } from '../src/widgets.js';
import {
  ALICE,
  BASE_CONFIG,
  BOT,
  MALLORY,
  ROOM,
  START,
  chat,
  createFakeServer,
  createWorld,
  fixture,
  groupchat,
  settle,
} from './helpers/world.js';

async function connected(t, options) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  assert.equal(world.app.connection, 'connected');
  return world;
}

test('not configured: says what is missing, never connects', async (t) => {
  const server = createFakeServer();
  const world = await createWorld({ config: {}, server });
  t.after(() => world.app.stop());
  assert.equal(world.app.connection, 'not_configured');
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /address \(JID\) and the password/);

  await world.fake.configUpdated({ jid: 'gladys' });
  assert.match(world.fake.connectionStatus.message.fr, /adresse du robot incomprise/);
  await world.fake.configUpdated({ jid: BOT, server: 'https://xmpp.test' });
  assert.match(world.fake.connectionStatus.message.de, /Server nicht verstanden/);
  await world.fake.configUpdated({ jid: BOT });
  assert.match(world.fake.connectionStatus.message.es, /contraseña de la cuenta/);
  assert.equal(server.starts, 0);
  const report = await world.fake.action(ACTION_KEY, {});
  assert.match(report.data.message.en, /^Connection failed: enter the password/);
});

test('connects with the configured account, says it is available, joins the watched room', async (t) => {
  const world = await connected(t, {
    config: { ...BASE_CONFIG, jid: ' Gladys@XMPP.test ', server: '192.0.2.10:5223' },
  });
  assert.deepEqual(world.server.session.options, {
    domain: 'xmpp.test',
    username: 'gladys',
    password: BASE_CONFIG.password,
    resource: 'gladys',
    service: 'xmpps://192.0.2.10:5223',
    allowSelfSigned: false,
  });
  const [presence, join] = world.server.sent;
  assert.equal(presence.toString(), '<presence/>');
  assert.equal(join.attrs.to, `${ROOM}/Gladys`);
  assert.equal(
    join.getChild('x', 'http://jabber.org/protocol/muc').getChild('history').attrs.maxstanzas,
    '0',
    'no room history: old commands never run again',
  );
  assert.equal(world.app.rooms.get(ROOM).joined, true);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.equal(JSON.stringify(world.store.data).includes(BASE_CONFIG.password), false);
});

test('room messages of allowed people fire the triggers; others, echoes and history never', async (t) => {
  const world = await connected(t);
  await world.server.deliver(fixture('groupchat-message')); // Alice: "!lumieres off"
  assert.deepEqual(world.fake.sceneEvents, [
    {
      key: TRIGGERS.MESSAGE,
      data: { room: ROOM, sender: ALICE, nickname: 'Alice', text: '!lumieres off' },
    },
    {
      key: TRIGGERS.COMMAND,
      data: {
        room: ROOM,
        sender: ALICE,
        nickname: 'Alice',
        text: '!lumieres off',
        command: 'lumieres',
        arguments: 'off',
      },
    },
  ]);
  assert.deepEqual(world.store.data.recent, [
    { room: ROOM, sender: 'Alice', text: '!lumieres off', at: new Date(START).toISOString() },
  ]);

  await world.server.deliver(groupchat('Mallory', '!garage open'));
  await world.server.deliver(fixture('groupchat-echo')); // the bot itself
  await world.server.deliver(groupchat('Alice', '!garage open', { at: START - 1000 }));
  await world.server.deliver(fixture('groupchat-subject'));
  await world.server.deliver(groupchat('Stranger', 'hello')); // no known occupant
  await world.server.deliver(groupchat('Alice', 'hello', { room: 'other@conference.xmpp.test' }));
  assert.equal(world.fake.sceneEvents.length, 2);
  assert.deepEqual(world.fake.messages, [], 'a room never reaches the brain');
  assert.deepEqual(world.server.messages(), [], 'Gladys never answers in a room');
});

test('an occupant who left is no longer known', async (t) => {
  const world = await connected(t);
  await world.server.deliver(fixture('muc-presence-left')); // Alice leaves
  await world.server.deliver(groupchat('Alice', '!lights off'));
  assert.deepEqual(world.fake.sceneEvents, []);
  // An impostor taking the nickname is checked by address, not by name.
  await world.server.deliver(
    `<presence from="${ROOM}/Alice"><x xmlns="http://jabber.org/protocol/muc#user"><item jid="${MALLORY}/x" role="participant"/></x></presence>`,
  );
  await world.server.deliver(groupchat('Alice', '!lights off'));
  assert.deepEqual(world.fake.sceneEvents, []);
});

test('one-to-one: the link code links the address, then messages go to Gladys', async (t) => {
  const world = await connected(t, {
    linkedUser: { selector: 'alice', first_name: 'Alice', language: 'fr' },
  });
  await world.server.deliver(chat(ALICE, 'abcd2345'));
  assert.equal(world.fake.contacts[0].contact_id, ALICE);
  assert.deepEqual(world.server.messages()[0].to, ALICE);
  assert.match(world.server.messages()[0].body, /^Bonjour Alice/);
  assert.deepEqual(world.fake.sceneEvents, [], 'a conversation fires no trigger');

  await world.server.deliver(fixture('chat-message')); // "Bonjour Gladys", with a receipt request
  await world.server.deliver(fixture('chat-composing'));
  assert.deepEqual(world.fake.messages, [
    { contact_id: ALICE, text: 'Bonjour Gladys', created_at: new Date(START).toISOString() },
  ]);

  // The answer of Gladys goes back as a chat message.
  const ack = await world.fake.sendMessage({ id: ALICE }, { text: 'Il fait 21 °C', file: null });
  assert.equal(ack.success, true);
  assert.deepEqual(world.server.messages().at(-1), {
    to: ALICE,
    type: 'chat',
    body: 'Il fait 21 °C',
  });
});

test('offline messages: a recent one is read with its date, an old one skipped', async (t) => {
  const world = await connected(t);
  await world.server.deliver(chat(ALICE, 'Recent', { at: START - 60_000 }));
  await world.server.deliver(chat(ALICE, '!open garage', { at: START - MAX_MESSAGE_AGE_MS - 1 }));
  assert.deepEqual(world.fake.messages, [
    { contact_id: ALICE, text: 'Recent', created_at: new Date(START - 60_000).toISOString() },
  ]);
});

test('strangers, errors, headlines and the other sessions of the bot are ignored', async (t) => {
  const world = await connected(t);
  await world.server.deliver(chat(MALLORY, 'hello'));
  await world.server.deliver(chat(BOT, 'from another session'));
  await world.server.deliver(chat(ALICE, 'news', { type: 'headline' }));
  await world.server.deliver(fixture('message-error'));
  // A private message through the room: the sender is a nickname, never trusted.
  await world.server.deliver(
    `<message type="chat" from="${ROOM}/Alice" to="${BOT}/gladys"><body>hi</body></message>`,
  );
  assert.deepEqual(world.fake.messages, []);
  assert.deepEqual(world.server.messages(), []);
});

test('an address not linked yet gets the instructions; Gladys down gets an apology', async (t) => {
  const world = await connected(t);
  t.mock.method(world.gladys, 'publishMessage', async () => {
    throw new GladysApiError(404, 'NOT_FOUND', 'CONTACT_NOT_FOUND');
  });
  t.mock.method(world.gladys, 'linkContact', async () => {
    throw new GladysApiError(404, 'NOT_FOUND', 'INVALID_LINK_CODE');
  });
  await world.server.deliver(chat(ALICE, 'Hello'));
  assert.match(world.server.messages()[0].body, /Generate a link code/);
  // A wrong code is a message like any other: the same instructions.
  await world.server.deliver(chat(ALICE, 'ZZZZ9999'));
  assert.match(world.server.messages()[1].body, /Generate a link code/);

  world.gladys.publishMessage.mock.mockImplementation(async () => {
    throw new GladysApiError(500, 'SERVER_ERROR', 'down');
  });
  await world.server.deliver(chat(ALICE, 'Hello'));
  assert.match(world.server.messages()[2].body, /try again later/);
});

test('nothing goes out to a contact who is not, or no longer, an allowed person', async (t) => {
  const world = await connected(t);
  const ack = await world.fake.sendMessage({ id: MALLORY }, { text: 'secret', file: null });
  assert.equal(ack.success, true);
  // An image alone has no text to send.
  await world.fake.sendMessage({ id: ALICE }, { text: '', file: 'image/jpg;base64,/9j/4AAQ' });
  assert.deepEqual(world.server.messages(), []);
});

test('a message of Gladys that cannot be sent is reported as a failure', async (t) => {
  const world = await connected(t);
  world.server.sendFails = true;
  const ack = await world.fake.sendMessage({ id: ALICE }, { text: 'x', file: null });
  assert.equal(ack.success, false);
  assert.match(ack.error, /XMPP: the XMPP server does not answer/);
});

test('scene action: to a person, to a watched room, failures as outputs', async (t) => {
  const world = await connected(t);
  let ack = await world.fake.sceneAction(SCENE_ACTION_KEY, { to: 'Bob@xmpp.test', message: 'Hi' });
  assert.deepEqual(ack.data.outputs, { sent: true, error: '' });
  ack = await world.fake.sceneAction(SCENE_ACTION_KEY, { to: ROOM, message: 'Alarm on' });
  assert.deepEqual(ack.data.outputs, { sent: true, error: '' });
  assert.deepEqual(world.server.messages(), [
    { to: 'bob@xmpp.test', type: 'chat', body: 'Hi' },
    { to: ROOM, type: 'groupchat', body: 'Alarm on' },
  ]);

  ack = await world.fake.sceneAction(SCENE_ACTION_KEY, { to: 'not an address', message: 'x' });
  assert.deepEqual(ack.data.outputs, {
    sent: false,
    error: 'recipient not understood: an address such as alice@example.org',
  });
  world.app.rooms.get(ROOM).joined = false;
  ack = await world.fake.sceneAction(SCENE_ACTION_KEY, { to: ROOM, message: 'x' });
  assert.equal(ack.data.outputs.error, 'the bot is not in this room: add it to the watched rooms');
  ack = await world.fake.sceneAction(SCENE_ACTION_KEY, { to: ALICE, message: ' ' });
  assert.equal(ack.success, false);
});

test('a room that does not exist is left at once, and reported', async (t) => {
  const server = createFakeServer();
  server.rooms.set('locked@conference.xmpp.test', {
    occupants: [],
    refuse: 'registration-required',
  });
  const world = await connected(t, {
    server,
    config: {
      ...BASE_CONFIG,
      rooms: `${ROOM}, typo@conference.xmpp.test, locked@conference.xmpp.test`,
    },
  });
  await settle();
  const leave = server.sent.find((stanza) => stanza.attrs.type === 'unavailable');
  assert.equal(leave.attrs.to, 'typo@conference.xmpp.test/Gladys');
  assert.equal(world.app.rooms.get('typo@conference.xmpp.test').failed, 'item-not-found');
  assert.equal(world.app.rooms.get('locked@conference.xmpp.test').failed, 'registration-required');
  assert.match(
    world.fake.connectionStatus.message.en,
    /could not be joined: typo@conference.xmpp.test, locked@conference.xmpp.test$/,
  );
  const report = await world.fake.action(ACTION_KEY, {});
  assert.match(report.data.message.en, /Watched rooms joined: 1\/3\./);
});

test('a room that never answers does not block the connection', async (t) => {
  const server = createFakeServer();
  server.silentRooms.add(ROOM);
  const world = await createWorld({ server });
  t.after(() => world.app.stop());
  assert.equal(world.app.connection, 'connecting');
  await world.tick(JOIN_TIMEOUT_MS);
  assert.equal(world.app.connection, 'connected');
  assert.equal(world.app.rooms.get(ROOM).failed, 'timeout');
});

test('connection lost after a minute of failures, restored once it answers again', async (t) => {
  const world = await connected(t);
  world.server.down = ERROR_KINDS.UNREACHABLE;
  world.server.session.drop();
  await settle();
  assert.equal(world.app.connection, 'connected', 'one failure is not a loss');
  let waited = 0;
  while (waited < LOST_AFTER_MS) {
    waited += await world.wake();
  }
  assert.equal(world.app.connection, 'disconnected');
  assert.deepEqual(world.fake.sceneEvents, [
    { key: TRIGGERS.LOST, data: { error: 'the XMPP server does not answer' } },
  ]);
  assert.match(world.fake.connectionStatus.message.fr, /serveur XMPP ne répond pas/);

  world.server.down = null;
  await world.wake();
  assert.equal(world.app.connection, 'connected');
  assert.deepEqual(world.fake.sceneEvents.at(-1), {
    key: TRIGGERS.RESTORED,
    data: { user: BOT },
  });
  assert.equal(world.app.rooms.get(ROOM).joined, true, 'the room is joined again');
});

test('a refused password: disconnected at once, retried slowly', async (t) => {
  const world = await createWorld({ config: { ...BASE_CONFIG, password: 'wrong' } });
  t.after(() => world.app.stop());
  assert.equal(world.app.connection, 'disconnected');
  assert.match(world.fake.connectionStatus.message.en, /address or password of the bot refused/);
  assert.deepEqual(world.fake.sceneEvents, [], 'never connected: nothing was lost');
  assert.equal(world.sleeps[0].ms, CREDENTIALS_RETRY_MS);
});

test('a dead connection is noticed by the ping, and a room left is joined again', async (t) => {
  const world = await connected(t);
  await world.tick(PING_INTERVAL_MS);
  assert.equal(world.server.pings, 1);

  // The room service restarted: the bot is out of the room, the next ping rejoins it.
  await world.server.deliver(
    `<presence type="unavailable" from="${ROOM}/Gladys"><x xmlns="http://jabber.org/protocol/muc#user"><item role="none"/><status code="332"/><status code="110"/></x></presence>`,
  );
  assert.equal(world.app.rooms.get(ROOM).joined, false);
  await world.tick(PING_INTERVAL_MS);
  assert.equal(world.app.rooms.get(ROOM).joined, true);

  // Kicked: stays out.
  await world.server.deliver(
    `<presence type="unavailable" from="${ROOM}/Gladys"><x xmlns="http://jabber.org/protocol/muc#user"><item role="none"/><status code="307"/><status code="110"/></x></presence>`,
  );
  await world.tick(PING_INTERVAL_MS);
  assert.equal(world.app.rooms.get(ROOM).joined, false);

  const first = world.server.session;
  world.server.pingFails = true;
  await world.tick(PING_INTERVAL_MS);
  assert.equal(first.closed, true);
  world.server.pingFails = false;
  await world.wake();
  assert.notEqual(world.server.session, first, 'a fresh session');
  assert.equal(world.app.connection, 'connected');
});

test('test action and widget: account, rooms, last messages', async (t) => {
  const world = await connected(t);
  const report = await world.fake.action(ACTION_KEY, {});
  assert.equal(
    report.data.message.en,
    `Connected as ${BOT}. Watched rooms joined: 1/1. Allowed people: 1.`,
  );
  assert.match(report.data.message.fr, /^Connecté en tant que/);

  await world.server.deliver(groupchat('Alice', 'Hello'));
  const widget = await world.fake.widgetGet(WIDGET_KEY, { language: 'fr', settings: {} });
  const [status, list, button] = widget.data.content.components;
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['XMPP', 'Connecté'],
      ['Compte du robot', BOT],
      ['Salons surveillés', 1],
    ],
  );
  assert.equal(list.items[0].title, 'Alice');
  assert.equal(list.items[0].badge.text, 'famille');
  assert.equal(button.action.key, 'test');
  const pressed = await world.fake.widgetAction(
    WIDGET_KEY,
    'test',
    {},
    { settings: {}, values: {} },
  );
  assert.match(pressed.data.message.fr, /^Connecté en tant que/);
});

test('a new configuration replaces the session, never two at once', async (t) => {
  const world = await connected(t);
  const first = world.server.session;
  await Promise.all([
    world.fake.configUpdated({ ...BASE_CONFIG, nickname: 'Maison' }),
    world.fake.configUpdated({ ...BASE_CONFIG, nickname: 'Robot' }),
  ]);
  await settle();
  assert.equal(first.closed, true);
  const open = world.server.sessions.filter((session) => !session.closed);
  assert.equal(open.length, 1);
  assert.equal(world.server.sent.at(-1).attrs.to, `${ROOM}/Robot`);
});

test('parseCommand: prefix, word in lower case, the rest as arguments', () => {
  assert.deepEqual(parseCommand('!Lights off now', '!'), { command: 'lights', args: 'off now' });
  assert.deepEqual(parseCommand('/scene', '/'), { command: 'scene', args: '' });
  assert.equal(parseCommand('lights', '!'), null);
  assert.equal(parseCommand('! lights', '!'), null);
});

test('a session lost while joining the rooms is noticed, not left "connected"', async (t) => {
  const server = createFakeServer();
  server.silentRooms.add(ROOM);
  const world = await createWorld({ server });
  t.after(() => world.app.stop());
  const first = server.session;
  first.drop();
  await world.tick(JOIN_TIMEOUT_MS);
  await world.wake();
  assert.equal(server.starts, 2, 'a new session was started');
  assert.notEqual(server.session, first);
});

test('a room that did not answer is tried again at the next ping', async (t) => {
  const server = createFakeServer();
  server.silentRooms.add(ROOM);
  const world = await createWorld({ server });
  t.after(() => world.app.stop());
  await world.tick(JOIN_TIMEOUT_MS);
  assert.equal(world.app.rooms.get(ROOM).joined, false);
  server.silentRooms.clear();
  await world.tick(PING_INTERVAL_MS);
  assert.equal(world.app.rooms.get(ROOM).joined, true);
});
