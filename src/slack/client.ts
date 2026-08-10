import { type Browser, connect } from 'puppeteer-core';

function connectSlack(slackCdpUrl: string) {
  return connect({
    browserURL: slackCdpUrl,
    defaultViewport: null,
  });
}

async function getSlackPages(browser: Browser) {
  return (await browser.pages()).filter(
    (page) =>
      page.url().startsWith('https://app.slack.com/client/') || page.url() === 'about:blank',
  );
}

export { connectSlack, getSlackPages };
