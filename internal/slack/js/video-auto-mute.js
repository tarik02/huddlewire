(() => {
  // Slack mutes the microphone while a video plays in the huddle and unmutes
  // it when the video ends. Both go through the setSelfMicrophone thunk, whose
  // arguments Slack's thunk creator exposes as payload.
  const autoMuteSources = new Set(['VideoPlaybackAutoMute', 'VideoPlaybackAutoUnmute']);
  const patched = Symbol.for('huddlewire.videoAutoMute');

  // The auto-mute dispatches a "muted" coachmark right before the thunk;
  // closing it again keeps the dropped mute invisible.
  let coachmarkType = null;

  const wrap = (store) => {
    const dispatch = store.dispatch;
    store.dispatch = function (action) {
      if (typeof action === 'function' && autoMuteSources.has(action.payload?.source)) {
        if (coachmarkType !== null) {
          dispatch.call(this, { type: coachmarkType, payload: { isMutedCoachmarkOpen: false }, error: false });
        }
        return undefined;
      }
      if (action?.payload?.isMutedCoachmarkOpen === true) {
        coachmarkType = action.type;
      }
      return dispatch.apply(this, arguments);
    };
    store[patched] = true;
  };

  // Slack renders the huddle window from the main window's React, with a
  // react-redux Provider per subtree, so every Provider's store is wrapped.
  // useDispatch reads store.dispatch on each render.
  let wrapped = 0;
  for (const element of document.querySelectorAll('*')) {
    const containerKey = Object.keys(element).find((key) => key.startsWith('__reactContainer$'));
    if (containerKey === undefined) {
      continue;
    }
    const fibers = [element[containerKey]];
    while (fibers.length > 0) {
      const fiber = fibers.pop();
      const store = fiber.memoizedProps?.store;
      if (typeof store?.dispatch === 'function' && typeof store.getState === 'function' && !store[patched]) {
        wrap(store);
        wrapped += 1;
      }
      if (fiber.child) {
        fibers.push(fiber.child);
      }
      if (fiber.sibling) {
        fibers.push(fiber.sibling);
      }
    }
  }
  return wrapped;
})()
