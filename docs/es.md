# XMPP

Hable con Gladys desde [XMPP](https://xmpp.org) (Jabber), el estándar de mensajería abierto y
descentralizado (Conversations, Monocles, Gajim, Dino, Siskin, Monal, Snikket…), como con el bot de Telegram
de Gladys: haga una pregunta, lance una escena, reciba los mensajes de Gladys. La integración también
escribe a direcciones XMPP y en salas desde sus escenas, y lanza escenas cuando se escribe un mensaje o un
comando como `!luces off` en una sala que vigila. Usa una cuenta dedicada al bot, en su propio servidor
(Prosody, ejabberd, Snikket, Openfire…) o en uno público.

> **Desarrollada sin el hardware: sus comentarios son bienvenidos.** La integración se ha probado contra un
> servidor Prosody 13 real, pero no dentro de un Gladys real ni con todas las apps XMPP. Cuéntenos qué
> funciona y qué no en las [issues](https://github.com/guim31/gladys-xmpp/issues) o en el
> [foro de Gladys](https://community.gladysassistant.com).

## Lo que necesita

- Gladys Assistant **5.1.0** o posterior.
- Una **cuenta XMPP dedicada al bot** (por ejemplo `gladys@example.org`), en un servidor que Gladys pueda
  alcanzar: su propio servidor en la red local, o uno público en Internet. No use su cuenta personal: el bot
  responde en su nombre.
- Un servidor que ofrezca **cifrado** (STARTTLS en el puerto 5222, o TLS directo en el puerto 5223): todos
  lo hacen por defecto. La contraseña del bot nunca se envía por una conexión sin cifrar.
- La dirección XMPP de cada persona autorizada a hablar con el bot, como `alice@example.org`.

## Puesta en marcha

1. Cree la cuenta del bot (en su servidor: como las demás cuentas, por ejemplo
   `prosodyctl adduser gladys@example.org`; en un servidor público: un registro normal).
2. En Gladys, **Integraciones → XMPP → Configuración**:
   - **Dirección del bot (JID)** y **Contraseña del bot**: la cuenta del bot.
   - **Servidor (opcional)**: vacío, el servidor se encuentra a partir de la dirección (registros DNS SRV,
     como hace cualquier app XMPP). Si no, un nombre de host o una dirección IP, con un puerto si hace
     falta: `192.168.1.20` o `xmpp.example.org:5222` (STARTTLS), `192.168.1.20:5223` o
     `xmpps://xmpp.example.org` (TLS directo).
   - **Aceptar un certificado autofirmado**: solo para su propio servidor en la red local, cuyo certificado
     no está firmado por una autoridad. La conexión sigue cifrada, pero el servidor no se verifica.
     Desactivado por defecto.
   - **Personas autorizadas**: las direcciones XMPP que el bot escucha, separadas por comas. **Vacío, el
     bot no responde a nadie**: ignora los mensajes de quien no esté en esta lista.
   - **Salas vigiladas**: las salas (MUC) cuyos mensajes lanzan escenas, como
     `casa@conference.example.org`, separadas por comas. Deben existir ya: el bot entra en ellas (si la sala
     es solo para miembros, haga antes miembro al bot).
   - **Apodo en las salas**: `Gladys` por defecto.
   - **Prefijo de los comandos**: `!` por defecto.
   - **Idioma del bot**: el idioma de lo que escribe el bot antes de vincular a una persona.
3. Pulse **Probar la conexión**: el informe da la dirección del bot, las salas vigiladas en las que ha
   entrado y el número de personas autorizadas. El estado de conexión de la página también lo indica.

### Vincular su dirección XMPP para hablar con Gladys

Cada usuario de Gladys que quiera hablar con Gladys desde XMPP lo hace una vez:

1. En su app XMPP, añada el bot a sus contactos (su dirección) si lo desea; no es obligatorio.
2. En Gladys, **Integraciones → XMPP → Configuración**, bloque «Vincular mi cuenta»: pulse **Generar un
   código de vinculación**.
3. Envíe el código (8 caracteres) al bot en un chat individual. El bot lo confirma: su dirección XMPP está
   vinculada a su usuario de Gladys. Puede desvincularla desde el mismo bloque.

## Lo que hace el bot

- **En un chat individual**: transmite sus mensajes a Gladys, con la autoridad del usuario de Gladys
  vinculado, igual que el bot de Telegram: «¿Qué temperatura hace en el salón?», «Apaga las luces». Las
  respuestas de Gladys vuelven a este chat. Los mensajes que Gladys le envía (la acción de escena **Enviar
  mensaje**, los mensajes del sistema) también llegan allí.
- **En una sala vigilada**: cada mensaje de una persona autorizada lanza el desencadenante **Mensaje XMPP
  recibido**, y un mensaje que empieza por el prefijo lanza también **Comando XMPP recibido**. El bot nunca
  responde allí por sí mismo, donde otros pueden leer: lo que pase depende de sus escenas.
- **Quién es quién en una sala**: una persona se reconoce por su dirección XMPP, nunca por su apodo. La
  sala debe mostrar al bot las direcciones reales de sus miembros: una sala «no anónima» (Prosody,
  ejabberd: la opción de la sala que muestra las direcciones a todos), o el bot nombrado moderador de la
  sala.
- **Lo que ignora**: a quien no sea una persona autorizada, sus propios mensajes, el historial de las salas,
  los mensajes privados enviados a través de una sala, las notificaciones de escritura y los acuses de
  recibo, y los mensajes de más de 5 minutos cuando los recibe (guardados por el servidor mientras Gladys
  estaba parado: un «!garaje abre» de hace dos horas no se ejecuta ahora).
- **Conexión**: el bot aparece en línea, responde a los pings del servidor y le hace un ping cada 2
  minutos. Si la conexión cae, se reconecta solo (tras 2, 5, 10, 30 y luego 60 segundos).

## Panel

El widget **XMPP** muestra si el bot está conectado, su dirección, las salas vigiladas en las que está, los
5 últimos mensajes recibidos en las salas vigiladas (apodo, texto, fecha) y un botón **Probar la conexión**.
Los chats individuales con Gladys nunca aparecen: todos los que ven el panel ven el widget.

## Escenas

### Desencadenantes

- **Mensaje XMPP recibido**: una persona autorizada ha escrito en una sala vigilada. Filtros (vacío =
  cualquiera): **Sala** (`casa@conference.example.org`) y **Remitente** (la dirección de la persona,
  `alice@example.org`). Variables: Mensaje, Remitente, Apodo, Sala.
- **Comando XMPP recibido**: una persona autorizada ha escrito un comando en una sala vigilada: el prefijo,
  luego una palabra, luego argumentos opcionales, por ejemplo `!luces off cocina`. Filtro **Comando**: la
  palabra **sin el prefijo, en minúsculas** (`luces`); y Sala, Remitente. Variables: Comando (`luces`),
  Argumentos (`off cocina`), Mensaje, Remitente, Apodo, Sala. El mismo mensaje lanza también **Mensaje XMPP
  recibido**.
- **Conexión XMPP perdida**: el bot ya no alcanza el servidor desde hace un minuto, o se rechazan su
  contraseña o el certificado del servidor. Variable: Error. Se lanza una vez, hasta que vuelve la conexión.
- **Conexión XMPP restablecida**: el bot vuelve a alcanzar el servidor tras una pérdida de conexión.
  Variable: Cuenta del bot.

### Acciones

- **Enviar un mensaje XMPP**: escribe un mensaje a una dirección XMPP (`alice@example.org`, incluso a una
  persona no autorizada: el bot solo le escribe) o en una sala vigilada (`casa@conference.example.org`). El
  mensaje acepta las variables de escena. Resultados: Enviado (sí/no), Error. Un mensaje fallido no detiene
  la escena: compruebe **Enviado** con una condición si hace falta. El eco del mensaje en la sala nunca
  lanza los desencadenantes.

Para escribir a un usuario de Gladys en lugar de a una dirección, use la acción **Enviar mensaje** de
Gladys: llega a su dirección XMPP vinculada.

### Ideas de escenas

- **Garaje por comando**: desencadenante **Comando XMPP recibido**, comando `garaje`, sala
  `casa@conference.example.org`; luego una condición sobre la variable Argumentos igual a `cierra`, y la
  acción que cierra el garaje.
- **Lavadora terminada**: desencadenante sobre la potencia del enchufe, luego **Enviar un mensaje XMPP** a
  `casa@conference.example.org`: «La lavadora ha terminado».
- **Alerta cuando el bot se desconecta**: desencadenante **Conexión XMPP perdida**, luego una notificación
  por otro canal (Gotify, ntfy, SMS) con la variable Error.

## Solución de problemas

- **«el servidor XMPP no responde»**: revise **Servidor (opcional)**. Vacío, el dominio de la dirección
  debe tener registros DNS SRV (`_xmpp-client._tcp`) o apuntar al propio servidor; en una red local,
  introduzca la dirección IP del servidor.
- **«certificado del servidor rechazado»**: el certificado es autofirmado, ha caducado o no nombra el
  dominio de la dirección. Para su propio servidor en la red local, marque **Aceptar un certificado
  autofirmado**.
- **«dirección o contraseña del bot rechazadas»**: compruébelas iniciando sesión con la cuenta del bot en
  una app XMPP.
- **«el servidor no ofrece cifrado»**: active TLS en el servidor (es la opción por defecto de Prosody y
  ejabberd).
- **No se entra en una sala vigilada**: el estado de la página y la prueba la nombran. La sala debe existir
  (el bot no crea salas: una dirección mal escrita se indica), y el bot debe estar admitido: miembro de una
  sala solo para miembros, no vetado. Las salas protegidas por contraseña no están soportadas.
- **El bot no me responde**: ¿está su dirección en **Personas autorizadas**, escrita exactamente? ¿Está su
  dirección vinculada (el bot le da entonces las instrucciones)? ¿Envía su app el mensaje como chat
  individual (y no a través de una sala)?
- **Un mensaje de sala no lanza la escena**: ¿muestra la sala las direcciones reales al bot (vea «Quién es
  quién en una sala»)? El filtro Comando es la palabra sin el prefijo, en minúsculas: `luces`, no `!Luces`.
- Más detalles en los registros de la integración con `LOG_LEVEL=debug`.

## Límites

- **Sin cifrado de extremo a extremo** (ni OMEMO ni OpenPGP): el bot solo lee y escribe mensajes sin cifrar.
  Viajan cifrados entre su app, el servidor y Gladys (TLS), pero el servidor puede leerlos. Si su app cifra
  por defecto (Conversations, Monocles, Dino), desactive OMEMO en el chat con el bot.
- Una persona vinculada a Gladys puede hacer desde XMPP todo lo que puede hacer su usuario de Gladys:
  mantenga corta la lista de personas autorizadas y proteja la cuenta del bot (contraseña robusta, nunca
  reutilizada).
- Las imágenes enviadas por Gladys (capturas de cámara) no se reenvían: solo sale el texto. Las imágenes,
  archivos y mensajes de voz enviados al bot se ignoran.
- Una cuenta de bot por Gladys, con el recurso `gladys`: iniciar sesión en otro sitio con el mismo recurso
  desconecta al bot durante un minuto.
- Las salas protegidas por contraseña, y aquellas en las que el bot no ve las direcciones reales, no están
  soportadas para los desencadenantes.
- Sin afiliación con la XMPP Standards Foundation.
