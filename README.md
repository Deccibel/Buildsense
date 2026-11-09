# BuildSense

Overlay de builds pour League of Legends. BuildSense récupère les builds des meilleurs joueurs de ta région (Faille de l'invocateur classée Challenger/Grand Maître, ARAM, ARAM Mayhem, Arena). Il lit ensuite ta sélection et ta partie en direct pour adapter ses conseils : objets, bottes, runes et sorts, selon le mode, ton poste et ce qui se passe en face.

## Installation (Windows)

1. Lance **`BuildSense-Setup-1.5.0.exe`**. Si une version précédente est installée, elle est mise à jour et tes réglages sont conservés.
2. Windows affiche sûrement « Windows a protégé votre ordinateur ». C'est normal, l'exe n'est pas signé. Clique sur **Informations complémentaires**, puis **Exécuter quand même**.
3. L'installation se fait dans ton dossier utilisateur, sans droits administrateur, avec un raccourci sur le bureau et dans le menu Démarrer. Coche **Lancer BuildSense** à la fin.

Au premier lancement, BuildSense télécharge les données du jeu et les icônes (objets, champions, runes, sorts) depuis Data Dragon, le service officiel de Riot. Ça représente quelques Mo, gardés en cache et remis à jour à chaque patch.

Pour désinstaller : Paramètres Windows › Applications › BuildSense, ou « Désinstaller BuildSense » dans le menu Démarrer. Tes réglages et tes builds restent dans `%APPDATA%\BuildSense` : supprime ce dossier si tu veux tout effacer.

## Mises à jour

À partir de la 1.3.0, tu n'as plus à retélécharger d'exe :

1. BuildSense vérifie s'il existe une nouvelle version au lancement, puis toutes les 4 h.
2. Il la télécharge en fond. Jamais pendant une sélection ou une partie : un téléchargement commencé s'arrête dès qu'une partie démarre et reprend après.
3. Une carte « BuildSense x.y.z est prête » apparaît sur l'accueil (et dans le menu de l'icône près de l'horloge). Clique sur **Redémarrer et mettre à jour** : l'installation se fait sans fenêtre, en moins d'une minute, puis BuildSense se relance.
4. Au redémarrage, une carte « Quoi de neuf » liste les nouveautés.

Avant d'être installé, le fichier téléchargé est vérifié : sa taille et son empreinte SHA-256 doivent correspondre à celles publiées. Sinon, il est supprimé.

Les versions sont publiées sur les « Releases » du dépôt GitHub `Deccibel/buildsense`. Tu peux changer de dépôt dans Réglages › Mises à jour, et couper le téléchargement automatique au même endroit (il reste le bouton « Vérifier maintenant »).

## Configuration (5 minutes)

L'onglet **Accueil** affiche une liste « Pour bien démarrer » :

1. **Clé API Riot** (onglet Réglages)
   - Va sur https://developer.riotgames.com et connecte-toi avec ton compte Riot.
   - Copie la *Development API Key* (elle commence par `RGAPI-`).
   - Colle-la dans BuildSense, puis clique sur **Enregistrer** et **Tester la clé**.
   - Cette clé expire toutes les 24 h. Pour ne plus avoir à la recoller, demande une *Personal API Key* sur le même portail (« Register Product » › Personal).
2. **Mes champions** : clique sur les champions que tu joues. Leurs builds sont collectés en priorité.
3. **Dans LoL** : Options › Vidéo › Mode fenêtre › **Fenêtré sans bordure**. En plein écran exclusif, aucun overlay ne peut s'afficher par-dessus le jeu.
4. Laisse la collecte tourner. Avec une clé de développement, compte environ 1 000 parties par heure, réparties entre les modes.

Dans l'onglet **Overlay**, « Aperçu en partie », « Aperçu ARAM » et « Aperçu sélection » affichent des parties de démonstration. Tu peux alors placer l'overlay avec « Déplacer l'overlay » et régler son opacité et sa taille.

## Modes de jeu

| Mode | Données utilisées | Particularités |
|---|---|---|
| Classée, Swiftplay, normale, Entraînement | Classées solo/duo des Challenger et Grand Maître | Poste, adversaire direct, runes |
| ARAM | Parties ARAM des joueurs Chall/GM, puis de leurs adversaires | Objets et sorts propres à l'ARAM (Marque), pas de poste |
| ARAM Mayhem | Parties Mayhem quand le mode tourne, sinon données ARAM | Pas de runes (augments) |
| Arena | Parties Arena quand le mode est disponible | Objets Arena, pas de runes ni d'analyse d'équipe |
| URF, Un pour tous, autres modes de la Faille | Builds de la Faille classée | Signalé dans l'overlay |

Le mode auquel tu joues est collecté en priorité. Dans Réglages, tu peux désactiver la collecte d'un mode. Les modes temporaires (Mayhem, Arena) sont mis en pause tout seuls quand ils ne sont plus dans la rotation. Arène des essaims et TFT ne sont pas gérés (pas de boutique d'objets).

