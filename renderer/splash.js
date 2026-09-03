'use strict';

// Optional status label under the mark, passed by the main process
// (e.g. "Bijwerken…" while a silent install runs).
const label = new URLSearchParams(location.search).get('label');
if (label) {
  const el = document.getElementById('label');
  el.textContent = label;
  el.hidden = false;
}
