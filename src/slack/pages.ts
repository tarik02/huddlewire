import type { Browser, Page } from 'puppeteer-core';

import { getSlackPages } from './client.ts';
import type { PageStatus } from './types.ts';

type SlackPageStatus = {
  page: Page;
  status: PageStatus;
};

function readPageStatus(page: Page): Promise<PageStatus> {
  return page.evaluate(() => {
    const normalizedText = (value: string | null | undefined) => {
      const normalized = value?.replaceAll(/\s+/gu, ' ').trim();
      if (normalized === undefined || normalized === '') {
        return null;
      }
      return normalized;
    };
    const accessibleLabel = (element: Element | null) => {
      const ariaLabel = element?.getAttribute('aria-label');
      if (ariaLabel !== null && ariaLabel !== undefined && ariaLabel !== '') {
        return ariaLabel;
      }
      const title = element?.getAttribute('title');
      if (title !== null && title !== undefined && title !== '') {
        return title;
      }
      return normalizedText(element?.textContent);
    };

    const muteButton = document.querySelector('button[data-qa="segmented-mute-button-main"]');
    const muteLabel = accessibleLabel(muteButton);
    const stickerButton = document.querySelector('button[class*="stickerButton"][aria-label]');
    const stickerActionLabel = accessibleLabel(stickerButton);
    const stickerActionEmoji =
      stickerButton?.querySelector<HTMLElement>('[data-qa="emoji"]')?.dataset['stringifyEmoji'] ??
      stickerButton?.querySelector('[data-qa="emoji"]')?.getAttribute('aria-label') ??
      null;
    const stickerContainer = document.querySelector(
      '[id^="huddle-grid-gridcell-self_"] .p-huddle_peer_tile__activity_icons_container',
    );
    const stickerLabel = normalizedText(stickerContainer?.textContent);
    const stickerEmoji =
      stickerContainer?.querySelector<HTMLElement>('[data-qa="emoji"]')?.dataset[
        'stringifyEmoji'
      ] ??
      stickerContainer?.querySelector('[data-qa="emoji"]')?.getAttribute('aria-label') ??
      null;
    const normalizedMuteLabel = muteLabel?.toLowerCase() ?? null;
    const toolbar =
      document.querySelector('[data-qa="huddle_toolbar_buttons_center"]') ??
      document.querySelector('[aria-label="Huddles actions"]');
    const toolbarMicIcon =
      toolbar?.querySelector<HTMLElement>('[data-qa^="huddle_mic_icon_"]')?.dataset['qa'] ?? null;
    const huddleTitleElement =
      document.querySelector('[data-qa="huddle_window_titlebar_title"]') ??
      document.querySelector('[data-qa="huddle_details_title"]');
    const huddleTitle = normalizedText(huddleTitleElement?.textContent);

    let muted: boolean | null = null;
    if (normalizedMuteLabel?.includes('unmute') === true) {
      muted = true;
    } else if (normalizedMuteLabel?.includes('mute') === true) {
      muted = false;
    } else if (toolbarMicIcon?.includes('_unmute') === true) {
      muted = true;
    } else if (toolbarMicIcon?.includes('_mute') === true) {
      muted = false;
    }

    return {
      hasMuteButton: Boolean(muteButton),
      hasStickerButton: Boolean(stickerButton),
      hasStickerPicker: Boolean(
        document.querySelector('button[data-qa="huddle-toolbar-sticker-picker-popover-button"]'),
      ),
      huddleTitle,
      inHuddle: Boolean(
        muteButton ??
        document.querySelector('button[data-qa="huddle_toolbar__leave_button"]') ??
        document.querySelector('[data-qa="huddle_grid_component"]') ??
        document.querySelector('[data-qa="huddle_bottom_bar_content"]'),
      ),
      muteLabel,
      muted,
      stickerActionEmoji,
      stickerActionLabel,
      stickerEmoji,
      stickerLabel,
      url: location.href,
    } satisfies PageStatus;
  });
}

async function readSlackPages(browser: Browser): Promise<SlackPageStatus[]> {
  return Promise.all(
    (await getSlackPages(browser)).map(async (page) => ({
      page,
      status: await readPageStatus(page),
    })),
  );
}

export { readPageStatus, readSlackPages, type SlackPageStatus };
