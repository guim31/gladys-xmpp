# XMPP

Talk to Gladys from [XMPP](https://xmpp.org) (Jabber), the open and decentralized messaging standard
(Conversations, Monocles, Gajim, Dino, Siskin, Monal, Snikket…), the way the Telegram bot of Gladys works:
ask a question, run a scene, receive the messages of Gladys. The integration also writes to XMPP addresses
and group chats from your scenes, and starts scenes when a message or a command such as `!lights off` is
written in a group chat it watches. It uses a dedicated bot account, on your own server (Prosody, ejabberd,
Snikket, Openfire…) or on a public one.

> **Developed without the hardware: feedback welcome.** The integration was tested against a real Prosody 13
> server, but not inside a real Gladys nor with every XMPP app. Please report what works and what does not
> in the [issues](https://github.com/guim31/gladys-xmpp/issues) or on the
> [Gladys forum](https://community.gladysassistant.com).

## What you need

- Gladys Assistant **5.1.0** or later.
- A **dedicated XMPP account for the bot** (for example `gladys@example.org`), on a server Gladys can reach:
  your own server on the local network, or a public one on the Internet. Do not use your personal account:
  the bot answers in its name.
- A server offering **encryption** (STARTTLS on port 5222, or direct TLS on port 5223): every server does
  by default. The password of the bot is never sent over a clear-text connection.
- The XMPP address of each person allowed to talk to the bot, such as `alice@example.org`.

## Set up

1. Create the bot account (on your server: as you create the other accounts, for example
   `prosodyctl adduser gladys@example.org`; on a public server: an ordinary registration).
2. In Gladys, **Integrations → XMPP → Configuration**:
   - **Bot address (JID)** and **Bot password**: the account of the bot.
   - **Server (optional)**: empty, the server is found from the address (DNS SRV records, as any XMPP
     app does). Otherwise a host name or an IP address, with a port if needed: `192.168.1.20` or
     `xmpp.example.org:5222` (STARTTLS), `192.168.1.20:5223` or `xmpps://xmpp.example.org` (direct TLS).
   - **Accept a self-signed certificate**: only for your own server on the local network, whose
     certificate is not signed by an authority. The connection stays encrypted, but the server is not
     verified. Off by default.
   - **Allowed people**: the XMPP addresses the bot listens to, separated by commas. **Empty, the bot
     answers nobody**: it ignores the messages of everyone who is not in this list.
   - **Watched rooms**: the group chats (MUC) whose messages start scenes, such as
     `home@conference.example.org`, separated by commas. They must already exist: the bot joins them
     (if the room is members-only, make the bot a member first).
   - **Nickname in the rooms**: `Gladys` by default.
   - **Command prefix**: `!` by default.
   - **Language of the bot**: the language of what the bot writes before a person is linked.
3. Click **Test the connection**: the report gives the address of the bot, the watched rooms it joined and
   the number of allowed people. The connection status of the page says it too.

### Link your XMPP address to talk to Gladys

Each Gladys user who wants to talk to Gladys from XMPP does it once:

1. In your XMPP app, add the bot as a contact (its address) if you wish; it is not required.
2. In Gladys, **Integrations → XMPP → Configuration**, block "Link my account": click **Generate a link
   code**.
3. Send the code (8 characters) to the bot in a one-to-one chat. The bot confirms: your XMPP address is
   linked to your Gladys user. You can unlink it from the same block.

## What the bot does

- **In a one-to-one chat**: it passes your messages to Gladys, with the authority of the linked Gladys
  user, exactly like the Telegram bot: "What is the temperature in the living room?", "Turn off the
  lights". The answers of Gladys come back in this chat. The messages Gladys sends to you (the **Send
  Message** scene action, the system messages) arrive there too.
- **In a watched room**: every message of an allowed person starts the **XMPP message received** trigger,
  and a message starting with the prefix also starts **XMPP command received**. The bot never answers
  there by itself, where others can read: what happens is up to your scenes.
- **Who is who in a room**: a person is recognized by their XMPP address, never by their nickname. The
  room must show the real addresses of its members to the bot: a room "non-anonymous" (Prosody, ejabberd:
  the room option that shows the addresses to everyone), or the bot made moderator of the room.
- **What it ignores**: everyone who is not an allowed person, its own messages, the history of the rooms,
  private messages sent through a room, typing notifications and receipts, and the messages older than 5
  minutes when it receives them (kept by the server while Gladys was stopped: a "!open garage" from two
  hours ago does not run now).
- **Connection**: the bot shows itself online, answers the pings of the server and pings it every 2
  minutes. When the connection drops, it reconnects by itself (after 2, 5, 10, 30 then 60 seconds).

## Dashboard

The **XMPP** widget shows whether the bot is connected, its address, the watched rooms it is in, the last 5
messages received in the watched rooms (nickname, text, date) and a **Test the connection** button. The
one-to-one conversations with Gladys are never shown: everyone who sees the dashboard sees the widget.

## Scenes

### Triggers

- **XMPP message received**: an allowed person wrote in a watched room. Filters (empty = any): **Room**
  (`home@conference.example.org`) and **Sender** (the address of the person, `alice@example.org`).
  Variables: Message, Sender, Nickname, Room.
- **XMPP command received**: an allowed person wrote a command in a watched room: the prefix, then a word,
  then optional arguments, for example `!lights off kitchen`. Filter **Command**: the word **without the
  prefix, in lower case** (`lights`); and Room, Sender. Variables: Command (`lights`), Arguments (`off
kitchen`), Message, Sender, Nickname, Room. The same message also starts **XMPP message received**.
- **XMPP connection lost**: the bot cannot reach the server any more, for a minute, or its password or the
  certificate of the server are refused. Variable: Error. Started once, until the connection comes back.
- **XMPP connection restored**: the bot reaches the server again after a lost connection. Variable: Bot
  account.

### Actions

- **Send an XMPP message**: writes a message to an XMPP address (`alice@example.org`, even a person who is
  not allowed: the bot only writes to them) or in a watched room (`home@conference.example.org`). The
  message accepts the scene variables. Results: Sent (yes/no), Error. A failed message does not stop the
  scene: test **Sent** with a condition if needed. The echo of the message in the room never starts the
  triggers.

To write to one Gladys user rather than to an address, use the **Send Message** action of Gladys: it
reaches their linked XMPP address.

### Scene ideas

- **Garage by command**: trigger **XMPP command received**, command `garage`, room
  `home@conference.example.org`; then a condition on the variable Arguments equal to `close`, and the action
  that closes the garage.
- **Washing machine done**: trigger on the power of the plug, then **Send an XMPP message** to
  `home@conference.example.org`: "The washing machine is done".
- **Alert when the bot is cut off**: trigger **XMPP connection lost**, then a notification through another
  channel (Gotify, ntfy, SMS) with the Error variable.

## Troubleshooting

- **"the XMPP server does not answer"**: check **Server (optional)**. Empty, the domain of the address must
  have DNS SRV records (`_xmpp-client._tcp`) or point to the server itself; on a local network, enter the IP
  address of the server.
- **"certificate of the server refused"**: the certificate is self-signed, expired, or does not name the
  domain of the address. For your own server on the local network, tick **Accept a self-signed
  certificate**.
- **"address or password of the bot refused"**: check them by logging in with the bot account in an XMPP
  app.
- **"the server offers no encryption"**: enable TLS on the server (it is the default of Prosody and
  ejabberd).
- **A watched room is not joined**: the status of the page and the test name it. The room must exist (the
  bot does not create rooms: a mistyped address is reported), and the bot must be allowed in: a member of a
  members-only room, not banned. Password-protected rooms are not supported.
- **The bot does not answer me**: is your address in **Allowed people**, written exactly? Is your address
  linked (the bot then gives you the instructions)? Does your app send the message as a one-to-one chat
  (not through a room)?
- **A room message does not start the scene**: does the room show the real addresses to the bot (see
  "Who is who in a room")? The Command filter is the word without the prefix, in lower case: `lights`, not
  `!Lights`.
- More details in the logs of the integration with `LOG_LEVEL=debug`.

## Limits

- **No end-to-end encryption** (no OMEMO, no OpenPGP): the bot reads and writes clear messages only. They
  travel encrypted between your app, the server and Gladys (TLS), but the server can read them. If your app
  encrypts by default (Conversations, Monocles, Dino), turn OMEMO off in the chat with the bot.
- A person linked to Gladys can do from XMPP everything their Gladys user can do: keep the list of allowed
  people short, and protect the bot account (a strong password, no reuse).
- Images sent by Gladys (camera snapshots) are not forwarded: only the text is sent. Images, files and
  voice messages sent to the bot are ignored.
- One bot account per Gladys, with the resource `gladys`: logging in elsewhere with the same resource
  disconnects the bot for a minute.
- Password-protected rooms, and rooms where the bot does not see the real addresses, are not supported for
  the triggers.
- Not affiliated with the XMPP Standards Foundation.
