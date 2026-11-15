'use strict';

/*
 * Page de rendu de l'icône : ?size=512&ratio=0.86&small=0
 * Planche de contrôle des humeurs : ?sheet=1&size=1200 (toutes les expressions côte à côte, fond sombre)
 */
(function () {
  const q = new URLSearchParams(location.search);
  const size = Number(q.get('size')) || 512;
  const ratio = Number(q.get('ratio')) || 0.86;
  const stage = document.getElementById('stage');
  const make = (px, mood) => {
    const m = window.StonksMascot.create({ size: px, idle: false, track: false, sleepAfter: 0 });
    m.setAlive(false);
    if (mood) m.setMood(mood);
    return m.el;
  };
  if (q.get('sheet') === '1') {
    document.body.classList.add('sheet');
    const moods = ['idle', ...window.StonksMascot.MOODS];
    const px = Math.floor((size / moods.length) * 0.7);
    for (const mood of moods) stage.append(make(px, mood));
    for (const px2 of [40, 24, 18]) stage.append(make(px2, 'idle'));
    return;
  }
  const el = make(Math.round(size * ratio));
  if (q.get('small') === '1') el.classList.add('is-small');
  const mood = q.get('mood');
  if (mood) for (const m of window.StonksMascot.MOODS) el.classList.toggle(`is-${m}`, m === mood);
  stage.append(el);
})();
