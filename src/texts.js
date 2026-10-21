// -----------------------------------------------------------------------------
// Texts the integration writes outside the widget (src/widgets.js): the
// connection status, the "Test the connection" report, the errors, and what
// the bot answers in XMPP. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './xmpp/errors.js';

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** Applies `render` to each language of a table of functions. */
export const each = (table, render) =>
  Object.fromEntries(Object.entries(table).map(([lang, value]) => [lang, render(value, lang)]));

// One short explanation per error kind (src/xmpp/errors.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.NOT_CONFIGURED]: {
    en: 'enter the address (JID) and the password of the bot in the configuration',
    fr: "saisissez l'adresse (JID) et le mot de passe du robot dans la configuration",
    de: 'gib die Adresse (JID) und das Passwort des Bots in der Konfiguration ein',
    es: 'introduzca la dirección (JID) y la contraseña del bot en la configuración',
  },
  [ERROR_KINDS.INVALID_JID]: {
    en: 'bot address not understood, e.g. gladys@example.org',
    fr: 'adresse du robot incomprise, ex. gladys@example.org',
    de: 'Adresse des Bots nicht verstanden, z. B. gladys@example.org',
    es: 'dirección del bot no válida, p. ej. gladys@example.org',
  },
  [ERROR_KINDS.INVALID_SERVER]: {
    en: 'server not understood, e.g. xmpp.example.org or xmpp.example.org:5223',
    fr: 'serveur incompris, ex. xmpp.example.org ou xmpp.example.org:5223',
    de: 'Server nicht verstanden, z. B. xmpp.example.org oder xmpp.example.org:5223',
    es: 'servidor no válido, p. ej. xmpp.example.org o xmpp.example.org:5223',
  },
  [ERROR_KINDS.NO_PASSWORD]: {
    en: 'enter the password of the bot account',
    fr: 'saisissez le mot de passe du compte du robot',
    de: 'gib das Passwort des Bot-Kontos ein',
    es: 'introduzca la contraseña de la cuenta del bot',
  },
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the XMPP server does not answer',
    fr: 'le serveur XMPP ne répond pas',
    de: 'der XMPP-Server antwortet nicht',
    es: 'el servidor XMPP no responde',
  },
  [ERROR_KINDS.TIMEOUT]: {
    en: 'the XMPP server answers too slowly',
    fr: 'le serveur XMPP répond trop lentement',
    de: 'der XMPP-Server antwortet zu langsam',
    es: 'el servidor XMPP responde demasiado lento',
  },
  [ERROR_KINDS.BAD_LOGIN]: {
    en: 'address or password of the bot refused',
    fr: 'adresse ou mot de passe du robot refusé',
    de: 'Adresse oder Passwort des Bots abgelehnt',
    es: 'dirección o contraseña del bot rechazadas',
  },
  [ERROR_KINDS.INSECURE]: {
    en: 'the server offers no encryption (STARTTLS): the password is not sent in clear text',
    fr: "le serveur ne propose pas de chiffrement (STARTTLS) : le mot de passe n'est pas envoyé en clair",
    de: 'der Server bietet keine Verschlüsselung (STARTTLS) an: Das Passwort wird nicht im Klartext gesendet',
    es: 'el servidor no ofrece cifrado (STARTTLS): la contraseña no se envía en claro',
  },
  [ERROR_KINDS.CERTIFICATE]: {
    en: 'certificate of the server refused (self-signed? see the option)',
    fr: 'certificat du serveur refusé (auto-signé ? voir l’option)',
    de: 'Zertifikat des Servers abgelehnt (selbstsigniert? siehe die Option)',
    es: 'certificado del servidor rechazado (¿autofirmado? vea la opción)',
  },
  [ERROR_KINDS.HOST_UNKNOWN]: {
    en: 'this server does not serve the domain of the bot address',
    fr: "ce serveur ne gère pas le domaine de l'adresse du robot",
    de: 'dieser Server bedient die Domain der Bot-Adresse nicht',
    es: 'este servidor no gestiona el dominio de la dirección del bot',
  },
  [ERROR_KINDS.REPLACED]: {
    en: 'another connection of the bot account took over (same resource)',
    fr: 'une autre connexion du compte du robot a pris la main (même ressource)',
    de: 'eine andere Verbindung des Bot-Kontos hat übernommen (gleiche Ressource)',
    es: 'otra conexión de la cuenta del bot ha tomado el control (mismo recurso)',
  },
  [ERROR_KINDS.REJECTED]: {
    en: 'refused by the server (message too long, or too many messages?)',
    fr: 'refusé par le serveur (message trop long, ou trop de messages ?)',
    de: 'vom Server abgelehnt (Nachricht zu lang oder zu viele Nachrichten?)',
    es: 'rechazado por el servidor (¿mensaje demasiado largo o demasiados mensajes?)',
  },
  [ERROR_KINDS.INVALID_TARGET]: {
    en: 'recipient not understood: an address such as alice@example.org',
    fr: 'destinataire incompris : une adresse comme alice@example.org',
    de: 'Empfänger nicht verstanden: eine Adresse wie alice@example.org',
    es: 'destinatario no válido: una dirección como alice@example.org',
  },
  [ERROR_KINDS.NOT_IN_ROOM]: {
    en: 'the bot is not in this room: add it to the watched rooms',
    fr: "le robot n'est pas dans ce salon : ajoutez-le aux salons surveillés",
    de: 'der Bot ist nicht in diesem Raum: Füg ihn zu den beobachteten Räumen hinzu',
    es: 'el bot no está en esta sala: añádala a las salas vigiladas',
  },
  [ERROR_KINDS.SERVER]: {
    en: 'the XMPP server answered with an error',
    fr: 'le serveur XMPP a répondu par une erreur',
    de: 'der XMPP-Server hat mit einem Fehler geantwortet',
    es: 'el servidor XMPP ha respondido con un error',
  },
};

