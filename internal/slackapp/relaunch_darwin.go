// Package slackapp keeps the Slack app running with its DevTools endpoint.
package slackapp

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"net/url"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"go.uber.org/zap"
	"golang.org/x/sys/unix"
)

const (
	checkInterval = 2 * time.Second
	// newAge is how long after start Slack still counts as just launched, so
	// restarting it cannot drop a huddle the user has joined.
	newAge   = time.Minute
	quitWait = 10 * time.Second
	// startWait bounds how long the relaunched Slack takes to appear.
	startWait  = 20 * time.Second
	executable = "/Contents/MacOS/Slack"
)

// Options configures Watch.
type Options struct {
	// CDPURL is the DevTools endpoint Slack is relaunched to open.
	CDPURL string
	// NewOnly restricts relaunching to a Slack started within the last
	// minute. An older Slack only gets a notification.
	NewOnly bool
	// UserDataDir is the Slack profile the relaunched Slack opens. Slack
	// refuses to open its DevTools endpoint on its default profile.
	UserDataDir string
}

type process struct {
	pid     int
	started time.Time
	path    string
	args    []string
}

// Watch relaunches Slack with its DevTools endpoint whenever it runs without
// one, as it does after the user opens it from the Dock or it updates itself.
// It never starts a Slack that is not running.
func Watch(ctx context.Context, log *zap.Logger, opts Options) error {
	endpoint, err := url.Parse(opts.CDPURL)
	if err != nil {
		return fmt.Errorf("parse SLACK_CDP_URL: %w", err)
	}
	if endpoint.Hostname() == "" || endpoint.Port() == "" {
		return fmt.Errorf("SLACK_CDP_URL %q needs a host and a port", opts.CDPURL)
	}
	if opts.UserDataDir == "" {
		return errors.New("SLACK_USER_DATA_DIR is required to relaunch Slack")
	}
	flags := []string{
		"--user-data-dir=" + opts.UserDataDir,
		"--remote-debugging-address=" + endpoint.Hostname(),
		"--remote-debugging-port=" + endpoint.Port(),
	}

	go func() {
		// Each Slack process is handled once, so a failed relaunch or a
		// declined one is not retried every check.
		handled := map[int]bool{}
		ticker := time.NewTicker(checkInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}

			slack, err := findSlack()
			if err != nil {
				log.Warn("find slack process", zap.Error(err))
				continue
			}
			if slack == nil || handled[slack.pid] || hasDevTools(slack.args) {
				continue
			}
			handled[slack.pid] = true

			age := time.Since(slack.started)
			if opts.NewOnly && age > newAge {
				log.Warn("slack runs without devtools; restart it to connect", zap.Int("pid", slack.pid), zap.Stringer("age", age.Round(time.Second)))
				notify("Slack runs without DevTools. Restart Slack to connect huddlewire.")
				continue
			}

			log.Info("relaunching slack with devtools", zap.Int("pid", slack.pid))
			if err := relaunch(ctx, slack, flags); err != nil {
				log.Warn("relaunch slack", zap.Error(err))
				notify("Slack could not be relaunched with DevTools. Start it again.")
			}
		}
	}()
	return nil
}

func hasDevTools(args []string) bool {
	for _, arg := range args {
		if strings.HasPrefix(arg, "--remote-debugging-port=") {
			return true
		}
	}
	return false
}

// relaunch quits Slack with SIGTERM, which Electron handles as a regular quit.
// Quitting through Apple Events would need an Automation permission, which
// macOS asks for again whenever the Nix store path changes.
func relaunch(ctx context.Context, slack *process, flags []string) error {
	if err := syscall.Kill(slack.pid, syscall.SIGTERM); err != nil {
		return fmt.Errorf("quit slack: %w", err)
	}

	deadline := time.Now().Add(quitWait)
	for syscall.Kill(slack.pid, 0) == nil {
		if time.Now().After(deadline) {
			return fmt.Errorf("slack did not quit within %s", quitWait)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}

	bundle := strings.TrimSuffix(slack.path, executable)
	args := append([]string{"-a", bundle, "--args"}, flags...)
	if output, err := exec.CommandContext(ctx, "/usr/bin/open", args...).CombinedOutput(); err != nil {
		return fmt.Errorf("open slack: %w: %s", err, bytes.TrimSpace(output))
	}

	// open succeeds even when Slack exits right after launching, as it does
	// when it rejects its command line.
	deadline = time.Now().Add(startWait)
	for {
		started, err := findSlack()
		if err != nil {
			return err
		}
		if started != nil && hasDevTools(started.args) {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("slack did not start with devtools within %s", startWait)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func notify(message string) {
	script := fmt.Sprintf("display notification %q with title %q", message, "huddlewire")
	_ = exec.Command("/usr/bin/osascript", "-e", script).Run()
}

// findSlack returns Slack's main process, or nil if Slack is not running.
func findSlack() (*process, error) {
	procs, err := unix.SysctlKinfoProcSlice("kern.proc.uid", syscall.Getuid())
	if err != nil {
		return nil, err
	}
	for _, proc := range procs {
		// Helpers are named "Slack Helper …"; the main process only "Slack".
		if unix.ByteSliceToString(proc.Proc.P_comm[:]) != "Slack" {
			continue
		}
		pid := int(proc.Proc.P_pid)
		path, args, err := processArgs(pid)
		if err != nil {
			// The process may have exited since the listing.
			continue
		}
		if !strings.HasSuffix(path, ".app"+executable) {
			continue
		}
		started := proc.Proc.P_starttime
		return &process{
			pid:     pid,
			started: time.Unix(started.Sec, int64(started.Usec)*int64(time.Microsecond)),
			path:    path,
			args:    args,
		}, nil
	}
	return nil, nil
}

// processArgs reads kern.procargs2: argc, the executable path, padding, then
// argc NUL-terminated arguments and the environment.
func processArgs(pid int) (string, []string, error) {
	raw, err := unix.SysctlRaw("kern.procargs2", pid)
	if err != nil {
		return "", nil, err
	}
	if len(raw) < 4 {
		return "", nil, errors.New("short kern.procargs2")
	}
	argc := int(binary.LittleEndian.Uint32(raw))
	rest := raw[4:]

	end := bytes.IndexByte(rest, 0)
	if end < 0 {
		return "", nil, errors.New("unterminated executable path")
	}
	path := string(rest[:end])
	rest = bytes.TrimLeft(rest[end:], "\x00")

	args := make([]string, 0, argc)
	for len(args) < argc && len(rest) > 0 {
		end := bytes.IndexByte(rest, 0)
		if end < 0 {
			end = len(rest)
		}
		args = append(args, string(rest[:end]))
		rest = rest[min(end+1, len(rest)):]
	}
	return path, args, nil
}
