// Package daemon keeps Home Assistant in sync with Slack and executes mute and
// sticker commands.
package daemon

import (
	"context"
	"encoding/json"
	"time"

	"github.com/tarik02/huddlewire/internal/config"
	"github.com/tarik02/huddlewire/internal/homeassistant"
	"github.com/tarik02/huddlewire/internal/shortcut"
	"github.com/tarik02/huddlewire/internal/slack"
	"github.com/tarik02/huddlewire/internal/sound"

	"go.uber.org/zap"
)

// commandTimeout bounds a single Slack operation, so a hung DevTools
// connection cannot stall polling.
const commandTimeout = 15 * time.Second

type command struct {
	name string
	run  func(ctx context.Context, browser *slack.Browser) (string, error)
}

// daemon owns the Slack connection. Only Run's goroutine touches it; commands
// and observer events reach it through channels.
type daemon struct {
	log     *zap.Logger
	cfg     config.Config
	mqtt    *homeassistant.Client
	sounds  *sound.Player
	browser *slack.Browser

	commands   chan command
	muteEvents chan bool

	lastStatusKey    string
	lastMuted        *bool
	lastPollError    string
	screenSharePatch map[string]string
}

// Run polls Slack until ctx is cancelled.
func Run(ctx context.Context, log *zap.Logger, cfg config.Config) error {
	d := &daemon{
		log:              log,
		cfg:              cfg,
		commands:         make(chan command, 16),
		muteEvents:       make(chan bool, 16),
		screenSharePatch: map[string]string{},
	}

	if cfg.MutedSound != "" {
		sounds, err := sound.Load(cfg.MutedSound, cfg.UnmutedSound)
		if err != nil {
			return err
		}
		d.sounds = sounds
	}

	d.mqtt = homeassistant.Connect(log, cfg, homeassistant.Handlers{
		OnMute: func(muted bool) {
			mode := slack.MuteOff
			if muted {
				mode = slack.MuteOn
			}
			d.enqueue(ctx, "slack huddle mute action", func(ctx context.Context, browser *slack.Browser) (string, error) {
				return slack.SetMuted(ctx, browser, mode)
			})
		},
		OnSticker: func(sticker string) {
			d.enqueue(ctx, "slack huddle sticker action", func(ctx context.Context, browser *slack.Browser) (string, error) {
				return slack.SetSticker(ctx, browser, sticker)
			})
		},
	})
	defer d.mqtt.Close()

	err := shortcut.Register(ctx, log, func() {
		d.enqueue(ctx, "global mute shortcut action", func(ctx context.Context, browser *slack.Browser) (string, error) {
			return slack.SetMuted(ctx, browser, slack.MuteToggle)
		})
	})
	if err != nil {
		log.Warn("global mute shortcut registration failed", zap.Error(err))
	}

	defer func() {
		if d.browser != nil {
			d.browser.Close()
		}
	}()

	poll := time.NewTimer(0)
	defer poll.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case cmd := <-d.commands:
			d.execute(ctx, cmd)
		case muted := <-d.muteEvents:
			d.updateMuted(muted)
		case <-poll.C:
			d.poll(ctx)
			poll.Reset(time.Duration(cfg.PollIntervalMs) * time.Millisecond)
		}
	}
}

func (d *daemon) enqueue(ctx context.Context, name string, run func(context.Context, *slack.Browser) (string, error)) {
	select {
	case d.commands <- command{name: name, run: run}:
	case <-ctx.Done():
	}
}

func (d *daemon) connect() (*slack.Browser, error) {
	if d.browser == nil {
		browser, err := slack.Connect(d.log, d.cfg.SlackCDPURL)
		if err != nil {
			return nil, err
		}
		d.browser = browser
	}
	return d.browser, nil
}

func (d *daemon) disconnect() {
	if d.browser != nil {
		d.browser.Close()
		d.browser = nil
	}
}

func (d *daemon) execute(ctx context.Context, cmd command) {
	ctx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()

	browser, err := d.connect()
	if err == nil {
		var action string
		action, err = cmd.run(ctx, browser)
		if err == nil {
			d.log.Info(cmd.name, zap.String("action", action))
			return
		}
	}
	d.log.Warn(cmd.name+" failed", zap.Error(err))
}

// updateMuted plays a feedback sound when the microphone state changes within
// a huddle. The first state seen after joining is silent.
func (d *daemon) updateMuted(muted bool) {
	if d.lastMuted != nil && *d.lastMuted != muted && d.sounds != nil {
		d.sounds.Play(muted)
	}
	d.lastMuted = &muted
}

func (d *daemon) poll(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()

	status, err := d.readSlack(ctx)
	if err != nil {
		d.disconnect()
		if message := err.Error(); message != d.lastPollError {
			d.log.Warn("slack cdp read failed", zap.Error(err))
			d.lastPollError = message
		}
		d.publish(slack.OfflineStatus())
		return
	}
	d.lastPollError = ""

	if status.InHuddle && status.HuddleState != slack.HuddleUnknown {
		d.updateMuted(status.Muted)
	} else if !status.InHuddle {
		d.lastMuted = nil
	}
	if d.publish(status) {
		d.log.Info("slack huddle state", zap.String("state", string(status.HuddleState)))
	}
}

func (d *daemon) readSlack(ctx context.Context) (slack.Status, error) {
	browser, err := d.connect()
	if err != nil {
		return slack.Status{}, err
	}

	err = slack.ObserveMuteState(ctx, browser, func(muted bool) {
		select {
		case d.muteEvents <- muted:
		default:
			// The next poll reads the state anyway.
		}
	})
	if err != nil {
		return slack.Status{}, err
	}

	if d.cfg.PatchNativeScreenShare {
		results, err := slack.PatchNativeScreenShare(ctx, browser)
		if err != nil {
			return slack.Status{}, err
		}
		for _, result := range results {
			if d.screenSharePatch[result.Page] != result.Status {
				d.screenSharePatch[result.Page] = result.Status
				d.log.Info("slack native screen-share patch", zap.String("status", result.Status), zap.String("page", result.Page))
			}
		}
	}

	return slack.ReadStatus(ctx, browser)
}

// publish sends status to MQTT if it differs from the last one and reports
// whether it did.
func (d *daemon) publish(status slack.Status) bool {
	encoded, err := json.Marshal(status)
	if err != nil {
		d.log.Error("encode slack status", zap.Error(err))
		return false
	}
	if key := string(encoded); key != d.lastStatusKey {
		d.lastStatusKey = key
		d.mqtt.PublishStatus(status)
		return true
	}
	return false
}
