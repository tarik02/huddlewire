// Package shortcut registers the global mute shortcut.
package shortcut

import (
	"context"
	"fmt"
	"os"

	"go.uber.org/zap"
	"golang.design/x/hotkey"
	"golang.design/x/hotkey/mainthread"
)

// RunOnMainThread runs f while the main thread serves the Cocoa event loop that
// delivers hotkey events. The event loop never returns, so this exits the
// process when f does, printing its error.
func RunOnMainThread(f func() error) error {
	mainthread.Init(func() {
		if err := f(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	})
	return nil
}

// kVK_F20, the highest function key macOS knows. hotkey only defines up to F19.
const keyF20 hotkey.Key = 0x5A

// Register calls toggle whenever F20 is pressed. It uses a Carbon hotkey, which
// needs no Accessibility permission. hotkey v0.6 switched to an event tap that
// does, and macOS would ask again whenever the Nix store path changes.
func Register(ctx context.Context, log *zap.Logger, toggle func()) error {
	key := hotkey.New(nil, keyF20)
	if err := key.Register(); err != nil {
		return err
	}
	log.Info("global mute shortcut registered", zap.String("key", "F20"))

	go func() {
		for {
			select {
			case <-ctx.Done():
				if err := key.Unregister(); err != nil {
					log.Warn("unregister global mute shortcut", zap.Error(err))
				}
				return
			case <-key.Keydown():
				toggle()
			}
		}
	}()
	return nil
}
