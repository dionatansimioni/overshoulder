# Broadcasting

[← Documentation](README.md) · English · [Português](pt-BR/broadcasting.md)

## Before joining

The room's entry screen has a preview: turn on the camera and microphone to test them (the green bar shows the volume). Whatever is on there joins the room on, if you are allowed to speak or appear.

## The control bar

- **On the left, your inputs:** microphone, camera and screen (or window). An active microphone shows a ring that grows with your voice.
- **On the right:** volume, fullscreen, hide your own screen, record, settings and end the room.

## Sharing the screen

Click the screen button and pick the whole screen, a window or a tab. The badge in the corner of the preview shows what is actually going out: resolution, frames per second and Mbps.

**Hide your screen** (eye icon): the preview is blurred and nothing is played back for you. Viewers keep seeing it normally. Your own preview uses no server bandwidth, but showing it costs your computer processing power, which matters while you play.

## Quality

In **Settings**: quality (up to the maximum the admin allows) and codec.

- Changes apply right away, without stopping the share; viewers see a ~1 s blink.
- **H.264** usually uses the graphics card's encoder and is the lightest while you play. **AV1** and **VP9** look better at the same bitrate, but are heavier without a hardware encoder.
- Above 720p, the settings show how much each person receives and how much the server sends.

**Network warnings:** if your internet can't sustain the chosen quality for a few seconds, a warning appears with a button for the next quality down. There is also a warning when the connection loses many packets (viewers see stutters).

## Game audio

- **Windows (Chrome/Edge):** when picking "Entire screen", check "Share system audio".
- **Linux:** the browser doesn't send the computer's sound along with the screen. In **Settings › Game audio**, click "List" and pick the computer's sound source. It applies right away, even with the screen already shared, and the settings show where the audio is coming from.
  - **Firefox:** pick your sound output's **"Monitor of …"** device (PipeWire/PulseAudio).
  - **Chrome, Chromium, Edge and Brave:** they hide "Monitor of …" devices on purpose. Run the command below in a terminal, click "List" again and pick **"Overshoulder-jogo"**. The room chat shows the same command, with a copy button. The source lasts until you restart the computer.
    ```bash
    pactl load-module module-remap-source master="$(pactl get-default-sink).monitor" source_name=overshoulder_jogo source_properties=device.description=Overshoulder-jogo
    ```
  - **Only the game's sound**, without Discord or other apps: create an output just for the game, send the game to it (in pavucontrol or the sound settings) and broadcast its monitor:
    ```bash
    pactl load-module module-null-sink sink_name=jogo
    pactl load-module module-loopback source=jogo.monitor
    pactl load-module module-remap-source master=jogo.monitor source_name=overshoulder_jogo source_properties=device.description=Overshoulder-jogo
    ```
    `module-loopback` lets you keep hearing the game. In Firefox, the last line is optional: you can pick "Monitor of jogo".

## Camera over the screen

Turn on the camera together with the screen: it shows up in the corner, on top (picture-in-picture). In Settings, choose the corner, the size and the shape (rectangle or circle). Viewers can hide the camera or swap it with the screen. Without a screen, the camera becomes the main video.

## On a phone

Mobile browsers can't share the screen, but you can do a camera-only live. To broadcast a mobile game, mirror the phone's screen on your computer (scrcpy on Android, AirPlay on iPhone) and share that window. The full guide is at `/mobile`, on the server itself.
