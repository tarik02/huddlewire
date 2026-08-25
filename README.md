# huddlewire

`huddlewire` is a desktop control plane for Slack Huddles. It connects to
Slack's local Chrome DevTools endpoint to expose reliable commands, publishes
Huddle state to MQTT/Home Assistant, and fixes Slack's screen-sharing flow on
Wayland by handing source selection to the native desktop portal.

## Install

Install the CLI from a local checkout:

```console
nix profile install .
```

Slack must expose a local Chrome DevTools endpoint:

```console
slack --remote-debugging-address=127.0.0.1 --remote-debugging-port=9224
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

The daemon also reads the following environment variables:

- `MQTT_URL` (required)
- `MQTT_USERNAME`, `MQTT_PASSWORD`
- `MQTT_BASE_TOPIC` (defaults to `huddlewire`)
- `HA_DISCOVERY_PREFIX` (defaults to `homeassistant`)
- `HA_DEVICE_ID` (defaults to `huddlewire`)
- `HA_DEVICE_NAME` (defaults to `Slack huddle`)
- `PATCH_NATIVE_SCREEN_SHARE` (defaults to `true`)
- `POLL_INTERVAL_MS` (defaults to `1000`)
- `HUDDLEWIRE_SOUND_PLAYER` (optional `pw-play`-compatible executable)
- `HUDDLEWIRE_MUTED_SOUND`, `HUDDLEWIRE_UNMUTED_SOUND` (required sound file paths
  when `HUDDLEWIRE_SOUND_PLAYER` is set)

To run the included user service, copy its environment and unit files:

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
pnpm install
pnpm check
pnpm typecheck
nix build
```
