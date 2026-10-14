package slack

import (
	"context"
	_ "embed"
	"log"

	"github.com/mafredri/cdp/protocol/runtime"
)

// MuteMode is the requested microphone state.
type MuteMode int

const (
	MuteToggle MuteMode = iota
	MuteOn
	MuteOff
)

// Action results reported by SetMuted and SetSticker.
const (
	ActionChanged     = "changed"
	ActionAlreadySet  = "already_set"
	ActionNotInHuddle = "not_in_huddle"
)

const muteButtonSelector = `button[data-qa="segmented-mute-button-main"]`

// SetMuted clicks the huddle mute button unless the microphone is already in the
// requested state.
func SetMuted(ctx context.Context, browser *Browser, mode MuteMode) (string, error) {
	pages, err := readPages(ctx, browser)
	if err != nil {
		return "", err
	}

	target := find(pages, hasMuteButton, inHuddle)
	if target == nil || !target.status.InHuddle {
		return ActionNotInHuddle, nil
	}
	if !target.status.HasMuteButton {
		return "mute_button_missing", nil
	}
	if mode != MuteToggle && target.status.Muted != nil && *target.status.Muted == (mode == MuteOn) {
		return ActionAlreadySet, nil
	}

	err = target.page.Call(ctx, `(selector) => document.querySelector(selector)?.click()`, nil, muteButtonSelector)
	if err != nil {
		return "", err
	}
	return ActionChanged, nil
}

const muteBinding = "__huddlewireReportMuteState"

//go:embed js/mute-observer.js
var muteObserverScript string

// ObserveMuteState installs a mutation observer in every Slack page that calls
// onMuteState as soon as the mute button changes, without waiting for a poll.
// onMuteState runs on a page's event goroutine.
func ObserveMuteState(ctx context.Context, browser *Browser, onMuteState func(muted bool)) error {
	pages, err := browser.Pages(ctx)
	if err != nil {
		return err
	}

	for _, page := range pages {
		if err := page.observeMuteState(ctx, onMuteState); err != nil && !page.Closed() {
			log.Printf("install Slack mute observer on %s: %v", page.URL, err)
		}
	}
	return nil
}

func (p *Page) observeMuteState(ctx context.Context, onMuteState func(muted bool)) error {
	if !p.muteObserving {
		if err := p.client.Runtime.Enable(ctx); err != nil {
			return err
		}
		if err := p.client.Runtime.AddBinding(ctx, runtime.NewAddBindingArgs(muteBinding)); err != nil {
			return err
		}
		// The stream lives as long as the page connection.
		calls, err := p.client.Runtime.BindingCalled(p.conn.Context())
		if err != nil {
			return err
		}
		go func() {
			defer calls.Close()
			for {
				call, err := calls.Recv()
				if err != nil {
					return
				}
				if call.Name != muteBinding {
					continue
				}
				switch call.Payload {
				case "true":
					onMuteState(true)
				case "false":
					onMuteState(false)
				}
			}
		}()

		p.muteObserving = true
	}

	// Slack replaces the document on reload, so the observer is reinstalled on
	// every poll; the script is a no-op while its observer is still attached.
	return p.Evaluate(ctx, muteObserverScript, nil)
}
