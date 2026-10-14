// Command huddlewire controls Slack Huddles from the command line, a global
// shortcut, and Home Assistant.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"slices"
	"syscall"
	"time"

	"github.com/tarik02/huddlewire/internal/config"
	"github.com/tarik02/huddlewire/internal/daemon"
	"github.com/tarik02/huddlewire/internal/shortcut"
	"github.com/tarik02/huddlewire/internal/slack"
)

const usage = `Usage:
  huddlewire daemon
  huddlewire mute toggle|on|off
  huddlewire status [--json]

Environment:
  SLACK_CDP_URL   Slack DevTools endpoint (default: http://127.0.0.1:9224)
  MQTT_URL        MQTT broker URL required by the daemon`

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	args := os.Args[1:]
	if len(args) > 0 && args[0] == "daemon" {
		// The daemon's global shortcut needs the main thread on macOS.
		shortcut.RunOnMainThread(func() {
			os.Exit(runDaemon(ctx))
		})
		return
	}
	os.Exit(runCommand(ctx, args))
}

func runDaemon(ctx context.Context) int {
	cfg, err := config.Read()
	if err == nil {
		err = daemon.Run(ctx, cfg)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}

func runCommand(ctx context.Context, args []string) int {
	command := ""
	if len(args) > 0 {
		command = args[0]
	}

	switch command {
	case "", "help", "--help", "-h":
		fmt.Println(usage)
		return 0
	case "mute":
		mode := "toggle"
		if len(args) > 1 {
			mode = args[1]
		}
		modes := map[string]slack.MuteMode{"toggle": slack.MuteToggle, "on": slack.MuteOn, "off": slack.MuteOff}
		muteMode, ok := modes[mode]
		if !ok {
			fmt.Fprintf(os.Stderr, "unknown mute mode: %s\n", mode)
			return 1
		}

		var action string
		err := withSlack(ctx, func(ctx context.Context, browser *slack.Browser) (err error) {
			action, err = slack.SetMuted(ctx, browser, muteMode)
			return err
		})
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		fmt.Println(action)
		if action != slack.ActionChanged && action != slack.ActionAlreadySet {
			return 2
		}
		return 0
	case "status":
		var status slack.Status
		err := withSlack(ctx, func(ctx context.Context, browser *slack.Browser) (err error) {
			status, err = slack.ReadStatus(ctx, browser)
			return err
		})
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		if slices.Contains(args[1:], "--json") {
			encoded, err := json.Marshal(status)
			if err != nil {
				fmt.Fprintln(os.Stderr, err)
				return 1
			}
			fmt.Println(string(encoded))
		} else {
			fmt.Println(status.HuddleState)
		}
		return 0
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", command)
		return 1
	}
}

func withSlack(ctx context.Context, run func(context.Context, *slack.Browser) error) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	browser, err := slack.Connect(ctx, config.SlackCDPURL())
	if err != nil {
		return err
	}
	defer browser.Close()
	return run(ctx, browser)
}
