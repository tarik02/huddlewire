package slack

import (
	"context"
	_ "embed"
	"errors"
	"strings"
	"time"
)

//go:embed js/sticker.js
var stickerHelpers string

func stickerHelper(name string) string {
	return "(" + stickerHelpers + ")." + name
}

const (
	stickerButtonSelector = `button[class*="stickerButton"][aria-label]`
	stickerPickerSelector = `button[data-qa="huddle-toolbar-sticker-picker-popover-button"]`
)

// SetSticker shows one of SelectableStickers on the user's huddle tile.
func SetSticker(ctx context.Context, browser *Browser, sticker string) (string, error) {
	option := ""
	for _, candidate := range SelectableStickers {
		if strings.EqualFold(candidate, sticker) {
			option = candidate
			break
		}
	}
	if option == "" {
		return "unknown_sticker", nil
	}

	pages, err := readPages(ctx, browser)
	if err != nil {
		return "", err
	}
	target := find(pages, hasStickerPicker, hasStickerButton, inHuddle)
	if target == nil || !target.status.InHuddle {
		return ActionNotInHuddle, nil
	}
	if !target.status.HasStickerButton {
		return "sticker_button_missing", nil
	}

	page := target.page
	current := ""
	if target.status.StickerLabel != nil {
		current = *target.status.StickerLabel
	}

	// The sticker button removes the current sticker, or repeats the last one
	// when no sticker is shown.
	if option == NoSticker {
		if current == "" {
			return ActionAlreadySet, nil
		}
		if err := page.Click(ctx, stickerButtonSelector); err != nil {
			return "", err
		}
		return waitForSticker(ctx, page, "", "sticker_clear_failed")
	}
	if current == option {
		return ActionAlreadySet, nil
	}
	if target.status.StickerActionLabel != nil && *target.status.StickerActionLabel == option {
		if err := page.Click(ctx, stickerButtonSelector); err != nil {
			return "", err
		}
		return waitForSticker(ctx, page, option, "sticker_option_failed")
	}
	if !target.status.HasStickerPicker {
		return "sticker_picker_missing", nil
	}

	var pickerOpen bool
	if err := page.Call(ctx, stickerHelper("pickerOpen"), &pickerOpen); err != nil {
		return "", err
	}
	if !pickerOpen {
		if err := page.Click(ctx, stickerPickerSelector); err != nil {
			return "", err
		}
	}
	err = page.WaitFor(ctx, 2*time.Second, "(expected) => Boolean("+stickerHelper("optionRect")+"(expected))", option)
	if errors.Is(err, errWaitTimeout) {
		return "sticker_option_missing", nil
	}
	if err != nil {
		return "", err
	}

	var center *point
	if err := page.Call(ctx, stickerHelper("optionRect"), &center, option); err != nil {
		return "", err
	}
	if center == nil {
		return "sticker_option_missing", nil
	}
	if err := page.ClickAt(ctx, center.X, center.Y); err != nil {
		return "", err
	}
	return waitForSticker(ctx, page, option, "sticker_option_failed")
}

func waitForSticker(ctx context.Context, page *Page, expected, failure string) (string, error) {
	err := page.WaitFor(ctx, 3*time.Second, "(expected) => "+stickerHelper("selfSticker")+"() === expected", expected)
	if errors.Is(err, errWaitTimeout) {
		return failure, nil
	}
	if err != nil {
		return "", err
	}
	return ActionChanged, nil
}
