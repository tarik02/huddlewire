package slack

import (
	"context"
	_ "embed"
	"fmt"
)

// HuddleState summarizes the user's huddle microphone.
type HuddleState string

const (
	HuddleMuted       HuddleState = "muted"
	HuddleUnmuted     HuddleState = "unmuted"
	HuddleNotInHuddle HuddleState = "not_in_huddle"
	HuddleUnknown     HuddleState = "unknown"
)

// NoSticker clears the user's huddle sticker.
const NoSticker = "None"

// StickerOptions are the huddle stickers Slack offers.
var StickerOptions = []string{"Raise hand", "Be right back", "Yes", "No", "Done"}

// SelectableStickers lists every sticker value accepted by SetSticker.
var SelectableStickers = append([]string{NoSticker}, StickerOptions...)

// Status is the huddle state of the Slack page that shows the huddle.
type Status struct {
	SlackConnected     bool        `json:"slackConnected"`
	InHuddle           bool        `json:"inHuddle"`
	Muted              bool        `json:"muted"`
	HuddleState        HuddleState `json:"huddleState"`
	MuteLabel          *string     `json:"muteLabel"`
	HuddleTitle        *string     `json:"huddleTitle"`
	StickerLabel       *string     `json:"stickerLabel"`
	StickerEmoji       *string     `json:"stickerEmoji"`
	StickerActionLabel *string     `json:"stickerActionLabel"`
	StickerActionEmoji *string     `json:"stickerActionEmoji"`
	StickerOptions     []string    `json:"stickerOptions"`
	PageURL            *string     `json:"pageUrl"`
	Source             string      `json:"source"`
}

type pageStatus struct {
	URL                string  `json:"url"`
	InHuddle           bool    `json:"inHuddle"`
	Muted              *bool   `json:"muted"`
	MuteLabel          *string `json:"muteLabel"`
	HuddleTitle        *string `json:"huddleTitle"`
	StickerLabel       *string `json:"stickerLabel"`
	StickerEmoji       *string `json:"stickerEmoji"`
	StickerActionLabel *string `json:"stickerActionLabel"`
	StickerActionEmoji *string `json:"stickerActionEmoji"`
	HasStickerButton   bool    `json:"hasStickerButton"`
	HasStickerPicker   bool    `json:"hasStickerPicker"`
	HasMuteButton      bool    `json:"hasMuteButton"`
}

type pageWithStatus struct {
	page   *Page
	status pageStatus
}

//go:embed js/page-status.js
var pageStatusScript string

func readPages(ctx context.Context, browser *Browser) ([]pageWithStatus, error) {
	pages, err := browser.Pages(ctx)
	if err != nil {
		return nil, err
	}

	result := make([]pageWithStatus, 0, len(pages))
	for _, page := range pages {
		var status pageStatus
		if err := page.Call(ctx, pageStatusScript, &status); err != nil {
			return nil, fmt.Errorf("read Slack page %s: %w", page.URL, err)
		}
		result = append(result, pageWithStatus{page: page, status: status})
	}
	return result, nil
}

// find returns the first page matching each predicate in turn.
func find(pages []pageWithStatus, predicates ...func(pageStatus) bool) *pageWithStatus {
	for _, predicate := range predicates {
		for i := range pages {
			if predicate(pages[i].status) {
				return &pages[i]
			}
		}
	}
	return nil
}

func hasMuteButton(status pageStatus) bool    { return status.HasMuteButton }
func inHuddle(status pageStatus) bool         { return status.InHuddle }
func hasStickerPicker(status pageStatus) bool { return status.HasStickerPicker }
func hasStickerButton(status pageStatus) bool { return status.HasStickerButton }

// ReadStatus reads the huddle state from Slack's pages.
func ReadStatus(ctx context.Context, browser *Browser) (Status, error) {
	pages, err := readPages(ctx, browser)
	if err != nil {
		return Status{}, err
	}

	best := find(pages, hasMuteButton, inHuddle)
	if best == nil && len(pages) > 0 {
		best = &pages[0]
	}
	if best == nil || !best.status.InHuddle {
		return notInHuddleStatus(best), nil
	}

	state := HuddleUnmuted
	if best.status.Muted == nil {
		state = HuddleUnknown
	} else if *best.status.Muted {
		state = HuddleMuted
	}
	return Status{
		SlackConnected:     true,
		InHuddle:           true,
		Muted:              best.status.Muted != nil && *best.status.Muted,
		HuddleState:        state,
		MuteLabel:          best.status.MuteLabel,
		HuddleTitle:        best.status.HuddleTitle,
		StickerLabel:       best.status.StickerLabel,
		StickerEmoji:       best.status.StickerEmoji,
		StickerActionLabel: best.status.StickerActionLabel,
		StickerActionEmoji: best.status.StickerActionEmoji,
		StickerOptions:     SelectableStickers,
		PageURL:            &best.status.URL,
		Source:             "slack-cdp",
	}, nil
}

func notInHuddleStatus(page *pageWithStatus) Status {
	status := Status{
		SlackConnected: true,
		HuddleState:    HuddleNotInHuddle,
		StickerOptions: SelectableStickers,
		Source:         "slack-cdp",
	}
	if page != nil {
		status.MuteLabel = page.status.MuteLabel
		status.HuddleTitle = page.status.HuddleTitle
		status.StickerLabel = page.status.StickerLabel
		status.StickerEmoji = page.status.StickerEmoji
		status.StickerActionLabel = page.status.StickerActionLabel
		status.StickerActionEmoji = page.status.StickerActionEmoji
		status.PageURL = &page.status.URL
	}
	return status
}

// OfflineStatus describes Slack when its DevTools endpoint is unreachable.
func OfflineStatus() Status {
	return Status{
		HuddleState:    HuddleUnknown,
		StickerOptions: SelectableStickers,
		Source:         "slack-cdp",
	}
}
