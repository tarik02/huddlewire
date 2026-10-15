// Package config reads huddlewire's environment configuration.
package config

import (
	"errors"
	"runtime"

	"github.com/caarlos0/env/v11"
)

// AppName identifies huddlewire in MQTT topics and Home Assistant discovery.
const AppName = "huddlewire"

// Version is set at build time.
var Version = "dev"

// Slack locates Slack's DevTools endpoint.
type Slack struct {
	SlackCDPURL string `env:"SLACK_CDP_URL" envDefault:"http://127.0.0.1:9224"`
}

// Config configures the daemon.
type Config struct {
	Slack

	MQTTURL           string `env:"MQTT_URL,required,notEmpty"`
	MQTTUsername      string `env:"MQTT_USERNAME"`
	MQTTPassword      string `env:"MQTT_PASSWORD"`
	MQTTBaseTopic     string `env:"MQTT_BASE_TOPIC" envDefault:"huddlewire"`
	HADiscoveryPrefix string `env:"HA_DISCOVERY_PREFIX" envDefault:"homeassistant"`
	DeviceID          string `env:"HA_DEVICE_ID" envDefault:"huddlewire"`
	DeviceName        string `env:"HA_DEVICE_NAME" envDefault:"Slack huddle"`

	PollIntervalMs         int  `env:"POLL_INTERVAL_MS" envDefault:"1000"`
	PatchNativeScreenShare bool `env:"PATCH_NATIVE_SCREEN_SHARE"`

	MutedSound   string `env:"HUDDLEWIRE_MUTED_SOUND"`
	UnmutedSound string `env:"HUDDLEWIRE_UNMUTED_SOUND"`
}

// ReadSlack reads the Slack endpoint, which is all one-shot commands need.
func ReadSlack() (Slack, error) {
	return env.ParseAs[Slack]()
}

// Read reads the daemon configuration from the environment.
func Read() (Config, error) {
	cfg := Config{
		// The patch replaces Slack's screen-source picker, which only fails on
		// Wayland. env keeps this value when the variable is unset.
		PatchNativeScreenShare: runtime.GOOS == "linux",
	}
	if err := env.Parse(&cfg); err != nil {
		return Config{}, err
	}

	if cfg.PollIntervalMs < 250 {
		return Config{}, errors.New("POLL_INTERVAL_MS must be at least 250")
	}
	if (cfg.MutedSound == "") != (cfg.UnmutedSound == "") {
		return Config{}, errors.New("HUDDLEWIRE_MUTED_SOUND and HUDDLEWIRE_UNMUTED_SOUND must be set together")
	}
	return cfg, nil
}
