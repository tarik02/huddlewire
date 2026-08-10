# huddlewire

`huddlewire` is a desktop control plane for Slack Huddles. It connects to
Slack's local Chrome DevTools endpoint to expose reliable commands, publishes
Huddle state to MQTT/Home Assistant, and fixes Slack's screen-sharing flow on
Wayland by handing source selection to the native desktop portal.

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
- `PATCH_NATIVE_SCREEN_SHARE` (defaults to `true`)
- `POLL_INTERVAL_MS` (defaults to `1000`)

## Development

```console
nix develop
pnpm install
pnpm typecheck
pnpm build
nix build
```
