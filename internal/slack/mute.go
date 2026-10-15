package slack

import (
	"context"
	_ "embed"

	"github.com/chromedp/chromedp"
	"go.uber.org/zap"
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
// onMuteState runs on its own goroutine for each change.
func ObserveMuteState(ctx context.Context, browser *Browser, onMuteState func(muted bool)) error {
	pages, err := browser.Pages(ctx)
	if err != nil {
		return err
	}

	for _, page := range pages {
		if err := page.observeMuteState(ctx, onMuteState); err != nil && !page.Closed() {
			browser.log.Warn("install Slack mute observer", zap.String("url", page.URL), zap.Error(err))
		}
	}
	return nil
}

func (p *Page) observeMuteState(ctx context.Context, onMuteState func(muted bool)) error {
	if !p.muteObserving {
		report := func(_ context.Context, muted bool) (chromedp.Void, error) {
			onMuteState(muted)
			return chromedp.Void{}, nil
		}
		if _, err := run(ctx, p, chromedp.ExposeFunc(muteBinding, report)); err != nil {
			return err
		}
		p.muteObserving = true
	}

	// Slack replaces the document on reload, so the observer is reinstalled on
	// every poll; the script is a no-op while its observer is still attached.
	return p.Evaluate(ctx, muteObserverScript, nil)
}