## Ton poste (Shen support, Akali support…)

BuildSense choisit le poste dans cet ordre :

1. **Le poste choisi pour la partie** : `Ctrl+Maj+P` passe au poste suivant (Top › Jungle › Mid › Bot › Support › automatique). Tu peux aussi le choisir sur la page **En direct**. Ça sert par exemple quand vous échangez vos lignes.
2. **Le poste donné par le client** (classée, normale draft, Swiftplay).
3. **Ton poste préféré** pour ce champion (onglet Mes champions › Postes préférés). Il sert quand le client ne donne pas de poste, comme en partie à l'aveugle ou dans les modes spéciaux.
4. Sinon, le poste le plus joué par les Chall/GM sur ce champion.

Quand un champion est rarement joué à ce poste, il y a peu de parties dans la base (Akali support, par exemple). BuildSense garde alors le build du champion sur ses autres postes : tu as bien un allié qui fait des dégâts. Le départ et les sorts restent ceux du poste (objet de support, Châtiment en jungle). L'overlay le signale.

## Runes automatiques

Pendant la sélection, dès que tu **verrouilles** ton champion, BuildSense applique la page de runes conseillée pour ton champion, ton poste et le mode. Elle **remplace ta page active** : aucune page n'est créée ni supprimée. Si la page active n'est pas modifiable (page prédéfinie), BuildSense utilise sa propre page.

- Si tu changes de poste ou de champion, la nouvelle page est appliquée.
- Si tu retouches la page à la main, BuildSense n'y touche plus pendant cette sélection.
- `Ctrl+Maj+R` (ré)applique la page à tout moment.
- Pour désactiver : Réglages › Sélection des champions › Runes automatiques.

## Ce que montre l'overlay

**Pendant la sélection des champions**
- Les champions adverses déjà choisis, et ton adversaire direct.
- La page de runes la plus jouée sur ton champion, à ton poste et dans ce mode. Si la base contient au moins 8 parties contre ton adversaire direct, la page est calculée uniquement sur ce face-à-face.
- Les sorts d'invocateur, les objets de départ, le build type et l'ordre des compétences.
- L'état des runes automatiques.

**En partie** (mis à jour chaque seconde)
- **Le départ** (tant que rien n'est acheté) : les départs les plus joués, le meilleur encadré avec « ★ Meilleur choix ». Dans la boutique, la page d'objets « BuildSense » (onglet Recommandés) les reprend dans le même ordre.
- **L'équipe adverse** : portrait, niveau, KDA, type de dégâts, ennemis *fed* signalés, et la répartition dégâts physiques / magiques.
- **Le prochain objet** : 2 ou 3 options avec leur raison, qui peut venir de la partie (« Zed est fed », « anti-soins : Aatrox et Soraka ») ou des données (« 41 % des Chall/GM dans une partie similaire »).
- **L'achat possible maintenant** : une barre de progression vers l'objet, et les composants à acheter avec ton or. Ceux que tu possèdes déjà sont déduits.
- Les bottes conseillées, les points à surveiller (soins, contrôles, tanks…), le build type avec tes objets cochés et l'ordre des compétences.

Au début de chaque partie, l'overlay réapparaît (même si tu l'avais masqué) et repasse au premier plan, au-dessus du jeu.

