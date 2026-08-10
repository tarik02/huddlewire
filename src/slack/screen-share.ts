import type { Browser, Page } from 'puppeteer-core';

const nativeScreenSharePatchScript = `(() => {
  const patchKey = '__slackWaylandNativeScreenSharePatch';
  const patchVersion = 8;
  const previousPatch = globalThis[patchKey];
  if (previousPatch?.installed && previousPatch.version === patchVersion) {
    return previousPatch.lastStatus || 'already_installed';
  }
  if (previousPatch?.onClick) {
    document.removeEventListener('click', previousPatch.onClick, true);
  }
  const rspackHost = Array.isArray(globalThis.rspackChunkwebapp)
    ? globalThis
    : window.opener && Array.isArray(window.opener.rspackChunkwebapp)
      ? window.opener
      : null;
  if (!rspackHost) {
    return 'rspack_unavailable';
  }

  let rspackRequire = null;
  rspackHost.rspackChunkwebapp.push([
    ['slack-wayland-native-screen-share-' + Date.now() + '-' + Math.random().toString(36).slice(2)],
    {},
    (runtimeRequire) => {
      rspackRequire = runtimeRequire;
    },
  ]);
  if (!rspackRequire) {
    return 'runtime_unavailable';
  }

  const screenShareDescription = 'Start or stop screen share for current user with given mediaSourceId';
  const knownSelector = [
    'button[data-qa="huddle_screen_share_button"]',
    'button[data-qa="huddle_toolbar_screenshare_button"]',
  ].join(',');
  let startScreenShare = null;
  let stopScreenShare = null;
  let updatePeer = null;
  let clientDispatch = null;
  let store = null;

  const patchState = {
    installed: true,
    version: patchVersion,
    onClick: null,
    sequence: 0,
    lastStatus: 'installed',
  };

  const normalize = (value) => value?.replace(/\\s+/g, ' ').trim().toLowerCase() || '';
  const isScreenShareControl = (control) => {
    if (control.matches(knownSelector)) {
      return true;
    }

    const labels = [
      control.getAttribute('aria-label'),
      control.getAttribute('title'),
      control.textContent,
    ].map(normalize);
    return labels.some((label) =>
      label === 'share screen' ||
      label === 'share your screen' ||
      label === 'start sharing your screen' ||
      label === 'stop sharing' ||
      label === 'stop sharing screen' ||
      label === 'stop sharing your screen'
    );
  };

  const resolveSlackInternals = () => {
    if (startScreenShare && stopScreenShare && updatePeer && clientDispatch && store) {
      return true;
    }

    // Requiring the toggle thunk loads the lower-level actions we need. The
    // thunk itself cannot be used because Slack's desktop environment state
    // sometimes reports isWayland as undefined and enters its custom picker.
    const toggleModuleId = Object.keys(rspackRequire.m).find((moduleId) => {
      const factory = rspackRequire.m[moduleId];
      return typeof factory === 'function' &&
        Function.prototype.toString.call(factory).includes(screenShareDescription);
    });
    if (toggleModuleId) {
      rspackRequire(toggleModuleId);
    }

    const exportedFunctions = Object.values(rspackRequire.c).flatMap((module) => {
      try {
        return module?.exports ? Object.values(module.exports) : [];
      } catch {
        return [];
      }
    }).filter((value) => typeof value === 'function');
    const actionWithDescription = (description) => exportedFunctions.find(
      (value) => value.meta?.description === description,
    );
    const teamStoreModule = Object.values(rspackRequire.c)
      .map((module) => module?.exports)
      .find((exports) =>
        exports &&
        typeof exports.oK === 'function' &&
        typeof exports.$D === 'function'
      );
    const clientStoreModule = Object.values(rspackRequire.c)
      .map((module) => module?.exports)
      .find((exports) =>
        exports &&
        typeof exports.dispatchForClientStore === 'function' &&
        typeof exports.Ry === 'function'
      );
    const teamPath = window.location.pathname.startsWith('/client/')
      ? window.location.pathname
      : rspackHost.location.pathname;
    const teamId = teamPath.split('/')[2];

    startScreenShare = actionWithDescription(
      'Start screen share for current user with given mediaSourceId',
    ) || null;
    stopScreenShare = actionWithDescription('Stop screen share for current user') || null;
    updatePeer = actionWithDescription('Update a peer') || null;
    clientDispatch = clientStoreModule?.dispatchForClientStore ?? null;
    store = teamId ? teamStoreModule?.oK?.(teamId) ?? null : null;
    return Boolean(
      startScreenShare && stopScreenShare && updatePeer && clientDispatch && store?.dispatch,
    );
  };

  const onClick = (event) => {
    const target = event.target;
    const control = target instanceof Element
      ? target.closest('button,[role="button"],[role="menuitem"],[role="menuitemcheckbox"]')
      : null;
    if (
      !control ||
      !isScreenShareControl(control) ||
      control.disabled ||
      control.getAttribute('aria-disabled') === 'true'
    ) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    const label = normalize(
      control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent,
    );
    patchState.sequence += 1;
    if (!resolveSlackInternals()) {
      patchState.lastStatus = 'intercepted:' + patchState.sequence + ':internals_unavailable:' + label;
      return;
    }

    const stopping = label.startsWith('stop ');
    patchState.lastStatus = 'intercepted:' + patchState.sequence + ':dispatching:' + label;
    Promise.resolve().then(() => {
      if (stopping) {
        clientDispatch(stopScreenShare());
        store.dispatch(updatePeer({
          id: 'self',
          screens: [],
          thumbnailIndex: 0,
          isDrawEnabled: false,
        }));
      } else {
        clientDispatch(startScreenShare());
        store.dispatch(updatePeer({
          id: 'self',
          isScreenshareEnabled: true,
          screens: [],
          thumbnailIndex: 0,
          isDrawEnabled: false,
        }));
      }
    }).then(
      () => {
        patchState.lastStatus = 'intercepted:' + patchState.sequence + ':resolved:' + label;
      },
      (error) => {
        patchState.lastStatus = 'intercepted:' + patchState.sequence + ':failed:' +
          (error?.message || String(error));
        console.error('[huddlewire] native screen-share action failed', error);
      },
    );
  };

  document.addEventListener('click', onClick, true);
  patchState.onClick = onClick;
  globalThis[patchKey] = patchState;
  return 'installed';
})()`;

export default async function patchNativeScreenShare(browser: Browser) {
  const pages = await browser.pages();
  const slackPages: Array<{ page: Page; diagnosticUrl: string }> = [];
  for (const [pageIndex, page] of pages.entries()) {
    if (page.url().startsWith('https://app.slack.com/client/')) {
      slackPages.push({ diagnosticUrl: `${page.url()} [page ${pageIndex}]`, page });
    } else if (page.url() === 'about:blank') {
      slackPages.push({ diagnosticUrl: `about:blank [page ${pageIndex}]`, page });
    }
  }

  return Promise.all(
    slackPages.map(async ({ page, diagnosticUrl }) => {
      try {
        return {
          status: String(await page.evaluate(nativeScreenSharePatchScript)),
          url: diagnosticUrl,
        };
      } catch (error) {
        let message = String(error);
        if (error instanceof Error) {
          message = error.message;
        }
        return {
          status: `error: ${message}`,
          url: diagnosticUrl,
        };
      }
    }),
  );
}
