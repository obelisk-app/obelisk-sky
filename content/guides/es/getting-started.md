---
title: Primeros pasos en Obelisk Sky
seoTitle: 'Primeros pasos en Obelisk Sky, el pueblo de Nostr'
description: Entrá a Obelisk Sky en un minuto. Recorrelo como invitado, ingresá con tu clave de Nostr o un link de invitación y aprendé los controles en la compu y el celu.
hero: island-orbit
order: 1
publishedAt: '2026-10-29'
updatedAt: '2026-10-29'
tags: [getting-started, nostr, login, controls, nip-29]
howTo:
  name: Cómo entrar a Obelisk Sky
  totalTime: PT5M
  steps:
    - { name: Recorrelo como invitado, anchor: recorrelo-como-invitado, text: Abrí sky.obelisk.ar y tocá Entrar a la isla. Sin ingresar caés en la isla de invitados y ya podés caminar. }
    - { name: Ingresá con Nostr, anchor: ingresa-con-nostr, text: 'Tocá Ingresar arriba a la derecha. ¿Sos nuevo? Creá una cuenta nueva y descargá tu archivo de clave. ¿Ya tenés una? Usá tu extensión del navegador, tu clave privada o su archivo, o un firmador remoto.' }
    - { name: Entrá con un link de invitación, anchor: entra-con-un-link-de-invitacion, text: 'Si el relay es solo con invitación, abrí el link que te mandaron. Te deja entrar con tu clave, o con una nueva creada en el momento.' }
    - { name: Aprendé los controles, anchor: aprende-los-controles, text: 'Caminá con WASD o haciendo clic en el suelo, arrastrá para girar la cámara, E para sentarte y N para el minimapa. El botón ? muestra todas las teclas.' }
---

## Qué es Obelisk Sky

