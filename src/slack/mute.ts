import type { Browser, Page } from 'puppeteer-core';

import formatError from '../errors.ts';
import { getSlackPages } from './client.ts';
import { readSlackPages } from './pages.ts';

const muteStateObserverScript = `(() => {
  if (globalThis.__huddlewireMuteStateObserver) {
    return;
  }

  let lastMuted = null;
  const readMuted = () => {
    const button = document.querySelector('button[data-qa="segmented-mute-button-main"]');
    const label = (button?.getAttribute('aria-label') || button?.getAttribute('title') || '').toLowerCase();
    if (label.includes('unmute')) {
      return true;
    }
    if (label.includes('mute')) {
      return false;
    }
    return null;
  };
  const report = () => {
    const muted = readMuted();
    if (muted === null || muted === lastMuted) {
      return;
    }
    lastMuted = muted;
    Promise.resolve(globalThis.__huddlewireReportMuteState(muted)).catch(() => undefined);
  };

  const observer = new MutationObserver(report);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['aria-label', 'title', 'data-qa'],
    characterData: true,
    childList: true,
    subtree: true,
  });
  globalThis.__huddlewireMuteStateObserver = observer;
  report();
})()`;

async function setSlackMuted(browser: Browser, muted: boolean | 'toggle') {
  const pages = await readSlackPages(browser);
  const target =
    pages.find(({ status }) => status.hasMuteButton) ?? pages.find(({ status }) => status.inHuddle);

  if (target?.status.inHuddle !== true) {
    return 'not_in_huddle';
  }
  if (!target.status.hasMuteButton) {
    return 'mute_button_missing';
  }
  if (muted !== 'toggle' && target.status.muted === muted) {
    return 'already_set';
  }

  await target.page.evaluate(() => {
    document.querySelector<HTMLElement>('button[data-qa="segmented-mute-button-main"]')?.click();
  });
  return 'changed';
}

async function installMuteStateObservers({
  browser,
  observedPages,
  onMuteState,
}: {
  browser: Browser;
  observedPages: WeakSet<Page>;
  onMuteState: (muted: boolean) => void;
}) {
  const pages = await getSlackPages(browser);
  await Promise.all(
    pages.map(async (page) => {
      try {
        if (!observedPages.has(page)) {
          await page.exposeFunction('__huddlewireReportMuteState', (muted: unknown) => {
            if (typeof muted === 'boolean') {
              onMuteState(muted);
            }
          });
          observedPages.add(page);
        }
        await page.evaluate(muteStateObserverScript);
      } catch (error) {
        if (!page.isClosed()) {
          console.error('failed to install Slack mute observer:', formatError(error));
        }
      }
    }),
  );
}

export { installMuteStateObservers, setSlackMuted };
