# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.0] - 2026-10-21

### Added

- Talk to Gladys from any XMPP (Jabber) app: each Gladys user links their XMPP
  address with a code, then writes to the bot in a one-to-one chat; the
  answers of Gladys, the _Send Message_ scene action and the system messages
  arrive there.
- A list of allowed people: the bot ignores everyone else. Empty by default.
- Watched group chats (MUC) and the _XMPP message received_ and _XMPP command
  received_ triggers (`!lights off`: command `lights`, arguments `off`),
  people being recognized by their address, never by their nickname.
- The _Send an XMPP message_ scene action, to an address or a watched room,
  with the outputs sent and error.
- The _XMPP connection lost_ and _XMPP connection restored_ triggers, and the
  connection status of the Configuration screen.
- The _XMPP_ dashboard widget and the _Test the connection_ action.
- STARTTLS or direct TLS, server found by DNS SRV or typed by hand, an option
  for a self-signed certificate; the password is never sent over a clear-text
  connection. Automatic reconnection, a ping every 2 minutes, offline messages
  older than 5 minutes and room history never run.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-xmpp/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-xmpp/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-xmpp/releases/tag/v1.0.0
