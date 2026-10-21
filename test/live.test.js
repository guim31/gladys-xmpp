// -----------------------------------------------------------------------------
// End to end against a real XMPP server (Prosody), skipped unless
// XMPP_LIVE_HOST is set: the CI and `npm test` never touch the network.
//
// The server needs the domain xmpp.test (a self-signed certificate is fine),
// a MUC component conference.xmpp.test showing real addresses, and three
// accounts: gladys / robot-pass-123, alice / alice-pass-123,
// mallory / mallory-pass-123. See CLAUDE.md, "XMPP (cette intégration)".
//
//   XMPP_LIVE_HOST=192.0.2.10 node --test test/live.test.js
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { xml } from '@xmpp/client';
import { registerHandlers, SCENE_ACTION_KEY, TRIGGERS } from '../src/app.js';
import { XmppSession } from '../src/xmpp/connection.js';
import { ERROR_KINDS } from '../src/xmpp/errors.js';
import { readMessage } from '../src/xmpp/stanzas.js';
import { createMemoryStore } from './helpers/world.js';

const HOST = process.env.XMPP_LIVE_HOST;
const DOMAIN = 'xmpp.test';
const ROOM = `live${Date.now()}@conference.${DOMAIN}`;
const MUC = 'http://jabber.org/protocol/muc';

const until = async (check, what, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
};

/** A person with an XMPP app: a second, independent client. */
async function person(username) {
  const session = new XmppSession({
    domain: DOMAIN,
    username,
    password: `${username}-pass-123`,
    resource: 'phone',
    service: `xmpp://${HOST}:5222`,
    allowSelfSigned: true,
  });
  const received = [];
  session.on('stanza', (stanza) => {
    const message = readMessage(stanza);
    if (message?.body) {
      received.push(message);
    }
  });
  await session.start();
  await session.send(xml('presence'));
  return { session, received };
}

const config = {
  jid: `gladys@${DOMAIN}`,
  password: 'robot-pass-123',
  server: `${HOST}:5222`,
  allow_self_signed: true,
  allowed_users: `alice@${DOMAIN}`,
  rooms: ROOM,
  language: 'en',
};

test('live: Prosody, both ways, rooms and errors', { skip: !HOST }, async (t) => {
  const alice = await person('alice');
  const mallory = await person('mallory');
  t.after(() => Promise.all([alice.session.stop(), mallory.session.stop()]));

  // Alice owns the room (created and unlocked as an instant room), Mallory is in it.
  await alice.session.send(xml('presence', { to: `${ROOM}/Alice` }, xml('x', { xmlns: MUC })));
  await new Promise((resolve) => setTimeout(resolve, 300));
  await alice.session.send(
    xml(
      'iq',
      { type: 'set', to: ROOM, id: 'instant' },
      xml('query', { xmlns: `${MUC}#owner` }, xml('x', { xmlns: 'jabber:x:data', type: 'submit' })),
    ),
  );
  await mallory.session.send(xml('presence', { to: `${ROOM}/Mallory` }, xml('x', { xmlns: MUC })));
  await new Promise((resolve) => setTimeout(resolve, 300));

  const gladys = createFakeGladys({
    config: { ...config, rooms: `${ROOM}, missing${Date.now()}@conference.${DOMAIN}` },
    linkedUser: { selector: 'alice', first_name: 'Alice', language: 'en' },
  });
  const app = registerHandlers(gladys, { store: createMemoryStore() });
  t.after(() => app.stop());
  await gladys.connect();
  await until(() => app.connection === 'connected', 'the bot to connect', 15_000);
  assert.equal(app.rooms.get(ROOM).joined, true);
  assert.match(gladys.fake.connectionStatus.message.en, /could not be joined: missing/);

  // One to one: link code, then the brain, then the answer of Gladys.
  await alice.session.send(
    xml('message', { to: `gladys@${DOMAIN}`, type: 'chat' }, xml('body', {}, 'ABCD2345')),
  );
  await until(() => alice.received.some((m) => /linked to Gladys/.test(m.body)), 'the link');
  await alice.session.send(
    xml('message', { to: `gladys@${DOMAIN}`, type: 'chat' }, xml('body', {}, 'Temperature?')),
  );
  await until(() => gladys.fake.messages.length === 1, 'the message to reach Gladys');
  assert.equal(gladys.fake.messages[0].contact_id, `alice@${DOMAIN}`);
  const ack = await gladys.fake.sendMessage({ id: `alice@${DOMAIN}` }, { text: '21 °C' });
  assert.equal(ack.success, true);
  await until(() => alice.received.some((m) => m.body === '21 °C'), 'the answer');

  // Mallory is not allowed: no answer, nothing for Gladys.
  await mallory.session.send(
    xml('message', { to: `gladys@${DOMAIN}`, type: 'chat' }, xml('body', {}, 'Open the door')),
  );
  // Room: Alice fires the triggers, Mallory does not.
  await mallory.session.send(
    xml('message', { to: ROOM, type: 'groupchat' }, xml('body', {}, '!garage open')),
  );
  await alice.session.send(
    xml('message', { to: ROOM, type: 'groupchat' }, xml('body', {}, '!lights off')),
  );
  await until(() => gladys.fake.sceneEvents.length === 2, 'the triggers');
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => [event.key, event.data.sender, event.data.text]),
    [
      [TRIGGERS.MESSAGE, `alice@${DOMAIN}`, '!lights off'],
      [TRIGGERS.COMMAND, `alice@${DOMAIN}`, '!lights off'],
    ],
  );
  assert.equal(gladys.fake.messages.length, 1);

  // Scene action, to the room then to a person: the echo of the room fires nothing.
  let action = await gladys.fake.sceneAction(SCENE_ACTION_KEY, { to: ROOM, message: 'Alarm on' });
  assert.deepEqual(action.data.outputs, { sent: true, error: '' });
  await until(() => alice.received.some((m) => m.body === 'Alarm on'), 'the room message');
  action = await gladys.fake.sceneAction(SCENE_ACTION_KEY, {
    to: `mallory@${DOMAIN}`,
    message: 'Parcel delivered',
  });
  assert.equal(action.data.outputs.sent, true);
  await until(() => mallory.received.some((m) => m.body === 'Parcel delivered'), 'the chat');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(gladys.fake.sceneEvents.length, 2, 'no loop between a scene and its triggers');
  assert.equal(alice.received.filter((m) => m.type === 'chat').length, 2, 'link + answer only');
});

test('live: wrong password, strict certificate, nothing listening', { skip: !HOST }, async () => {
  const attempt = async (overrides) => {
    const session = new XmppSession({
      domain: DOMAIN,
      username: 'gladys',
      password: 'robot-pass-123',
      resource: 'check',
      service: `xmpp://${HOST}:5222`,
      allowSelfSigned: true,
      ...overrides,
    });
    try {
      await session.start();
      await session.stop();
      return 'connected';
    } catch (err) {
      return err.kind;
    }
  };
  assert.equal(await attempt({ password: 'wrong' }), ERROR_KINDS.BAD_LOGIN);
  assert.equal(await attempt({ allowSelfSigned: false }), ERROR_KINDS.CERTIFICATE);
  assert.equal(await attempt({ service: `xmpp://${HOST}:5299` }), ERROR_KINDS.UNREACHABLE);
  assert.equal(await attempt({ service: `xmpps://${HOST}:5223` }), 'connected');
});
