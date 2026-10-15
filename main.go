// Command huddlewire controls Slack Huddles from the command line, a global
// shortcut, and Home Assistant.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/tarik02/huddlewire/internal/config"
	"github.com/tarik02/huddlewire/internal/daemon"
	"github.com/tarik02/huddlewire/internal/shortcut"
	"github.com/tarik02/huddlewire/internal/slack"
)

// errNotApplied makes mute exit with code 2 when Slack has nothing to mute.
var errNotApplied = errors.New("mute not applied")

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	err := rootCommand().ExecuteContext(ctx)
	switch {
	case err == nil:
	case errors.Is(err, errNotApplied):
		os.Exit(2)
	default:
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func rootCommand() *cobra.Command {
	root := &cobra.Command{
		Use:           "huddlewire",
		Short:         "Control Slack Huddles through Slack's DevTools endpoint",
		Long:          "Control Slack Huddles through Slack's DevTools endpoint (SLACK_CDP_URL, default http://127.0.0.1:9224).",
		Version:       config.Version,
		SilenceErrors: true,
		SilenceUsage:  true,
	}
	root.AddCommand(daemonCommand(), muteCommand(), statusCommand())
	return root
}

func daemonCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "daemon",
		Short: "Publish huddle state to MQTT and toggle mute on the global shortcut",
		Long:  "Publish huddle state to MQTT with Home Assistant discovery and toggle mute on the global shortcut. Configured through the environment; MQTT_URL is required.",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := config.Read()
			if err != nil {
				return err
			}
			// The shortcut needs the main thread on macOS, which cobra runs on.
			return shortcut.RunOnMainThread(func() error {
				return daemon.Run(cmd.Context(), cfg)
			})
		},
	}
}

func muteCommand() *cobra.Command {
	modes := map[string]slack.MuteMode{
		"toggle": slack.MuteToggle,
		"on":     slack.MuteOn,
		"off":    slack.MuteOff,
	}
	return &cobra.Command{
		Use:       "mute [toggle|on|off]",
		Short:     "Mute, unmute, or toggle the huddle microphone",
		Args:      cobra.MatchAll(cobra.MaximumNArgs(1), cobra.OnlyValidArgs),
		ValidArgs: []string{"toggle", "on", "off"},
		RunE: func(cmd *cobra.Command, args []string) error {
			mode := slack.MuteToggle
			if len(args) == 1 {
				mode = modes[args[0]]
			}
			return withSlack(cmd.Context(), func(ctx context.Context, browser *slack.Browser) error {
				action, err := slack.SetMuted(ctx, browser, mode)
				if err != nil {
					return err
				}
				fmt.Println(action)
				if action != slack.ActionChanged && action != slack.ActionAlreadySet {
					return errNotApplied
				}
				return nil
			})
		},
	}
}

func statusCommand() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "status",
		Short: "Print the huddle state",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return withSlack(cmd.Context(), func(ctx context.Context, browser *slack.Browser) error {
				status, err := slack.ReadStatus(ctx, browser)
				if err != nil {
					return err
				}
				if !asJSON {
					fmt.Println(status.HuddleState)
					return nil
				}
				return json.NewEncoder(os.Stdout).Encode(status)
			})
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "print the full status as JSON")
	return cmd
}

func withSlack(ctx context.Context, run func(context.Context, *slack.Browser) error) error {
	cfg, err := config.ReadSlack()
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	browser, err := slack.Connect(ctx, cfg.SlackCDPURL)
	if err != nil {
		return err
	}
	defer browser.Close()
	return run(ctx, browser)
}
