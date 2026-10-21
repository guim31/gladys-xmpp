// -----------------------------------------------------------------------------
// The XMPP side without a server: stanzas recorded from Prosody 13, the
// configuration (addresses, server), and the sorting of errors.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import parse from '@xmpp/xml/lib/parse.js';
import { normalizeConfig, parseBareJid, parseServer } from '../src/config.js';
import { ERROR_KINDS, TRANSIENT_KINDS, XmppError, classifyError } from '../src/xmpp/errors.js';
import {
  chatMessage,
  groupchatMessage,
  joinPresence,
  readJid,
  readMessage,
  readRoomPresence,
} from '../src/xmpp/stanzas.js';
import { fixture } from './helpers/world.js';

const stanza = (name) => parse(fixture(name));

test('a chat message: sender, body; receipt requests and chat states carry no text', () => {
  const message = readMessage(stanza('chat-message'));
  assert.equal(message.type, 'chat');
  assert.equal(message.from.bare, 'alice@xmpp.test');
  assert.equal(message.from.resource, 'phone');
  assert.equal(message.body, 'Bonjour Gladys');
  assert.equal(message.delayedAt, null);
  assert.equal(readMessage(stanza('chat-composing')).body, '');
});

test('an offline message carries the time it was sent', () => {
  const message = readMessage(stanza('chat-delayed'));
  assert.equal(message.delayedAt, Date.parse('2026-10-21T07:52:20Z'));
});

test('room messages: nickname as resource, subject without body, bounced messages', () => {
  const message = readMessage(stanza('groupchat-message'));
  assert.equal(message.type, 'groupchat');
  assert.equal(message.from.bare, 'famille@conference.xmpp.test');
  assert.equal(message.from.resource, 'Alice');
  assert.equal(message.body, '!lumieres off');
  assert.equal(readMessage(stanza('groupchat-subject')).body, '');
  const bounced = readMessage(stanza('message-error'));
  assert.equal(bounced.type, 'error');
  assert.equal(bounced.errorCondition, 'service-unavailable');
});

test('room presences: occupant with its real address, self, created room, error', () => {
  assert.deepEqual(readRoomPresence(stanza('muc-presence-occupant')), {
    room: 'famille@conference.xmpp.test',
    nick: 'Alice',
    type: 'available',
    realJid: 'alice@xmpp.test',
    statuses: [],
    errorCondition: '',
  });
  assert.deepEqual(readRoomPresence(stanza('muc-presence-self')).statuses, ['100', '110']);
  assert.deepEqual(readRoomPresence(stanza('muc-presence-created')).statuses, [
    '201',
    '100',
    '110',
  ]);
  assert.equal(readRoomPresence(stanza('muc-presence-left')).type, 'unavailable');
  const error = readRoomPresence(stanza('muc-presence-error'));
  assert.equal(error.type, 'error');
  assert.equal(error.errorCondition, 'item-not-found');
  // A presence of a person (not of a room) is not a room presence.
  assert.equal(readRoomPresence(parse('<presence from="alice@xmpp.test/phone"/>')), null);
  assert.equal(readMessage(parse('<presence/>')), null);
});

test('outgoing stanzas: chat, groupchat, join without history', () => {
  const chat = chatMessage('alice@xmpp.test', 'Hi <&>');
  assert.equal(chat.attrs.type, 'chat');
  assert.equal(chat.getChildText('body'), 'Hi <&>');
  assert.match(chat.toString(), /<body>Hi &lt;&amp;&gt;<\/body>/);
  assert.equal(groupchatMessage('r@c.test', 'x').attrs.type, 'groupchat');
  const join = joinPresence('r@c.test', 'Gladys');
  assert.equal(join.attrs.to, 'r@c.test/Gladys');
  assert.equal(
    join.toString().includes('<history maxstanzas="0"/>'),
    true,
    'no history: old commands never run again',
  );
});

