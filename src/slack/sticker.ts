import type { Browser } from 'puppeteer-core';

import { readSlackPages } from './pages.ts';
import { noStickerOption, stickerOptions } from './types.ts';

export default async function setSlackSticker(browser: Browser, sticker: string) {
  let stickerOption: (typeof stickerOptions)[number] | typeof noStickerOption | undefined;
  if (sticker.toLowerCase() === noStickerOption.toLowerCase()) {
    stickerOption = noStickerOption;
  } else {
    stickerOption = stickerOptions.find((option) => option.toLowerCase() === sticker.toLowerCase());
  }
  if (stickerOption === undefined) {
    return 'unknown_sticker';
  }

  const pages = await readSlackPages(browser);
  const target =
    pages.find(({ status }) => status.hasStickerPicker) ??
    pages.find(({ status }) => status.hasStickerButton) ??
    pages.find(({ status }) => status.inHuddle);

  if (target?.status.inHuddle !== true) {
    return 'not_in_huddle';
  }
  if (!target.status.hasStickerButton) {
    return 'sticker_button_missing';
  }
  if (stickerOption === noStickerOption) {
    if (target.status.stickerLabel === null || target.status.stickerLabel === '') {
      return 'already_set';
    }

    await target.page.click('button[class*="stickerButton"][aria-label]');
    try {
      await target.page.waitForFunction(
        `(() => {
          const stickerContainer = document.querySelector(
            '[id^="huddle-grid-gridcell-self_"] .p-huddle_peer_tile__activity_icons_container',
          );
          return !stickerContainer?.textContent?.replace(/\\s+/gu, ' ').trim();
        })`,
        { timeout: 3000 },
      );
      return 'changed';
    } catch {
      return 'sticker_clear_failed';
    }
  }
  if (target.status.stickerLabel === stickerOption) {
    return 'already_set';
  }
  if (target.status.stickerActionLabel === stickerOption) {
    await target.page.click('button[class*="stickerButton"][aria-label]');
    try {
      await target.page.waitForFunction(
        (expectedSticker: string) => {
          const stickerContainer = document.querySelector(
            '[id^="huddle-grid-gridcell-self_"] .p-huddle_peer_tile__activity_icons_container',
          );
          return stickerContainer?.textContent?.replaceAll(/\s+/gu, ' ').trim() === expectedSticker;
        },
        { timeout: 3000 },
        stickerOption,
      );
      return 'changed';
    } catch {
      return 'sticker_option_failed';
    }
  }
  if (!target.status.hasStickerPicker) {
    return 'sticker_picker_missing';
  }

  const pickerOpen = await target.page.evaluate(() =>
    Boolean(document.querySelector('[data-qa="huddle-sticker-grid"]')),
  );
  if (!pickerOpen) {
    await target.page.click('button[data-qa="huddle-toolbar-sticker-picker-popover-button"]');
  }
  try {
    await target.page.waitForFunction(
      (expectedSticker: string) =>
        [...document.querySelectorAll('[data-qa="huddle-sticker-grid"] button')].some(
          (button) => button.textContent?.replaceAll(/\s+/gu, ' ').trim() === expectedSticker,
        ),
      { timeout: 2000 },
      stickerOption,
    );
  } catch {
    return 'sticker_option_missing';
  }

  const stickerButtonRect = await target.page.evaluate((expectedSticker: string) => {
    const stickerButton = [
      ...document.querySelectorAll('[data-qa="huddle-sticker-grid"] button'),
    ].find((button) => button.textContent?.replaceAll(/\s+/gu, ' ').trim() === expectedSticker);
    if (!stickerButton) {
      return null;
    }

    const rect = stickerButton.getBoundingClientRect();
    return { height: rect.height, width: rect.width, x: rect.x, y: rect.y };
  }, stickerOption);
  if (!stickerButtonRect) {
    return 'sticker_option_missing';
  }

  await target.page.mouse.click(
    stickerButtonRect.x + stickerButtonRect.width / 2,
    stickerButtonRect.y + stickerButtonRect.height / 2,
  );
  try {
    await target.page.waitForFunction(
      (expectedSticker: string) => {
        const stickerContainer = document.querySelector(
          '[id^="huddle-grid-gridcell-self_"] .p-huddle_peer_tile__activity_icons_container',
        );
        return stickerContainer?.textContent?.replaceAll(/\s+/gu, ' ').trim() === expectedSticker;
      },
      { timeout: 3000 },
      stickerOption,
    );
    return 'changed';
  } catch {
    return 'sticker_option_failed';
  }
}
