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
open -a Slack --args \
  --user-data-dir="$HOME/Library/Application Support/huddlewire/Slack" \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9224
```

Slack 4.53 and later refuse to open the DevTools endpoint on their default
profile, so on macOS Slack runs from a profile of its own. To keep the current
sign-in, copy the default profile there once while Slack is quit:

```console
rsync -a --exclude 'Singleton*' --exclude 'Cache/' --exclude 'Code Cache/' \
  "$HOME/Library/Application Support/Slack/" \
  "$HOME/Library/Application Support/huddlewire/Slack/"
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
- `SLACK_RELAUNCH` (macOS only, defaults to `true`): relaunch Slack with the
  DevTools flags from `SLACK_CDP_URL` when it runs without them, as it does
  after it is opened from the Dock or updates itself. A Slack that is not
  running is left alone.
- `SLACK_USER_DATA_DIR` (defaults to
  `~/Library/Application Support/huddlewire/Slack` on macOS): the Slack profile
  a relaunched Slack opens
- `SLACK_RELAUNCH_NEW_ONLY` (defaults to `true`): relaunch only a Slack started
  within the last minute, so a joined huddle is never dropped. An older Slack
  gets a notification asking to restart it.
- `HUDDLEWIRE_MUTED_SOUND`, `HUDDLEWIRE_UNMUTED_SOUND` (optional MP3 files
  played when the microphone is muted or unmuted; set both or neither)

## Home Manager

The flake exports a Home Manager module that runs the daemon as a systemd user
service on Linux and a launchd agent on macOS:

```nix
{
  imports = [ inputs.huddlewire.homeManagerModules.default ];

  services.huddlewire = {
    enable = true;
    environment.MQTT_URL = "mqtt://homeassistant.local:1883";
    # KEY=value lines, read at start; quote values that contain spaces.
    environmentFile = "/run/secrets/huddlewire.env";
    sounds = {
      muted = ./muted.mp3;
      unmuted = ./unmuted.mp3;
    };
  };
}
```

The module does not start Slack; launch it with the DevTools flags above. On
macOS the daemon relaunches a Slack started without them (`SLACK_RELAUNCH`).

## Without Nix

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