test('JIDs: lower case bare address, resource kept', () => {
  assert.deepEqual(readJid('Alice@XMPP.test/Phone'), {
    bare: 'alice@xmpp.test',
    local: 'alice',
    domain: 'xmpp.test',
    resource: 'Phone',
  });
  assert.equal(readJid(''), null);
  assert.equal(parseBareJid(' Alice@Example.org '), 'alice@example.org');
  for (const wrong of ['alice', '@example.org', 'alice@', 'a@b/c', 'a b@c.org', '#room:server']) {
    assert.equal(parseBareJid(wrong), null, wrong);
  }
});

test('server: empty for DNS, STARTTLS by default, direct TLS on 5223 or xmpps://', () => {
  assert.equal(parseServer(''), null);
  assert.equal(parseServer('xmpp.example.org'), 'xmpp://xmpp.example.org:5222');
  assert.equal(parseServer('192.0.2.10:5222'), 'xmpp://192.0.2.10:5222');
  assert.equal(parseServer('192.0.2.10:5223'), 'xmpps://192.0.2.10:5223');
  assert.equal(parseServer('xmpps://xmpp.example.org'), 'xmpps://xmpp.example.org:5223');
  assert.equal(parseServer('XMPP://xmpp.example.org:15222/'), 'xmpp://xmpp.example.org:15222');
  assert.equal(parseServer('[2001:db8::1]:5222'), 'xmpp://[2001:db8::1]:5222');
  for (const wrong of ['https://xmpp.example.org', 'user:pw@host', 'host/path', 'host:99999']) {
    assert.equal(parseServer(wrong), undefined, wrong);
  }
});

test('configuration: lists of addresses, nickname and prefix kept sane', () => {
  const config = normalizeConfig({
    allowed_users: 'Alice@example.org; bob@example.org\nnot-an-address, alice@example.org',
    rooms: 'home@conference.example.org',
    nickname: ' My/Bot ',
    command_prefix: 'toolong',
    allow_self_signed: true,
    language: 'it',
  });
  assert.deepEqual(config.allowed_users, ['alice@example.org', 'bob@example.org']);
  assert.deepEqual(config.rooms, ['home@conference.example.org']);
  assert.equal(config.nickname, 'My Bot');
  assert.equal(config.command_prefix, '!');
  assert.equal(config.allow_self_signed, true);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig(null).nickname, 'Gladys');
});

test('errors: sorted into kinds the user can act on', () => {
  const kind = (err) => classifyError(err).kind;
  const sasl = Object.assign(new Error('not-authorized'), { name: 'SASLError' });
  assert.equal(kind(sasl), ERROR_KINDS.BAD_LOGIN);
  assert.equal(
    kind(Object.assign(new Error('self-signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })),
    ERROR_KINDS.CERTIFICATE,
  );
  assert.equal(
    kind(Object.assign(new Error('x'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })),
    ERROR_KINDS.CERTIFICATE,
  );
  assert.equal(
    kind(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })),
    ERROR_KINDS.UNREACHABLE,
  );
  assert.equal(kind(new Error("Couldn't connect")), ERROR_KINDS.UNREACHABLE);
  assert.equal(kind(Object.assign(new Error('t'), { name: 'TimeoutError' })), ERROR_KINDS.TIMEOUT);
  const stream = (condition) =>
    Object.assign(new Error(condition), { name: 'StreamError', condition });
  assert.equal(kind(stream('conflict')), ERROR_KINDS.REPLACED);
  assert.equal(kind(stream('host-unknown')), ERROR_KINDS.HOST_UNKNOWN);
  assert.equal(kind(stream('system-shutdown')), ERROR_KINDS.SERVER);
  assert.equal(kind(new Error('STARTTLS_FAILURE')), ERROR_KINDS.INSECURE);
  const own = new XmppError(ERROR_KINDS.INSECURE, 'x');
  assert.equal(classifyError(own), own);
  // Wrong credentials, certificate or domain: no fast retry.
  for (const permanent of ['bad_login', 'certificate', 'insecure', 'host_unknown']) {
    assert.equal(TRANSIENT_KINDS.has(permanent), false, permanent);
  }
});
