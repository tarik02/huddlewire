({
  selfSticker() {
    const container = document.querySelector(
      '[id^="huddle-grid-gridcell-self_"] .p-huddle_peer_tile__activity_icons_container',
    );
    return container?.textContent?.replaceAll(/\s+/gu, ' ').trim() ?? '';
  },

  pickerOpen() {
    return Boolean(document.querySelector('[data-qa="huddle-sticker-grid"]'));
  },

  optionRect(expected) {
    const option = [...document.querySelectorAll('[data-qa="huddle-sticker-grid"] button')].find(
      (button) => button.textContent?.replaceAll(/\s+/gu, ' ').trim() === expected,
    );
    if (!option) {
      return null;
    }
    const rect = option.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  },
})
