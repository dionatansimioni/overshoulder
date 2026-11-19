# Rooms

[← Documentation](README.md) · English · [Português](pt-BR/rooms.md)

## Creating a room

On the home page, click **Create room** and pick the type. The room is created right away and the entry screen already shows the invitation link to copy. Less common choices are under "More options".

| Type | How it works |
|---|---|
| **Playing together** | Everyone talks, like a call. By default, anyone can share their screen (you can turn that off in "More options", and then people ask) |
| **Live** | Only presenters talk. The audience uses the chat; if the host allows it, they can also **ask to speak** or **ask to share their screen** |

With several screens live, each person chooses which one to watch and only receives that one.

## Encryption and the link

The invitation buttons sit at the top of the room: **Copy invite** (the link itself isn't shown; paste it on Discord, WhatsApp or anywhere), **New link** and, if set up, **Discord**.

The room key is created in your browser and travels only in the link's `#`: the server never sees it and relays a video it can't open. Because of that:

- whoever loses the link loses access; the server has no way to recover the key;
- the sidebar on the home page shows **the rooms from this browser**, each with its type icon (controller for Playing together, antenna for Live); on another device the list starts empty. Double-click a room's name to give it a nickname (Enter or clicking elsewhere saves, Esc cancels, an empty name restores the original); the nickname stays in this browser;
- the chat goes through the server over HTTPS, but isn't end-to-end encrypted.

## Private room

Under "More options", **Private room**: the room isn't saved in the browser and ends when the host leaves for more than 30 seconds (a grace period for reloading the page or a network drop). On a shared computer, also use "When signing out, forget the rooms in this browser" on the home page.

## Invitations and waiting room

The default link has no limit. Under **People › Invitations and entry**, the host creates named invitations (e.g. "Clan Discord") with a limit of people, an expiry and an optional password, and can revoke an invitation (the link dies and whoever came in through it leaves). Whoever joins keeps a "ticket" in the browser: reloading the page doesn't use up the invitation again.

The **waiting room** makes each person wait for the host to let them in.

## Announce on Discord

If the admin set up a Discord channel webhook (at `/admin` › General), the host of a room who has an account gets an **Announce on Discord** button next to the invitation link. It posts a card to the channel with the room and the invitation link.

The post goes straight from the host's browser to Discord: the server never sees the link, which carries the room key. Everyone in the Discord channel gets the link, just as if someone pasted it there. The webhook is only sent to people with an account; viewers never receive it.

## Permanent rooms

The admin creates, at `/admin` › Permanent rooms, rooms that don't go away, with the same link and the same invitations forever (the community channel, the weekly live). The room goes on air when someone joins. The key is created in the admin's browser; in another browser, the admin needs the link or a new key (which invalidates the old links).

## Moderation

In the **People** tab, the host:

- in a Live, chooses under **Audience requests** whether viewers can ask to speak and ask to share their screen (both start off; turning one off drops the pending requests of that kind);
- approves requests to speak and to share the screen, and grants or removes each person's voice and screen;
- removes someone (the person sees "The live has ended" and the link they used is replaced);
- turns off the chat for viewers and creates a new link for the room;
- under **Room settings**, changes the room's **people limit** while it's on the air (it applies to whoever joins next; "Use the server limit" goes back to the one in Administration › General) and, in Playing together, whether **anyone can share their screen**, without creating a new room.

When the room is full, whoever tries to join sees "The room is full". The host always gets in. A broadcaster's room can't go over the server limit; the admin's rooms go up to 5000. Changing the server limit applies right away to rooms on the air.

In the room's side drawer, **Administration** and **My account** open in another tab: the live keeps going, and **Back** on those pages closes the tab.

## Chat, People and Log

The side panel has the **Chat** (conversations only, for the host), **People** and, for the host, the **Log**: who joined, who left, requests to speak, the waiting room and the other room events. Viewers don't have the Log; they keep seeing these notices in the chat. The eye at the top shows how many people are in the room.

On a phone held upright, the video sits at the top, the controls right below it and the chat takes the rest of the screen. Turned sideways, the chat stays beside the video and can be hidden with the panel button; Settings opens as a sheet from the bottom. On a computer, the volume bar opens when you hover the speaker and shows the level (0 to 100%) while you drag it. The speaker icon mutes the room: the bar drops to zero and turns red, and clicking again brings back the volume you had.

## Featuring a question (Live)

In a Live, the host hovers over a message in the chat and clicks the **star** to put it on top of the video for everyone, with the name of whoever asked. People who join later see it too. Clicking the star again, or the **×** on the card, removes it. Only the host features messages; the card goes from browser to browser like the chat.

## Old links

A link to a room that has ended, or whose link the host has changed, no longer opens the join screen: it says the room no longer exists, with a button back to the home page and a hint to talk to the host for a new link. Hosts without an active session also get a shortcut to sign in and open another room.

## Ending the room

**End room** closes the room for everyone. The host, and anyone signed in to the server, goes back to the home page (if a recording was running, it is saved first). Viewers see a "The live has ended" screen.

## Recording

The host records, in their own browser, the video on screen and all the room's audio; the server never sees the content. Everyone in the room sees **● Recording**.

- In Chrome and Edge, the file goes to a folder you choose; in other browsers, it is downloaded when you stop.
- Format: MP4 with AAC audio when the browser can (Chrome on Windows and Mac); MP4 with Opus audio on Chromium; WebM on Firefox.
- Screen (with the audio) and camera go to separate files. Each stretch of video becomes a part (for example, stopping and sharing again).
- Editor that doesn't open Opus: `ffmpeg -i recording.mp4 -c:v copy -c:a aac recording-aac.mp4`.
