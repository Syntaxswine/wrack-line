// Everything here is a convenience, and the page is complete without it: the
// plates, the notes, and every link are in the HTML already. Nothing is stored,
// counted, or sent anywhere.

const answer = document.querySelector('#answer');
const pass = document.querySelector('#pass');

pass?.addEventListener('click', () => {
  if (answer) answer.textContent = 'PASS ACCEPTED. THE LINE KEEPS NOTHING OF YOU.';
});

const finds = document.querySelector('#finds');
const sift = document.querySelector('#sift');
const plates = finds ? [...finds.querySelectorAll('.find')] : [];

if (sift && plates.length > 1) {
  const text = sift.querySelector('#sift-text');
  const kind = sift.querySelector('#sift-kind');
  const status = sift.querySelector('#sift-status');
  const order = sift.querySelector('#sift-order');
  const count = sift.querySelector('#sift-count');
  sift.hidden = false;

  const apply = () => {
    const query = text.value.trim().toLowerCase();
    let showing = 0;
    for (const plate of plates) {
      const matches = (!kind.value || plate.dataset.kind === kind.value)
        && (!status.value || plate.dataset.status === status.value)
        && (!query || plate.textContent.toLowerCase().includes(query));
      plate.hidden = !matches;
      if (matches) showing += 1;
    }
    count.textContent = showing === plates.length
      ? `${plates.length} PLATE${plates.length === 1 ? '' : 'S'}`
      : `SHOWING ${showing} OF ${plates.length}`;
  };

  text.addEventListener('input', apply);
  kind.addEventListener('change', apply);
  status.addEventListener('change', apply);

  order.addEventListener('click', () => {
    const oldestFirst = order.getAttribute('aria-pressed') !== 'true';
    order.setAttribute('aria-pressed', String(oldestFirst));
    order.textContent = oldestFirst ? 'NEWEST FIRST' : 'OLDEST FIRST';
    for (const plate of oldestFirst ? [...plates].reverse() : plates) finds.append(plate);
  });

  apply();
}

// The prefilled entry on GitHub carries today's date for "left", since that is the
// one field only the moment of leaving can fill.
const prefilled = document.querySelector('#prefilled');

if (prefilled) {
  try {
    const url = new URL(prefilled.href);
    const value = url.searchParams.get('value');
    if (value) {
      const today = new Date().toISOString().slice(0, 10);
      url.searchParams.set('value', value.replace(/^left: YYYY-MM-DD$/m, `left: ${today}`));
      prefilled.href = url.toString();
    }
  } catch {
    // The static link still works; a stamped date is only a courtesy.
  }
}
