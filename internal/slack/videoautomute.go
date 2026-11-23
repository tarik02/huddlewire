package slack

import (
	"context"
	_ "embed"

	"go.uber.org/zap"
)

//go:embed js/video-auto-mute.js
var videoAutoMuteScript string

// PreventVideoAutoMute stops Slack from muting the microphone while a video
// plays in the huddle. It returns how many Slack stores it newly patched.
func PreventVideoAutoMute(ctx context.Context, browser *Browser) (int, error) {
	pages, err := browser.Pages(ctx)
	if err != nil {
		return 0, err
	}

	total := 0
	for _, page := range pages {
		// Slack replaces its stores on reload, so the patch is reapplied on
		// every poll; already patched stores are skipped.
		var patched int
		if err := page.Evaluate(ctx, videoAutoMuteScript, &patched); err != nil {
			if !page.Closed() {
				browser.log.Warn("patch Slack video auto-mute", zap.String("url", page.URL), zap.Error(err))
			}
			continue
		}
		total += patched
	}
	return total, nil
}