Obelisk Sky es un pueblo en una isla flotante, y también una app de chat de verdad. Cada canal de un relay de grupos de [Nostr](https://nostr.com) es una casa. Cuando alguien escribe en un canal, su personaje camina hasta esa casa. Cuando le responde a alguien, camina hasta esa persona. Podés sentarte en la plaza con un mate, sumarte a una llamada, jugar o simplemente mirar cómo las conversaciones se mueven por la isla.

Es otra forma de entrar a los mismos grupos que [Obelisk](https://obelisk.ar). El chat es el mismo y la gente es la misma: una app los muestra como una lista y la otra como un pueblo. Todo corre en tu navegador. Tu clave queda con vos y el servidor solo entrega la página.

<Shot name="village" caption="El pueblo desde arriba. Cada cartel es un canal y su número es cuánta gente anda cerca." />

## Recorrelo como invitado

Abrí [sky.obelisk.ar](https://sky.obelisk.ar) y tocá **Entrar a la isla**. No necesitás cuenta para mirar. Si no ingresaste, caés en la **isla de invitados**: seis casas, vecinos charlando en ellas, la plaza, el café y el parque. Sus charlas son de muestra y quedan en tu navegador, así que podés probar todo sin publicar nada.

<Shot name="guest-island" caption="La isla de invitados. El aviso de arriba te lleva a ingresar cuando quieras." />

<Callout>
La isla de invitados es para conocer. Sus conversaciones son ejemplos armados. Ingresá para ver el pueblo de verdad, donde cada casa es un canal en vivo y cada personaje es una persona real.
</Callout>

## Ingresá con Nostr

Tocá **Ingresar** arriba a la derecha. Obelisk Sky usa tu identidad de Nostr: sin mail y sin contraseña. El ingreso muestra primero la cuenta nueva y, abajo, todo lo que sirve si ya tenés una.

<Shot name="login" caption="El ingreso: el mismo de obelisk.ar, así que una cuenta sirve en los dos." maxWidth={440} />

### Si sos nuevo en Nostr: creá una cuenta

Tocá **Crear una cuenta nueva**. Sky crea tu clave ahí mismo, en tu dispositivo, y te muestra la parte privada, la `nsec`. Tocá **Descargá tu archivo de clave** para guardarla en un `.txt` chiquito. **Continuar** no se habilita hasta que lo guardes, porque ese archivo es tu cuenta: en Nostr no existe el "me olvidé la contraseña". Después elegís nombre y foto, y listo.

<Shot name="new-key" caption="Tu clave nueva. Continuar espera a que guardes el archivo de clave." maxWidth={420} />

<Callout>
Guardá el archivo de clave en un lugar seguro y privado, como un gestor de contraseñas o un pendrive. Quien lo tenga puede usar tu cuenta.
</Callout>

### Ya tengo una cuenta

Debajo de **Ya tengo una cuenta**:

- **Extensión del navegador** (NIP-07): Alby, nos2x, Flamingo o la extensión de nostr-wot. Solo aparece cuando Sky encuentra una instalada en tu navegador. Es lo más seguro en una compu.
- **Clave privada o archivo de clave**: pegá tu `nsec`, o tocá **Subir archivo de clave** y elegí el `.txt` que guardaste al crear la cuenta. Sky saca la clave de ahí.
- **Firmador remoto** (NIP-46): un "bunker" como Amber en Android o nsec.app. Tu clave queda en esa app y Sky le pide que firme.

<Shot name="key-file" caption="Volver a entrar con tu clave: pegá la nsec o subí el archivo de clave." maxWidth={420} />

Una vez adentro, aparecés en la isla del relay que elegiste. El de siempre es el Obelisk Public Relay (`public.obelisk.ar`). La píldora del relay, arriba a la izquierda, cambia a cualquier otro relay NIP-29, así que cada comunidad puede tener su propia isla.

## Entrá con un link de invitación

Algunos relays solo dejan entrar a la gente que admitieron. Si el tuyo todavía no admitió tu clave, te quedás en la isla de invitados y Sky te lo avisa. La forma de entrar es un **link de invitación** como `sky.obelisk.ar/invite/…?relay=public.obelisk.ar`. Abrilo, ingresá o creá una cuenta nueva, y el relay te deja pasar.

Quienes pueden invitar (el dueño del relay, sus admins y algunas cuentas de confianza) tienen **Invitar personas** en el menú de la cuenta, arriba a la derecha. Cada link muestra quién entró con él.

## Aprendé los controles

Sos el personaje con tu nombre encima. El botón **?** de la barra de abajo abre *Cómo se juega* cuando quieras. Estas son las teclas que más vas a usar:

| Tecla | Qué hace |
| --- | --- |
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> o flechas | Caminar. Mantené <kbd>Shift</kbd> o tocá dos veces una dirección para correr |
| Clic en el suelo | Caminar hasta ahí |
| Arrastrar, rueda | Girar la cámara, zoom |
| <kbd>Espacio</kbd> | Saltar |
| <kbd>Enter</kbd> | Escribir en el canal donde estás |
| <kbd>E</kbd> | Sentarte en un banco a tomar mate, trabajar en el café, comer en la parrilla, entrenar en el parque |
| <kbd>F</kbd> | Subirte a un ñandú (o bajarte) |
| <kbd>G</kbd> | Gestos: bailar, la postura del loto, asentir… |
| <kbd>V</kbd> | Primera persona |
| <kbd>N</kbd> | El minimapa; hacé clic para agrandarlo |

<Shot name="controls" caption="Cómo se juega, desde el botón ?: todas las teclas, en tu idioma." maxWidth={520} />

El minimapa es la forma más rápida de moverte. Agrandalo, hacé clic en una casa y caminás directo hasta ahí.

<Shot name="minimap" caption="El minimapa grande: hacé clic en una casa para ir." />

## En el celular

Sky también anda en el celu. Ponelo de costado: el pueblo necesita el ancho. La **palanca** abajo a la izquierda te hace caminar, y empujarla hasta el borde te hace correr. Tocá el suelo para ir hasta ahí, arrastrá para girar la cámara y pellizcá para hacer zoom. Las teclas se vuelven botones que aparecen cuando sirven, como **Sentarte a tomar mate** al lado de un banco o **Montar** al lado de un ñandú. La barra de abajo se guarda en el botón de menú de arriba.

<Shot name="phone" caption="En un celular de costado: la palanca a la izquierda, saltar y el botón del asiento a la derecha." />

## Para seguir

- [Cada canal es una casa](/es/guides/channels-are-houses): cómo se chatea en el pueblo.
- [Tu look, mascotas, montar y nadar](/es/guides/look-pets-and-moving): armá tu personaje.
- [Mate, llamadas, juegos y zaps](/es/guides/hang-out-and-play): todo lo que se puede hacer en la isla.
