package slack

import (
	"context"
	_ "embed"
)

// Slack asks whether the user is still there after they have been alone in a
// huddle for a while, and leaves the huddle unless the prompt is confirmed.
//
//go:embed js/still-here.js
var stillHereScript string

// ConfirmStillHere installs an observer in every Slack page that hides and
// answers Slack's "Are you still there?" huddle prompt as soon as it appears.
// It returns how many prompts were answered since the previous call.
func ConfirmStillHere(ctx context.Context, browser *Browser) (int, error) {
	pages, err := browser.Pages(ctx)
	if err != nil {
		return 0, err
	}

	total := 0
	for _, page := range pages {
		// Slack replaces the document on reload, so the observer is
		// reinstalled on every poll; the script only reports while its
		// observer is still attached.
		var confirmed int
		if err := page.Evaluate(ctx, stillHereScript, &confirmed); err != nil {
			if page.Closed() {
				continue
			}
			return total, err
		}
		total += confirmed
	}
	return total, nil
}
