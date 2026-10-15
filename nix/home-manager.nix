{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.huddlewire;

  environment =
    cfg.environment
    // lib.optionalAttrs (cfg.sounds.muted != null) {
      HUDDLEWIRE_MUTED_SOUND = "${cfg.sounds.muted}";
      HUDDLEWIRE_UNMUTED_SOUND = "${cfg.sounds.unmuted}";
    };

  # launchd has no EnvironmentFile, so the agent sources it before starting.
  launchdDaemon = pkgs.writeShellScript "huddlewire-daemon" ''
    ${lib.optionalString (cfg.environmentFile != null) ''
      set -a
      . ${lib.escapeShellArg cfg.environmentFile}
      set +a
    ''}
    exec ${lib.getExe cfg.package} daemon
  '';
in
{
  options.services.huddlewire = {
    enable = lib.mkEnableOption "the huddlewire Slack Huddles daemon";

    package = lib.mkOption {
      type = lib.types.package;
      description = "The huddlewire package.";
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = {
        MQTT_URL = "mqtt://homeassistant.local:1883";
        HA_DEVICE_NAME = "Slack huddle";
      };
      description = ''
        Environment variables for the daemon, as documented in the README.
        Keep secrets such as `MQTT_PASSWORD` in {option}`environmentFile`.
      '';
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "/run/secrets/huddlewire.env";
      description = ''
        Runtime path of a file with `KEY=value` lines, read at start so secrets
        stay out of the Nix store. Quote values that contain spaces.
      '';
    };

    sounds = {
      muted = lib.mkOption {
        type = lib.types.nullOr lib.types.path;
        default = null;
        description = "MP3 played when the huddle microphone is muted.";
      };
      unmuted = lib.mkOption {
        type = lib.types.nullOr lib.types.path;
        default = null;
        description = "MP3 played when the huddle microphone is unmuted.";
      };
    };
  };

  config = lib.mkIf cfg.enable (
    lib.mkMerge [
      {
        assertions = [
          {
            assertion = (cfg.sounds.muted == null) == (cfg.sounds.unmuted == null);
            message = "services.huddlewire.sounds.muted and .unmuted must be set together.";
          }
        ];

        home.packages = [ cfg.package ];
      }

      (lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
        systemd.user.services.huddlewire = {
          Unit = {
            Description = "Huddlewire Slack Huddles control plane";
            After = [
              "graphical-session.target"
              "network-online.target"
            ];
            Wants = [ "network-online.target" ];
            PartOf = [ "graphical-session.target" ];
          };
          Service = {
            Type = "simple";
            Environment = lib.mapAttrsToList (name: value: "${name}=${value}") environment;
            EnvironmentFile = lib.mkIf (cfg.environmentFile != null) cfg.environmentFile;
            ExecStart = "${lib.getExe cfg.package} daemon";
            Restart = "on-failure";
            RestartSec = 5;
          };
          Install.WantedBy = [ "graphical-session.target" ];
        };
      })

      (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
        launchd.agents.huddlewire = {
          enable = true;
          config = {
            ProgramArguments = [ "${launchdDaemon}" ];
            EnvironmentVariables = environment;
            KeepAlive = true;
            RunAtLoad = true;
            # Shortcut presses and feedback sounds should not be throttled.
            ProcessType = "Interactive";
            StandardOutPath = "${config.home.homeDirectory}/Library/Logs/huddlewire.log";
            StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/huddlewire.log";
          };
        };
      })
    ]
  );
}