**Comment le build s'adapte.** Chaque partie de la base est pondérée selon sa ressemblance avec la tienne : compo adverse, adversaire direct et patch. L'outil regarde aussi ce que les meilleurs joueurs ont construit après les objets que tu as déjà. Il ajoute ensuite des bonus situationnels, par exemple anti-soins, stase contre un assassin fed, ou pénétration contre des tanks. Seuls les objets disponibles dans le mode joué sont proposés.

## Page « En direct » (second écran)

La fenêtre principale a une page **En direct**. Elle affiche ta sélection et ta partie en grand : prochain objet et ses raisons, achat possible, équipe adverse, alertes, build type, runes, sorts, et le choix du poste. Mets-la sur ton second écran.

Elle s'ouvre toute seule au début de chaque sélection, sans prendre le focus : ton jeu reste au premier plan. Tu peux désactiver ce comportement en bas de la page.

## Apparence

Réglages › Apparence : thème **Automatique** (suit Windows), **Clair** ou **Sombre**, et une couleur d'accent (cyan, rouge, vert, jaune, orange, mauve, bleu) ou **Classique LoL** (or et bleu nuit du jeu). L'overlay suit le même style.

## Langue

Par défaut, les noms des objets, champions et runes sont dans la langue de ton client LoL (Réglages › Langue des noms › Automatique). Tu peux aussi forcer le français ou l'anglais. Les textes s'adaptent à la longueur des noms : rien n'est coupé, ils passent à la ligne.

## Raccourcis

| Action | Raccourci |
|---|---|
| Afficher / masquer l'overlay | `Ctrl+Maj+O` |
| Déplacer l'overlay (re-appuyer pour valider) | `Ctrl+Maj+M` |
| Mode compact (juste le prochain objet) | `Ctrl+Maj+H` |
| Appliquer les runes (pendant la sélection) | `Ctrl+Maj+R` |
| Changer de poste (sélection et partie) | `Ctrl+Maj+P` |

Pour changer un raccourci, ferme BuildSense et modifie la section `hotkeys` de `%APPDATA%\BuildSense\config.json`.

L'overlay ne capte pas les clics : ils passent au jeu. Fermer la fenêtre principale ne quitte pas l'appli, elle reste dans la zone de notification. Pour la quitter, fais un clic droit sur l'icône › Quitter.

## Respect des règles de Riot

- **Uniquement des API officielles** :
  - l'API web de Riot pour les parties des meilleurs joueurs ;
  - Data Dragon pour les données et les icônes ;
  - la *Live Client Data API* locale pour ta partie ;
  - l'API locale du client pour la sélection et ta page de runes.
- **Aucun accès au jeu lui-même** : pas de lecture de la mémoire du jeu, pas d'injection. L'overlay est une simple fenêtre transparente posée au-dessus.
- **Seulement des infos visibles en jeu** (champions, objets, KDA du tableau des scores) : pas de timers d'ultis, de sorts ou de camps.
- **Rien d'automatisé en partie** : pas d'achat ni de montée de sorts automatique. Seule ta page de runes est réglée, pendant la sélection, et tu peux le désactiver.
- **Aucune recherche sur les joueurs** de ta partie.

C'est un projet perso, non validé par Riot.

## Dépannage

