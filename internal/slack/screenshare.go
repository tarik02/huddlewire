package slack

import (
	"context"
	_ "embed"
	"fmt"
)

//go:embed js/native-screen-share.js
var nativeScreenShareScript string

// PatchResult is the screen-share patch outcome for one page.
type PatchResult struct {
	Page   string
	Status string
}

// PatchNativeScreenShare makes Slack's screen-share buttons start sharing
// directly, so the desktop portal picks the source instead of Slack's own
// picker, which fails on Wayland.
func PatchNativeScreenShare(ctx context.Context, browser *Browser) ([]PatchResult, error) {
	pages, err := browser.Pages(ctx)
	if err != nil {
		return nil, err
	}

	results := make([]PatchResult, 0, len(pages))
	for i, page := range pages {
		result := PatchResult{Page: fmt.Sprintf("%s [page %d]", page.URL, i)}
		var status string
		if err := page.Evaluate(ctx, nativeScreenShareScript, &status); err != nil {
			result.Status = "error: " + err.Error()
		} else {
			result.Status = status
		}
		results = append(results, result)
	}
	return results, nil
}
