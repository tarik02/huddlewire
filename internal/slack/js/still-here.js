(() => {
  const buttonSelector = 'button[data-qa="huddle_still_here_modal_go"]';
  let state = globalThis.__huddlewireStillHere;

  if (!state) {
    state = { confirmed: 0 };
    const confirm = () => {
      const button = document.querySelector(buttonSelector);
      if (button) {
        button.click();
        state.confirmed += 1;
      }
    };

    // The observer answers the prompt as it renders; hiding it keeps it from
    // flashing for that moment.
    const style = document.createElement('style');
    style.textContent =
      '.c-sk-modal_portal:has([data-qa="huddle_still_here_modal_header"]) { display: none !important; }';
    document.head.append(style);

    state.observer = new MutationObserver(confirm);
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
    globalThis.__huddlewireStillHere = state;
    confirm();
  }

  const confirmed = state.confirmed;
  state.confirmed = 0;
  return confirmed;
})()