- **L'overlay n'apparaît pas en partie**
  - Vérifie que LoL est en *Fenêtré sans bordure*.
  - Vérifie que BuildSense tourne (icône près de l'horloge).
- **Des initiales à la place des icônes** : le téléchargement des icônes n'a pas pu se faire. Vérifie ta connexion, puis relance BuildSense. L'état est indiqué en bas à gauche (« Icônes »).
- **« Clé API refusée »** : la clé de développement a expiré (24 h). Recolles-en une nouvelle.
- **La sélection n'est pas détectée** : dans Réglages, indique le dossier qui contient `LeagueClient.exe` (par défaut `C:\Riot Games\League of Legends`).
- **Les runes ne s'appliquent pas** : sélectionne une de tes pages modifiables dans le client, puis appuie sur `Ctrl+Maj+R`.
- **Mauvais poste détecté** : `Ctrl+Maj+P`, ou enregistre ton poste préféré pour ce champion.
- **Peu de données sur un champion** : ajoute-le à tes favoris et laisse la collecte tourner.

## Où sont les données

Tout est dans `%APPDATA%\BuildSense\` :
- `config.json` : tes réglages ;
- `data\records.jsonl` : les builds collectés (3 derniers patchs) ;
- `cache\` : les données du jeu et les icônes.

## Depuis le code source

Il faut Node.js LTS.

| Commande | Effet |
|---|---|
| `npm install`, puis `npm start` | Lance l'appli (ou double-clique sur `Lancer BuildSense.bat`) |
| `npm test` | Lance les tests sur des données factices |
| `npm run preview -- --out=captures` | Génère des captures de l'overlay et de la fenêtre principale |
| `npm run check:layout` | Vérifie qu'aucun texte n'est coupé ni ne déborde (français, anglais, noms très longs, petite et grande fenêtre) |
| `npm run dist:win` | Construit `dist/BuildSense-win32-x64/BuildSense.exe` et l'installeur |
| `npm run release` | Prépare `dist/latest.json` et publie la version sur GitHub (avec `gh` connecté), sinon affiche les étapes pour la publier à la main |

**Publier une nouvelle version** : augmente `version` dans `package.json`, ajoute une section `## x.y.z` dans `CHANGELOG.md` (ces lignes s'affichent dans l'appli), puis `npm run dist:win` et `npm run release`. Le dépôt utilisé est `buildsense.repo` dans `package.json`.

Pour que `npm run dist:win` produise aussi l'installeur, installe NSIS (https://nsis.sourceforge.io) ou indique son dossier avec la variable `NSIS_DIR`.

```
src/main.js              Processus principal : fenêtres, overlay, raccourcis, runes auto, boucles de lecture
src/core/modes.js        Modes de jeu (Faille, ARAM, Mayhem, Arena) et détection
src/core/riotApi.js      Client API Riot + limiteur de débit
src/core/crawler.js      Collecte par mode (priorité au mode joué et aux champions favoris)
src/core/extract.js      Match + timeline -> fiches build
src/core/store.js        Base locale (JSON Lines)
src/core/ddragon.js      Données du jeu (par langue et par carte) + chemins des icônes
src/core/iconCache.js    Cache disque des icônes Data Dragon
src/core/analyzer.js     Analyse de la compo adverse
src/core/recommender.js  Options d'objets, plan d'achat, runes, sorts, compétences, postes inhabituels
src/core/engine.js       Choix du poste, assemblage des vues
src/core/viewModels.js   Ce qu'affichent l'overlay et la page En direct
src/core/liveClient.js   Live Client Data API (partie en cours)
src/core/lcu.js          Client LoL (sélection, page de runes)
src/core/updater.js      Mises à jour (latest.json, téléchargement, vérification SHA-256)
src/ui/                  Overlay + fenêtre principale
scripts/preview.js       Captures et vérification de la mise en page
scripts/release.js       Publication d'une version (latest.json + GitHub Release)
build/installer.nsi      Installeur Windows (NSIS)
```

---

BuildSense n'est pas approuvé par Riot Games et ne reflète pas les opinions de Riot Games ni de quiconque officiellement impliqué dans la production ou la gestion des propriétés de Riot Games. Riot Games et toutes les propriétés associées sont des marques commerciales ou des marques déposées de Riot Games, Inc.
