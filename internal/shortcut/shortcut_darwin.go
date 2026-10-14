// Package shortcut registers the global mute shortcut.
package shortcut

import (
	"context"
	"log"

	"golang.design/x/hotkey"
	"golang.design/x/hotkey/mainthread"
)

// RunOnMainThread runs f while the main thread serves the Cocoa event loop that
// delivers hotkey events. It does not return.
func RunOnMainThread(f func()) {
	mainthread.Init(f)
}

// kVK_F20, the highest function key macOS knows. hotkey only defines up to F19.
const keyF20 hotkey.Key = 0x5A

// Register calls toggle whenever F20 is pressed. It uses a Carbon hotkey, which
// needs no Accessibility permission. hotkey v0.6 switched to an event tap that
// does, and macOS would ask again whenever the Nix store path changes.
func Register(ctx context.Context, toggle func()) error {
	key := hotkey.New(nil, keyF20)
	if err := key.Register(); err != nil {
		return err
	}
	log.Print("global mute shortcut registered: F20")

	go func() {
		for {
			select {
			case <-ctx.Done():
				if err := key.Unregister(); err != nil {
					log.Printf("unregister global mute shortcut: %v", err)
				}
				return
			case <-key.Keydown():
				toggle()
			}
		}
	}()
	return nil
}