/** The explanation of an error, in one language. */
export function errorText(err, language) {
  const text = ERROR_TEXT[err?.kind] ?? ERROR_TEXT[ERROR_KINDS.SERVER];
  return pick(text, language);
}

/** The explanation of an error, in the four languages. */
export const errorTexts = (err) =>
  each(ERROR_TEXT[err?.kind] ?? ERROR_TEXT[ERROR_KINDS.SERVER], (text) => text);

// The connection status of the Configuration screen when some watched rooms
// could not be joined (the bot works in the others).
export const ROOMS_STATUS = {
  en: (failed) => `Connected, but these rooms could not be joined: ${failed}`,
  fr: (failed) => `Connecté, mais ces salons n'ont pas pu être rejoints : ${failed}`,
  de: (failed) => `Verbunden, aber diese Räume konnten nicht betreten werden: ${failed}`,
  es: (failed) => `Conectado, pero no se ha podido entrar en estas salas: ${failed}`,
};

// The report of the "Test the connection" action (and of the widget button).
export const REPORT_TEXT = {
  en: {
    connected: (user) => `Connected as ${user}.`,
    rooms: (joined, total) => `Watched rooms joined: ${joined}/${total}.`,
    noRooms: 'No watched room.',
    users: (count) => `Allowed people: ${count}.`,
    noUsers: 'No allowed person: the bot answers nobody.',
    failed: (error) => `Connection failed: ${error}.`,
  },
  fr: {
    connected: (user) => `Connecté en tant que ${user}.`,
    rooms: (joined, total) => `Salons surveillés rejoints : ${joined}/${total}.`,
    noRooms: 'Aucun salon surveillé.',
    users: (count) => `Personnes autorisées : ${count}.`,
    noUsers: 'Aucune personne autorisée : le robot ne répond à personne.',
    failed: (error) => `Échec de la connexion : ${error}.`,
  },
  de: {
    connected: (user) => `Verbunden als ${user}.`,
    rooms: (joined, total) => `Beobachtete Räume betreten: ${joined}/${total}.`,
    noRooms: 'Kein beobachteter Raum.',
    users: (count) => `Erlaubte Personen: ${count}.`,
    noUsers: 'Keine erlaubte Person: Der Bot antwortet niemandem.',
    failed: (error) => `Verbindung fehlgeschlagen: ${error}.`,
  },
  es: {
    connected: (user) => `Conectado como ${user}.`,
    rooms: (joined, total) => `Salas vigiladas en las que ha entrado: ${joined}/${total}.`,
    noRooms: 'Ninguna sala vigilada.',
    users: (count) => `Personas autorizadas: ${count}.`,
    noUsers: 'Ninguna persona autorizada: el bot no responde a nadie.',
    failed: (error) => `Fallo de conexión: ${error}.`,
  },
};

// What the bot writes in XMPP, in a one-to-one conversation.
export const BOT_TEXT = {
  en: {
    linked: (name) => `Hello ${name}! Your XMPP address is now linked to Gladys: write to me here.`,
    notLinked:
      'Your XMPP address is not linked to Gladys yet. In Gladys, open Integrations → XMPP → Configuration, click "Generate a link code", then send me the code here.',
    unavailable: 'Gladys cannot read your message right now, please try again later.',
  },
  fr: {
    linked: (name) => `Bonjour ${name} ! Votre adresse XMPP est liée à Gladys : écrivez-moi ici.`,
    notLinked:
      'Votre adresse XMPP n’est pas encore liée à Gladys. Dans Gladys, ouvrez Intégrations → XMPP → Configuration, cliquez sur « Générer un code de liaison », puis envoyez-moi le code ici.',
    unavailable: 'Gladys ne peut pas lire votre message pour l’instant, réessayez plus tard.',
  },
  de: {
    linked: (name) =>
      `Hallo ${name}! Deine XMPP-Adresse ist jetzt mit Gladys verknüpft: Schreib mir hier.`,
    notLinked:
      'Deine XMPP-Adresse ist noch nicht mit Gladys verknüpft. Öffne in Gladys Integrationen → XMPP → Konfiguration, klicke auf „Verknüpfungscode generieren“ und schick mir dann den Code hier.',
    unavailable: 'Gladys kann deine Nachricht gerade nicht lesen, versuch es später noch einmal.',
  },
  es: {
    linked: (name) => `¡Hola ${name}! Su dirección XMPP está vinculada a Gladys: escríbame aquí.`,
    notLinked:
      'Su dirección XMPP aún no está vinculada a Gladys. En Gladys, abra Integraciones → XMPP → Configuración, pulse «Generar un código de vinculación» y envíeme el código aquí.',
    unavailable: 'Gladys no puede leer su mensaje en este momento, inténtelo más tarde.',
  },
};
