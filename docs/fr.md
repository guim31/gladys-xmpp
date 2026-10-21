# XMPP

Parlez à Gladys depuis [XMPP](https://xmpp.org) (Jabber), le standard de messagerie ouvert et décentralisé
(Conversations, Monocles, Gajim, Dino, Siskin, Monal, Snikket…), comme avec le bot Telegram de Gladys :
posez une question, lancez une scène, recevez les messages de Gladys. L'intégration écrit aussi à des
adresses XMPP et dans des salons depuis vos scènes, et lance des scènes quand un message ou une commande
comme `!lumieres off` est écrit dans un salon qu'elle surveille. Elle utilise un compte dédié au robot, sur
votre propre serveur (Prosody, ejabberd, Snikket, Openfire…) ou sur un serveur public.

> **Développée sans le matériel : vos retours sont les bienvenus.** L'intégration a été testée contre un vrai
> serveur Prosody 13, mais pas dans un vrai Gladys ni avec toutes les applis XMPP. Dites ce qui marche et ce
> qui ne marche pas dans les [issues](https://github.com/guim31/gladys-xmpp/issues) ou sur le
> [forum Gladys](https://community.gladysassistant.com).

## Ce qu'il vous faut

- Gladys Assistant **5.1.0** ou plus récent.
- Un **compte XMPP dédié au robot** (par exemple `gladys@example.org`), sur un serveur que Gladys peut
  joindre : votre propre serveur sur le réseau local, ou un serveur public sur Internet. N'utilisez pas votre
  compte personnel : le robot répond en son nom.
- Un serveur qui propose le **chiffrement** (STARTTLS sur le port 5222, ou TLS direct sur le port 5223) :
  c'est le cas de tous par défaut. Le mot de passe du robot n'est jamais envoyé sur une connexion en clair.
- L'adresse XMPP de chaque personne autorisée à parler au robot, comme `alice@example.org`.

## Mise en place

1. Créez le compte du robot (sur votre serveur : comme les autres comptes, par exemple
   `prosodyctl adduser gladys@example.org` ; sur un serveur public : une inscription ordinaire).
2. Dans Gladys, **Intégrations → XMPP → Configuration** :
   - **Adresse du robot (JID)** et **Mot de passe du robot** : le compte du robot.
   - **Serveur (facultatif)** : vide, le serveur est trouvé d'après l'adresse (enregistrements DNS SRV,
     comme le fait toute appli XMPP). Sinon un nom d'hôte ou une adresse IP, avec un port si besoin :
     `192.168.1.20` ou `xmpp.example.org:5222` (STARTTLS), `192.168.1.20:5223` ou `xmpps://xmpp.example.org`
     (TLS direct).
   - **Accepter un certificat auto-signé** : seulement pour votre propre serveur sur le réseau local, dont
     le certificat n'est pas signé par une autorité. La connexion reste chiffrée, mais le serveur n'est pas
     vérifié. Désactivé par défaut.
   - **Personnes autorisées** : les adresses XMPP que le robot écoute, séparées par des virgules. **Vide,
     le robot ne répond à personne** : il ignore les messages de tous ceux qui ne sont pas dans la liste.
   - **Salons surveillés** : les salons (MUC) dont les messages lancent des scènes, comme
     `maison@conference.example.org`, séparés par des virgules. Ils doivent déjà exister : le robot les
     rejoint (si le salon est réservé aux membres, faites d'abord du robot un membre).
   - **Pseudo dans les salons** : `Gladys` par défaut.
   - **Préfixe des commandes** : `!` par défaut.
   - **Langue du robot** : la langue de ce que le robot écrit avant qu'une personne soit liée.
3. Cliquez sur **Tester la connexion** : le compte rendu donne l'adresse du robot, les salons surveillés
   qu'il a rejoints et le nombre de personnes autorisées. Le statut de connexion de la page le dit aussi.

### Lier votre adresse XMPP pour parler à Gladys

Chaque utilisateur de Gladys qui veut parler à Gladys depuis XMPP le fait une fois :

1. Dans votre appli XMPP, ajoutez le robot à vos contacts (son adresse) si vous le souhaitez ; ce n'est pas
   obligatoire.
2. Dans Gladys, **Intégrations → XMPP → Configuration**, bloc « Lier mon compte » : cliquez sur **Générer un
   code de liaison**.
3. Envoyez le code (8 caractères) au robot dans une discussion à deux. Le robot confirme : votre adresse
   XMPP est liée à votre utilisateur Gladys. Vous pouvez la délier depuis le même bloc.

## Ce que fait le robot

- **Dans une discussion à deux** : il transmet vos messages à Gladys, avec les droits de l'utilisateur
  Gladys lié, exactement comme le bot Telegram : « Quelle température fait-il dans le salon ? », « Éteins
  les lumières ». Les réponses de Gladys reviennent dans cette discussion. Les messages que Gladys vous
  envoie (l'action de scène **Envoyer un message**, les messages du système) y arrivent aussi.
- **Dans un salon surveillé** : chaque message d'une personne autorisée lance le déclencheur **Message XMPP
  reçu**, et un message qui commence par le préfixe lance aussi **Commande XMPP reçue**. Le robot n'y répond
  jamais de lui-même, là où d'autres peuvent lire : la suite dépend de vos scènes.
- **Qui est qui dans un salon** : une personne est reconnue par son adresse XMPP, jamais par son pseudo. Le
  salon doit montrer au robot les vraies adresses de ses membres : un salon « non anonyme » (Prosody,
  ejabberd : l'option du salon qui montre les adresses à tous), ou le robot nommé modérateur du salon.
- **Ce qu'il ignore** : tous ceux qui ne sont pas des personnes autorisées, ses propres messages,
  l'historique des salons, les messages privés envoyés par un salon, les notifications de saisie et
  accusés de réception, et les messages de plus de 5 minutes quand il les reçoit (gardés par le serveur
  pendant que Gladys était arrêté : un « !garage ouvre » d'il y a deux heures ne s'exécute pas maintenant).
- **Connexion** : le robot apparaît en ligne, répond aux pings du serveur et le sonde toutes les 2 minutes.
  Quand la connexion tombe, il se reconnecte tout seul (après 2, 5, 10, 30 puis 60 secondes).

## Tableau de bord

Le widget **XMPP** indique si le robot est connecté, son adresse, les salons surveillés où il se trouve, les
5 derniers messages reçus dans les salons surveillés (pseudo, texte, date) et un bouton **Tester la
connexion**. Les discussions à deux avec Gladys n'y apparaissent jamais : tous ceux qui voient le tableau de
bord voient le widget.

## Scènes

### Déclencheurs

- **Message XMPP reçu** : une personne autorisée a écrit dans un salon surveillé. Filtres (vide = tous) :
  **Salon** (`maison@conference.example.org`) et **Expéditeur** (l'adresse de la personne,
  `alice@example.org`). Variables : Message, Expéditeur, Pseudo, Salon.
- **Commande XMPP reçue** : une personne autorisée a écrit une commande dans un salon surveillé : le
  préfixe, puis un mot, puis des arguments facultatifs, par exemple `!lumieres off cuisine`. Filtre
  **Commande** : le mot **sans le préfixe, en minuscules** (`lumieres`) ; et Salon, Expéditeur. Variables :
  Commande (`lumieres`), Arguments (`off cuisine`), Message, Expéditeur, Pseudo, Salon. Le même message
  lance aussi **Message XMPP reçu**.
- **Connexion XMPP perdue** : le robot ne joint plus le serveur, depuis une minute, ou son mot de passe ou le
  certificat du serveur sont refusés. Variable : Erreur. Lancé une fois, jusqu'au retour de la connexion.
- **Connexion XMPP rétablie** : le robot joint de nouveau le serveur après une perte de connexion.
  Variable : Compte du robot.

### Actions

- **Envoyer un message XMPP** : écrit un message à une adresse XMPP (`alice@example.org`, même une personne
  non autorisée : le robot ne fait que lui écrire) ou dans un salon surveillé
  (`maison@conference.example.org`). Le message accepte les variables de scène. Résultats : Envoyé
  (oui/non), Erreur. Un message en échec n'arrête pas la scène : testez **Envoyé** par une condition si
  besoin. L'écho du message dans le salon ne lance jamais les déclencheurs.

Pour écrire à un utilisateur de Gladys plutôt qu'à une adresse, utilisez l'action **Envoyer un message** de
Gladys : elle arrive sur son adresse XMPP liée.

### Idées de scènes

- **Garage par commande** : déclencheur **Commande XMPP reçue**, commande `garage`, salon
  `maison@conference.example.org` ; puis une condition sur la variable Arguments égale à `ferme`, et
  l'action qui ferme le garage.
- **Machine à laver terminée** : déclencheur sur la puissance de la prise, puis **Envoyer un message XMPP**
  à `maison@conference.example.org` : « La machine à laver a fini ».
- **Alerte quand le robot est coupé** : déclencheur **Connexion XMPP perdue**, puis une notification par un
  autre canal (Gotify, ntfy, SMS) avec la variable Erreur.

## Dépannage

- **« le serveur XMPP ne répond pas »** : vérifiez **Serveur (facultatif)**. Vide, le domaine de l'adresse
  doit avoir des enregistrements DNS SRV (`_xmpp-client._tcp`) ou pointer vers le serveur lui-même ; sur un
  réseau local, saisissez l'adresse IP du serveur.
- **« certificat du serveur refusé »** : le certificat est auto-signé, expiré, ou ne nomme pas le domaine de
  l'adresse. Pour votre propre serveur sur le réseau local, cochez **Accepter un certificat auto-signé**.
- **« adresse ou mot de passe du robot refusé »** : vérifiez-les en vous connectant avec le compte du robot
  dans une appli XMPP.
- **« le serveur ne propose pas de chiffrement »** : activez TLS sur le serveur (c'est le réglage par défaut
  de Prosody et d'ejabberd).
- **Un salon surveillé n'est pas rejoint** : le statut de la page et le test le nomment. Le salon doit
  exister (le robot ne crée pas de salon : une adresse mal saisie est signalée), et le robot doit y être
  admis : membre d'un salon réservé aux membres, pas banni. Les salons protégés par mot de passe ne sont pas
  pris en charge.
- **Le robot ne me répond pas** : votre adresse est-elle dans **Personnes autorisées**, écrite exactement ?
  Votre adresse est-elle liée (le robot vous donne alors les instructions) ? Votre appli envoie-t-elle le
  message en discussion à deux (et pas par un salon) ?
- **Un message de salon ne lance pas la scène** : le salon montre-t-il les vraies adresses au robot (voir
  « Qui est qui dans un salon ») ? Le filtre Commande est le mot sans le préfixe, en minuscules :
  `lumieres`, pas `!Lumieres`.
- Plus de détails dans les journaux de l'intégration avec `LOG_LEVEL=debug`.

## Limites

- **Pas de chiffrement de bout en bout** (ni OMEMO, ni OpenPGP) : le robot ne lit et n'écrit que des
  messages en clair. Ils circulent chiffrés entre votre appli, le serveur et Gladys (TLS), mais le serveur
  peut les lire. Si votre appli chiffre par défaut (Conversations, Monocles, Dino), désactivez OMEMO dans la
  discussion avec le robot.
- Une personne liée à Gladys peut faire depuis XMPP tout ce que peut faire son utilisateur Gladys : gardez
  la liste des personnes autorisées courte, et protégez le compte du robot (mot de passe solide, jamais
  réutilisé).
- Les images envoyées par Gladys (captures de caméra) ne sont pas transmises : seul le texte part. Les
  images, fichiers et messages vocaux envoyés au robot sont ignorés.
- Un compte de robot par Gladys, avec la ressource `gladys` : se connecter ailleurs avec la même ressource
  déconnecte le robot pendant une minute.
- Les salons protégés par mot de passe, et ceux où le robot ne voit pas les vraies adresses, ne sont pas
  pris en charge pour les déclencheurs.
- Non affilié à la XMPP Standards Foundation.
