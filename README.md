# huddlewire

`huddlewire` is a desktop control plane for Slack Huddles. It connects to
Slack's local Chrome DevTools endpoint to expose reliable commands, toggles the
huddle microphone from a global shortcut, publishes Huddle state to MQTT/Home
Assistant, and fixes Slack's screen-sharing flow on Wayland by handing source
selection to the native desktop portal.

It runs on Linux and macOS.

## Install

```console
nix profile install github:tarik02/huddlewire
```

Slack must expose a local Chrome DevTools endpoint. On Linux:

```console
slack --remote-debugging-address=127.0.0.1 --remote-debugging-port=9224
```

On macOS:

```console
open -a Slack --args --remote-debugging-address=127.0.0.1 --remote-debugging-port=9224
```

The DevTools endpoint can control the signed-in Slack session. Keep it bound to
`127.0.0.1`; never expose it on a LAN or public interface.

## Commands

```console
huddlewire daemon
huddlewire mute toggle
huddlewire mute on
huddlewire mute off
huddlewire status --json
```

Slack must be running with a local DevTools endpoint. The default is
`http://127.0.0.1:9224` and can be changed with `SLACK_CDP_URL`.

## Daemon

The daemon publishes the huddle state to MQTT with Home Assistant discovery,
accepts mute and sticker commands from it, and toggles mute on a global
shortcut:

- Linux: F24, registered through KDE's KGlobalAccel.
- macOS: F20, the highest function key macOS supports. It needs no
  Accessibility permission.

It reads the following environment variables:

- `MQTT_URL` (required), for example `mqtt://homeassistant.local:1883`
- `MQTT_USERNAME`, `MQTT_PASSWORD`
- `MQTT_BASE_TOPIC` (defaults to `huddlewire`)
- `HA_DISCOVERY_PREFIX` (defaults to `homeassistant`)
- `HA_DEVICE_ID` (defaults to `huddlewire`)
- `HA_DEVICE_NAME` (defaults to `Slack huddle`)
- `PATCH_NATIVE_SCREEN_SHARE` (defaults to `true` on Linux and `false` on macOS)
- `POLL_INTERVAL_MS` (defaults to `1000`)
- `HUDDLEWIRE_MUTED_SOUND`, `HUDDLEWIRE_UNMUTED_SOUND` (optional MP3 files
  played when the microphone is muted or unmuted; set both or neither)

To run the included systemd user service on Linux, copy its environment and
unit files:

```console
mkdir -p ~/.config/huddlewire ~/.config/systemd/user
cp .env.example ~/.config/huddlewire/env
cp systemd/user/huddlewire.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now huddlewire.service
```

## Development

```console
nix develop
go vet ./...
go build .
nix build
```
