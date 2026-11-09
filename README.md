# BuildSense

Overlay de builds pour League of Legends. Il récupère les builds des meilleurs joueurs (Faille classée Challenger/Grand Maître, ARAM, ARAM Mayhem, Arena) et les adapte en direct à ta partie : objets, bottes, runes, sorts, départ. L'appli se met à jour toute seule.

## Installation (Windows)

1. Télécharge `BuildSense-Setup-x.y.z.exe` dans les [Releases](https://github.com/Deccibel/buildsense/releases/latest) et lance-le.
2. Si Windows affiche « Windows a protégé votre ordinateur », clique sur **Informations complémentaires**, puis **Exécuter quand même** (l'exe n'est pas signé).
3. L'installation ne demande pas de droits administrateur. Les mises à jour suivantes s'installent depuis l'appli, en un clic.

## Configuration

1. **Clé API Riot** (Réglages) : copie ta *Development API Key* depuis [developer.riotgames.com](https://developer.riotgames.com), colle-la, puis clique sur **Enregistrer**. Elle expire toutes les 24 h, mais tu peux demander une *Personal API Key* qui, elle, n'expire pas.
2. **Mes champions** : choisis tes champions, ils sont collectés en priorité. Tu peux aussi indiquer ton poste préféré pour chacun, par exemple Shen → Support.
3. **Builds** (facultatif) : mets un build en favori pour un champion et un poste. Il sert de point de départ en partie. Tu peux aussi suivre un joueur (ex. Hide on bush#KR1) pour reprendre ses builds.
4. **Dans LoL** : Options › Vidéo › **Fenêtré sans bordure**.

## Modes de jeu

| Mode | Données | Particularités |
|---|---|---|
| Classée, normale, Swiftplay | Classées Chall/GM | Poste, adversaire direct, runes |
| ARAM | Parties ARAM | Objets et sorts propres à l'ARAM |
| ARAM Mayhem | Mayhem (sinon ARAM) | Pas de runes |
| Arena | Parties Arena | Objets Arena, sans runes |
| URF, Un pour tous… | Faille classée | Signalé dans l'overlay |

## Runes

Dès que tu verrouilles ton champion, la page conseillée (selon ton champion, ton poste et le mode) remplace ta page active, sans créer ni supprimer de page. Si tu changes de poste, elle est réappliquée. Si tu la retouches à la main, BuildSense n'y touche plus. Tu peux la désactiver dans Réglages.

## Ce que montre l'overlay

- **Sélection** : adversaires, runes, sorts, départ, build type, ordre des compétences.
- **Début de partie** : les départs possibles, le meilleur encadré « ★ Meilleur choix ». Dans la boutique, la page d'objets « BuildSense » (onglet Recommandés) suit le même ordre.
- **En partie** : équipe adverse (KDA, *fed*, type de dégâts), prochain objet avec ses raisons, achat possible avec ton or, alertes, et le build complet de 6 objets adapté à la partie.
- L'onglet **Meta** de l'appli donne le top 5 des champions par poste et par élo.
- La page **En direct** de l'appli affiche la même chose en grand, pour un second écran.

## Raccourcis

Tu peux les changer dans l'onglet Overlay (n'importe quelle disposition de clavier).

| Action | Raccourci |
|---|---|
| Afficher / masquer l'overlay | `Ctrl+Maj+O` |
| Déplacer l'overlay | `Ctrl+Maj+M` |
| Mode compact | `Ctrl+Maj+H` |
| Appliquer les runes | `Ctrl+Maj+R` |
| Changer de poste | `Ctrl+Maj+P` |

## Dépannage

- **L'overlay n'apparaît pas** : vérifie que LoL est en Fenêtré sans bordure et que BuildSense tourne (icône près de l'horloge).
- **« Clé API refusée »** : ta clé de 24 h a expiré, colles-en une nouvelle.
- **La sélection n'est pas détectée** : dans Réglages, indique le dossier de LoL (`C:\Riot Games\League of Legends` par défaut).
- **Les runes ne s'appliquent pas** : sélectionne une page modifiable dans le client, puis appuie sur `Ctrl+Maj+R`.
- **Mauvais poste** : appuie sur `Ctrl+Maj+P`, ou enregistre ton poste préféré pour ce champion.
- **Des initiales à la place des icônes** : vérifie ta connexion, puis relance BuildSense.

---

BuildSense n'est pas approuvé par Riot Games et ne reflète pas les opinions de Riot Games ni de quiconque officiellement impliqué dans la production ou la gestion des propriétés de Riot Games. Riot Games et toutes les propriétés associées sont des marques commerciales ou des marques déposées de Riot Games, Inc.
