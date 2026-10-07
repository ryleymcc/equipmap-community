let updatePending = false;

export function deferPwaUpdate() {
  if (updatePending) return;

  updatePending = true;
  console.log('New app version ready; update deferred until the next page transition.');
}

export function consumeDeferredPwaUpdate() {
  if (!updatePending) return false;

  updatePending = false;
  return true;
}
