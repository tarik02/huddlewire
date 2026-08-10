import type { Browser } from 'puppeteer-core';

import { readSlackPages, type SlackPageStatus } from './pages.ts';
import { mqttStickerOptions, type SlackStatus } from './types.ts';

function notInHuddleStatus(page: SlackPageStatus | undefined): SlackStatus {
  return {
    huddleState: 'not_in_huddle',
    huddleTitle: page?.status.huddleTitle ?? null,
    inHuddle: false,
    muteLabel: page?.status.muteLabel ?? null,
    muted: false,
    pageUrl: page?.status.url ?? null,
    slackConnected: true,
    source: 'slack-cdp',
    stickerActionEmoji: page?.status.stickerActionEmoji ?? null,
    stickerActionLabel: page?.status.stickerActionLabel ?? null,
    stickerEmoji: page?.status.stickerEmoji ?? null,
    stickerLabel: page?.status.stickerLabel ?? null,
    stickerOptions: mqttStickerOptions,
  };
}

async function readSlackStatus(browser: Browser): Promise<SlackStatus> {
  const pages = await readSlackPages(browser);
  const best =
    pages.find(({ status }) => status.hasMuteButton) ??
    pages.find(({ status }) => status.inHuddle) ??
    pages[0];

  if (best?.status.inHuddle !== true) {
    return notInHuddleStatus(best);
  }

  let huddleState: SlackStatus['huddleState'] = 'unmuted';
  if (best.status.muted === null) {
    huddleState = 'unknown';
  } else if (best.status.muted) {
    huddleState = 'muted';
  }

  return {
    huddleState,
    huddleTitle: best.status.huddleTitle,
    inHuddle: true,
    muteLabel: best.status.muteLabel,
    muted: best.status.muted ?? false,
    pageUrl: best.status.url,
    slackConnected: true,
    source: 'slack-cdp',
    stickerActionEmoji: best.status.stickerActionEmoji,
    stickerActionLabel: best.status.stickerActionLabel,
    stickerEmoji: best.status.stickerEmoji,
    stickerLabel: best.status.stickerLabel,
    stickerOptions: mqttStickerOptions,
  };
}

function offlineStatus(): SlackStatus {
  return {
    huddleState: 'unknown',
    huddleTitle: null,
    inHuddle: false,
    muteLabel: null,
    muted: false,
    pageUrl: null,
    slackConnected: false,
    source: 'slack-cdp',
    stickerActionEmoji: null,
    stickerActionLabel: null,
    stickerEmoji: null,
    stickerLabel: null,
    stickerOptions: mqttStickerOptions,
  };
}

export { offlineStatus, readSlackStatus };
