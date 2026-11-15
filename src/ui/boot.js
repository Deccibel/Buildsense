'use strict';

/*
 * Avant le premier affichage : la couleur d'accent choisie (main.js la passe dans l'adresse de la page).
 * Sans ça, la fenêtre s'ouvrirait une fraction de seconde avec la couleur par défaut.
 */
(function () {
  const accent = new URLSearchParams(location.search).get('accent');
  if (accent) document.documentElement.dataset.accent = accent;
})();
