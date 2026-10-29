---
title: 'Cada canal es una casa: chatear en Sky'
description: Cómo Obelisk Sky convierte los chats grupales de Nostr en un pueblo. Cada canal NIP-29 es una casa, escribir te lleva ahí y responder te lleva a la persona.
hero: plaza-meetup
order: 2
publishedAt: '2026-10-29'
updatedAt: '2026-10-29'
tags: [chat, channels, nip-29, nostr, groups]
---

## Las casas son canales

En Obelisk Sky la isla **es** el relay. Cada canal (un grupo NIP-29) tiene una casa, con un cartel que muestra su nombre y cuánta gente anda cerca. Cuanto más movido el canal, más grande la casa. Los canales de voz son distintos: cada uno es un ombú con una fogata adelante y troncos para sentarse alrededor, y ahí es la llamada.

<Shot name="village" caption="Cada cartel es un canal: Bitcoin, Nostr dev, Mate y charla, Fitness, Arte y memes…" />

Algunas casas son lugares con edificio propio: La Crypta, la sede de nostr-wot, el café, la parrilla, el cine. Están en [la guía para pasarla bien](/es/guides/hang-out-and-play).

## Abrí un canal

Hay tres formas de abrir un canal:

1. **Caminá hasta su casa.** Parate frente a la puerta y se abre su chat.
2. **Hacé clic en su cartel o en el edificio.** Caminás hasta ahí solo.
3. **Elegilo de la lista.** La píldora **#** de arriba a la derecha lista todos los canales del relay, en las categorías del propio relay, con cuánta gente hay en cada uno.

<Shot name="channels" caption="La lista de canales, desde la píldora #: todos los canales y quién anda." maxWidth={360} />

## Escribí, y caminá hasta ahí

Apretá <kbd>Enter</kbd> (o tocá la barra de mensaje) y escribí. Cuando publicás en un canal, **tu personaje camina hasta su casa** y todo el pueblo te ve ir. Con los mensajes de los demás pasa lo mismo, por eso el pueblo nunca está quieto: la gente cruza la plaza hacia las charlas que tiene.

<Shot name="guest-chat" caption="El chat de un canal a la derecha. En la isla, la gente que está en él se junta en su casa." />

## Respondé, y caminá hasta la persona

Hacé clic en el globo de alguien (o en un mensaje del chat) para responderle. **Caminás hasta esa persona** y tu respuesta queda debajo de su mensaje. Una charla entre dos se ve como dos personas hablando, paradas juntas.

La barra de mensaje es la misma de obelisk.ar, así que tenés todo lo de siempre:

- Respuestas, reacciones y @-menciones
- Emojis, GIFs y stickers, incluidos los emojis propios del relay
- Audios y fotos
- Comandos, como `/zap` para mandarle una propina a alguien y `/play` para empezar un juego

<Shot name="voice-note" caption="Respuestas, reacciones y un audio, en el chat del pueblo." maxWidth={380} />

## El mismo chat que obelisk.ar

Sky no tiene un chat propio. Lee y escribe los mismos eventos de Nostr que [obelisk.ar](https://obelisk.ar). Un mensaje que mandás desde la isla aparece en la app de Obelisk, y al revés. Usá la que más te guste y cambiá cuando quieras.

## En vivo, juntos

Ves a los demás moverse en tiempo real. Cada paso es un evento de Nostr de corta vida que ningún relay guarda, así que a los pocos segundos ya no está. Lo que estás haciendo (sentado, entrenando, bailando) dura solo mientras lo hacés y desaparece cuando cerrás la pestaña. El botón **Historial** de la barra de abajo repite la última charla por la isla, y tocarlo de nuevo te vuelve al vivo.

## Cómo se traduce a Nostr

| En el pueblo | En Nostr |
| --- | --- |
| Una casa | Un grupo NIP-29 (metadatos kind 39000) |
| Caminar hasta una casa | Publicar un mensaje kind 9 en ese grupo |
| La foto sobre tu cabeza | Tu perfil kind 0 |
| Tu look 3D y tu mascota | Un evento reemplazable kind 30078 (`obelisk:avatar3d:v1`) |
| La gente moviéndose | Eventos efímeros, nunca guardados |
| Monedas volando entre personas | Zaps (NIP-57), enviados con NWC o WebLN |

Como todo es Nostr común, Sky anda con **cualquier relay NIP-29**, no solo con el de Obelisk. Elegí uno desde la píldora del relay, arriba a la izquierda, y tenés la isla de esa comunidad.

## Para seguir

- [Primeros pasos](/es/guides/getting-started): ingresar, invitaciones y controles.
- [Tu look, mascotas, montar y nadar](/es/guides/look-pets-and-moving).
- [Mate, llamadas, juegos y zaps](/es/guides/hang-out-and-play).
