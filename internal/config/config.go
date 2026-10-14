// Package config reads huddlewire's environment configuration.
package config

import (
	"errors"
	"os"
	"runtime"
	"strconv"
	"time"
)

// AppName identifies huddlewire in MQTT topics and Home Assistant discovery.
const AppName = "huddlewire"

// Version is set at build time.
var Version = "dev"

// Sounds are the feedback sounds played when the huddle mute state changes.
type Sounds struct {
	MutedPath   string
	UnmutedPath string
}

// Config configures the daemon.
type Config struct {
	SlackCDPURL            string
	PatchNativeScreenShare bool
	MQTTURL                string
	MQTTUsername           string
	MQTTPassword           string
	MQTTBaseTopic          string
	HADiscoveryPrefix      string
	PollInterval           time.Duration
	DeviceID               string
	DeviceName             string
	Sounds                 *Sounds
}

func env(name, fallback string) string {
	if value, ok := os.LookupEnv(name); ok {
		return value
	}
	return fallback
}

// SlackCDPURL returns Slack's DevTools endpoint.
func SlackCDPURL() string {
	return env("SLACK_CDP_URL", "http://127.0.0.1:9224")
}

// Read reads the daemon configuration from the environment.
func Read() (Config, error) {
	mqttURL := os.Getenv("MQTT_URL")
	if mqttURL == "" {
		return Config{}, errors.New("MQTT_URL is required")
	}

	pollIntervalMs, err := strconv.Atoi(env("POLL_INTERVAL_MS", "1000"))
	if err != nil || pollIntervalMs < 250 {
		return Config{}, errors.New("POLL_INTERVAL_MS must be an integer of at least 250")
	}

	mutedSound := os.Getenv("HUDDLEWIRE_MUTED_SOUND")
	unmutedSound := os.Getenv("HUDDLEWIRE_UNMUTED_SOUND")
	var sounds *Sounds
	switch {
	case mutedSound != "" && unmutedSound != "":
		sounds = &Sounds{MutedPath: mutedSound, UnmutedPath: unmutedSound}
	case mutedSound != "" || unmutedSound != "":
		return Config{}, errors.New("HUDDLEWIRE_MUTED_SOUND and HUDDLEWIRE_UNMUTED_SOUND must be set together")
	}

	// The patch replaces Slack's screen-source picker, which only fails on
	// Wayland.
	patchNativeScreenShare := runtime.GOOS == "linux"
	if value, ok := os.LookupEnv("PATCH_NATIVE_SCREEN_SHARE"); ok {
		patchNativeScreenShare = value != "false"
	}

	return Config{
		SlackCDPURL:            SlackCDPURL(),
		PatchNativeScreenShare: patchNativeScreenShare,
		MQTTURL:                mqttURL,
		MQTTUsername:           os.Getenv("MQTT_USERNAME"),
		MQTTPassword:           os.Getenv("MQTT_PASSWORD"),
		MQTTBaseTopic:          env("MQTT_BASE_TOPIC", AppName),
		HADiscoveryPrefix:      env("HA_DISCOVERY_PREFIX", "homeassistant"),
		PollInterval:           time.Duration(pollIntervalMs) * time.Millisecond,
		DeviceID:               env("HA_DEVICE_ID", AppName),
		DeviceName:             env("HA_DEVICE_NAME", "Slack huddle"),
		Sounds:                 sounds,
	}, nil
}
