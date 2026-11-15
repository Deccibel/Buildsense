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
  // planche des accessoires : ?acc=1&size=1600 (chaque proposition en grand, en taille barre latérale, en clair et sombre)
  if (q.get('acc') === '1') {
    document.body.classList.add('sheet', 'acc');
    const variants = [
      ['A · sans accessoire', []],
      ['B · lunettes rondes', ['glasses']],
      ['C · lunettes + nœud papillon', ['glasses', 'bowtie']],
      ['D · lunettes + cravate', ['glasses', 'tie']],
      ['E · demi-lunes + nœud', ['readers', 'bowtie']],
      ['F · toque + lunettes + nœud', ['cap', 'glasses', 'bowtie']],
    ];
    for (const [title, acc] of variants) {
      const card = document.createElement('figure');
      const row = document.createElement('div');
      row.className = 'sizes';
      for (const [px, mood] of [[150, null], [150, 'happy'], [46, null]]) {
        const m = window.StonksMascot.create({ size: px, idle: false, track: false, sleepAfter: 0, accessories: acc });
        m.setAlive(false);
        if (mood) m.setMood(mood);
        row.append(m.el);
      }
      const cap = document.createElement('figcaption');
      cap.textContent = title;
      card.append(row, cap);
      stage.append(card);
    }
    return;
  }
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
