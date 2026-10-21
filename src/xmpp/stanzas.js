// -----------------------------------------------------------------------------
// Reading and writing the few stanzas the bot deals with: one-to-one `chat`
// messages, `groupchat` messages and presences of multi-user chat rooms
// (XEP-0045), delayed delivery stamps (XEP-0203). Pure functions over the
// ltx elements of @xmpp/xml, tested against stanzas recorded from Prosody 13
// (test/fixtures/xmpp/). Receipts, chat states and markers carry no body:
// they are ignored like everything else without one.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { jid as parseJid, xml } from '@xmpp/client';

export const NS = {
  MUC: 'http://jabber.org/protocol/muc',
  MUC_USER: 'http://jabber.org/protocol/muc#user',
  DELAY: 'urn:xmpp:delay',
  STANZAS: 'urn:ietf:params:xml:ns:xmpp-stanzas',
};

// MUC status codes (XEP-0045, 15.6.2).
export const MUC_STATUS = {
  SELF: '110',
  CREATED: '201',
  BANNED: '301',
  KICKED: '307',
};

/**
 * A JID split and normalized (lower case: the local part and the domain of
 * the usual accounts are case-insensitive), or null when it is not one.
 * @returns {{ bare: string, local: string, domain: string, resource: string } | null}
 */
export function readJid(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  try {
    const address = parseJid(value.trim());
    if (!address.domain || /\s/.test(address.toString())) {
      return null;
    }
    const local = (address.local ?? '').toLowerCase();
    const domain = address.domain.toLowerCase();
    return {
      bare: local ? `${local}@${domain}` : domain,
      local,
      domain,
      resource: address.resource ?? '',
    };
  } catch {
    return null;
  }
}

/** The time of a delayed delivery stamp (offline message, room history), or null. */
function delayedAt(stanza) {
  const stamp = stanza.getChild('delay', NS.DELAY)?.attrs.stamp;
  const time = stamp ? Date.parse(stamp) : NaN;
  return Number.isNaN(time) ? null : time;
}

/**
 * A message stanza, or null when it is not one.
 * @returns {{ type: string, from: ReturnType<typeof readJid>, body: string, id: string,
 *   delayedAt: number|null, errorCondition: string }|null}
 */
export function readMessage(stanza) {
  if (!stanza?.is?.('message')) {
    return null;
  }
  const from = readJid(stanza.attrs.from);
  if (!from) {
    return null;
  }
  const error = stanza.getChild('error');
  return {
    type: stanza.attrs.type || 'normal',
    from,
    body: stanza.getChildText('body') ?? '',
    id: stanza.attrs.id ?? '',
    delayedAt: delayedAt(stanza),
    errorCondition: error?.getChildElements()[0]?.name ?? '',
  };
}

/**
 * A presence coming from a room (it carries the MUC user payload, or is the
 * error answer to a join), or null.
 * @returns {{ room: string, nick: string, type: string, realJid: string,
 *   statuses: string[], errorCondition: string }|null}
 */
export function readRoomPresence(stanza) {
  if (!stanza?.is?.('presence')) {
    return null;
  }
  const from = readJid(stanza.attrs.from);
  const user = stanza.getChild('x', NS.MUC_USER);
  const type = stanza.attrs.type || 'available';
  if (!from?.local || !from.resource || (!user && type !== 'error')) {
    return null;
  }
  const error = stanza.getChild('error');
  return {
    room: from.bare,
    nick: from.resource,
    type,
    // Only in rooms showing real addresses, or to a moderator.
    realJid: readJid(user?.getChild('item')?.attrs.jid ?? '')?.bare ?? '',
    statuses: (user?.getChildren('status') ?? []).map((status) => status.attrs.code),
    errorCondition: error?.getChildElements()[0]?.name ?? '',
  };
}

const newId = () => randomUUID().slice(0, 13);

export const availablePresence = () => xml('presence');

/** Joins a room without its history: old commands must not run again. */
export const joinPresence = (room, nick) =>
  xml(
    'presence',
    { to: `${room}/${nick}`, id: newId() },
    xml('x', { xmlns: NS.MUC }, xml('history', { maxstanzas: '0' })),
  );

export const leavePresence = (room, nick) =>
  xml('presence', { to: `${room}/${nick}`, type: 'unavailable' });

export const chatMessage = (to, text) =>
  xml('message', { to, type: 'chat', id: newId() }, xml('body', {}, text));

export const groupchatMessage = (room, text) =>
  xml('message', { to: room, type: 'groupchat', id: newId() }, xml('body', {}, text));
