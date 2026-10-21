# XMPP for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that connects a bot account of [XMPP](https://xmpp.org) (Jabber), the open
and decentralized messaging standard, to Gladys: talk to Gladys from
Conversations, Gajim, Dino, Monal or any XMPP app, receive the messages of
Gladys there, write to XMPP addresses and group chats from your scenes, and
start scenes on a message or a command such as `!lights off` in a group chat.
Works with your own server on the local network (Prosody, ejabberd, Snikket,
Openfire…) or a public one.

> **Developed without the hardware: feedback welcome.** The integration was
> tested against a real Prosody 13 server (the `prosodyim/prosody` Docker
> image), in both directions, but not inside a real Gladys nor with every XMPP
> app. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-xmpp/issues) or on the
> [Gladys forum](https://community.gladysassistant.com).

## Features

- **A two-way chat channel**, like the Telegram bot of Gladys (manifest
  `type: "communication"`, `messaging.receive: true`): each Gladys user links
  their XMPP address with a code from the Configuration screen, then talks to
  Gladys in a one-to-one chat with the bot. The answers of Gladys, the
  _Send Message_ scene action and the system messages arrive there.
- **Allowed people only**: the bot ignores the messages of everyone who is not
  in the list, which is empty by default. In a group chat, a person is
  recognized by the real address the room shows, never by a nickname.
- **Scene triggers**: _XMPP message received_ (in a watched group chat,
  filtered by room and sender), _XMPP command received_ (prefix + word, e.g.
  `!garage close`, with the arguments as a variable), _XMPP connection lost_,
  _XMPP connection restored_.
- **Scene action** _Send an XMPP message_: to an address or a watched group
  chat, with scene variables. Outputs: sent, error.
- **Dashboard widget** _XMPP_: connection, bot address, watched rooms, the
  last messages of the watched rooms, a _Test the connection_ button.
- STARTTLS (5222) or direct TLS (5223), the server found by DNS SRV or typed
  by hand, an option for a self-signed certificate. The password is never
  sent over a clear-text stream. Automatic reconnection and a ping every 2
  minutes; room history and offline messages older than 5 minutes never run.
- Four languages (English, French, German, Spanish).

Compared with [Apprise for Gladys](https://github.com/guim31/gladys-apprise),
which sends notifications to XMPP among 100 other services, this integration
also receives: conversations with Gladys, commands and triggers. It follows
the design of [Matrix for Gladys](https://github.com/guim31/gladys-matrix)
(same trigger and action keys).

## Requirements

- Gladys Assistant **5.1.0** or later.
- A dedicated XMPP account for the bot, on a server Gladys can reach, offering
  TLS.
- **No end-to-end encryption** in the chats with the bot (OMEMO off).

## Installation

In Gladys: **Integrations → Install from GitHub**, then enter
`https://github.com/guim31/gladys-xmpp`. Fill in the bot address and password
and the allowed people (and the server and watched rooms if needed), click
**Test the connection**, then each user links their address. The full
documentation is in [docs/en.md](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

- [`@xmpp/client`](https://github.com/xmppjs/xmpp.js) over TCP: SASL (SCRAM or
  PLAIN, only once the stream is encrypted), resource binding (`gladys`),
  stream management, XEP-0199 pings. Its own reconnection (every second, even
  with a wrong password) is replaced by a backoff in the integration.
- One-to-one `chat` messages of an allowed address are a conversation with
  Gladys (`linkContact`, `publishMessage`, `onSendMessage`). Group chats
  (XEP-0045) listed in the configuration are joined without history and only
  fire triggers; the occupants' real addresses come from their presences.
  Everything else is ignored, so Gladys never answers where others can read.
- Chat states, receipts, room subjects, `headline` and `error` messages, the
  bot's own room echoes and private messages through a room are ignored, so a
  scene answering a message cannot loop.

## Limits

- No end-to-end encryption (OMEMO would need libsignal and a key store: too
  heavy for the sandbox and its 256 MB).
- Text only: images sent by Gladys (camera snapshots) are not forwarded, and
  images, files and voice messages sent to the bot are ignored.
- Password-protected rooms are not supported; rooms that hide the real
  addresses from the bot cannot fire the triggers.
- One bot account per Gladys.

## Development

```bash
npm install
npm test            # node --test, against the fake Gladys of the SDK and a fake XMPP server
npm run lint
npm run format:check
npx -y github:GladysAssistant/integration-store --skip-image-check .

# Against a real Prosody (domain xmpp.test, MUC conference.xmpp.test, see CLAUDE.md):
XMPP_LIVE_HOST=192.0.2.10 node --test test/live.test.js
```

## Credits

- [xmpp.js](https://github.com/xmppjs/xmpp.js) (`@xmpp/client`, ISC), the XMPP
  client library. The test fixtures are stanzas recorded from a
  [Prosody](https://prosody.im) 13 server (MIT) running in Docker.
- The [Home Assistant `xmpp` integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/xmpp)
  (Apache-2.0), built on [slixmpp](https://codeberg.org/poezio/slixmpp)
  (MIT): the shape of the configuration (sender, password, TLS, certificate
  verification, rooms). No code was copied.
- [Rafi594/gladys-xmpp](https://github.com/Rafi594/gladys-xmpp), an XMPP module
  for Gladys 3 (2017), unmaintained: the idea, for a Gladys of another era.
- The logo on the cover is the XMPP logo from
  [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:XMPP_logo.svg)
  (MIT, by Raja Sandhu for the XMPP Standards Foundation).
- The architecture, the `/data` store and the quiet logs come from
  [gladys-matrix](https://github.com/guim31/gladys-matrix); the tests follow
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by the XMPP
Standards Foundation.

## License

Apache-2.0
