(() => {
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
    Promise.resolve(globalThis.__huddlewireReportMuteState?.(muted)).catch(() => undefined);
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
})()
