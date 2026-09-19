# Front jouable

- `/jeu` : préparation, course, classement et suivi du résultat sur Monad.
- `/calibration` : diagnostic conservé, accessible dans les onglets et depuis
  l’accueil. La navigation arrête la webcam de l’écran quitté.

La course n’a plus de durée maximale. Le chrono affiche le temps joué, la pause
le fige et la perte des trois vies termine la partie. Le parcours se génère
par fenêtres déterministes à mesure que le joueur avance. Une collision frontale
avec un train arrivant en sens inverse termine aussi la course.

La scène occupe presque toute la fenêtre, sans colonne latérale pendant le jeu.
La vue à la première personne est activée par défaut : position des yeux, hauteur
sur les toits et abaissement en position accroupie. Le bouton « Vue extérieure »
permet de retrouver le personnage. Le bouton « Plein écran » utilise l’API native ;
les commandes, le départ et l’aperçu caméra restent dans l’élément agrandi.
Quitter le plein écran pendant une course la met en pause. Un refus du navigateur
est affiché sans empêcher le jeu en fenêtre.

Le bouton « Activer la caméra et jouer » lance l’activation puis le compte à
rebours de calibration. Après une posture stable, un compte à rebours de trois
secondes démarre la course sans revenir cliquer près du Mac. Une perte du suivi
met le joueur en pause ; un retour stable déclenche la reprise
après deux secondes. Après changement d’onglet, réactiver et recalibrer la caméra
permet de reprendre la course suspendue.

Le mode clavier/tactile permet de vérifier le jeu indépendamment de la webcam :
gauche/droite, retour au centre au relâchement, espace ou flèche haut pour sauter,
flèche bas pour rester accroupi. Échap met en pause.

La détection caméra utilise les nouvelles images sans plafond logiciel de 20 Hz,
avec GPU et repli CPU. Le lissage et la confirmation des gestes sont raccourcis ;
un changement vers le couloir adjacent prend deux ticks (33 ms), contre quatre
auparavant. Ce temps ne représente pas la latence complète caméra → écran.
La zone centrale est élargie : entrée latérale à 0,65 largeur d’épaules, retour à
0,38. Après un côté, il faut rester 90 ms au centre avant un nouveau déplacement
latéral ; traverser le cadre d’un seul geste ne saute plus le couloir central.

Les trains sont des volumes de 18 m avec un toit à 3 m. Une rampe de 4,5 m permet
d’y monter en courant, puis de sauter vers un autre toit ou de redescendre.
Les pièces sur les toits se collectent à leur hauteur. Une collision avec la
face d’un wagon arrêté ou le flanc d’un wagon retire une vie. Le flanc bloque le déplacement latéral,
y compris pendant l’invulnérabilité, et la face bloque l’avancée jusqu’à l’esquive.
Rester devant le train finit par consommer les vies restantes après chaque
période d’invulnérabilité. Un contact latéral continu ne retire qu’une vie.
Le saut tolère 100 ms entre la sortie du toit et l’impulsion détectée, et conserve
brièvement une impulsion reçue juste avant l’atterrissage. Le départ garde la
hauteur du toit ; le retour physique au sol ne raccourcit pas le saut du jeu.
La caméra suit la hauteur du personnage. Descendre vers une rampe voisine ou
atterrir sur le dessus d’une barrière basse donne un appui sans perte de vie.
Le trafic comprend davantage de trains, dont des trains qui avancent à 6 m/s vers
le joueur. Le rendu et les collisions lisent la même position calculée en ticks ;
une pause immobilise donc aussi ces trains.

Le rendu three.js utilise des géométries procédurales, des objets instanciés et un
ratio de pixels plafonné à 1,5. Le décor comprend des rails, des trains colorés,
des façades pastel, des murs de briques, des arbres, des ponts, des barrières
rayées et un personnage animé. Les ressources GPU et les écouteurs sont libérés à la
sortie. Une erreur WebGL arrête la course et la caméra. MediaPipe conserve son
chargement CDN à version fixe.

À la demande de Noé, quatre textures (`train.jpg`, `track.jpeg`, `wall.jpg`,
`barrier.jpg`) sont chargées depuis le dépôt
[RohanChacko/Subway-Surfers](https://github.com/RohanChacko/Subway-Surfers), branche
`master`, via `raw.githubusercontent.com`. La [licence MIT et l’attribution](../public/third-party/subway-surfers/LICENSE.txt)
sont incluses dans `public/third-party/subway-surfers/`. C’est une réimplémentation
WebGL indépendante, pas le code du jeu officiel. Aucun script de ce dépôt n’est
exécuté ; les textures sont appliquées au rendu three.js existant. En cas d’échec,
le décor procédural reste jouable et un message le signale. Les requêtes tardives
ne conservent pas de texture GPU après la sortie de page.

Le téléchargement binaire est bloqué dans le sandbox ; les URLs et références ont
été inspectées, mais leur affichage réel reste à vérifier dans le navigateur de Noé.
Cette intégration n’est pas une reproduction intégrale des assets officiels.

Références consultées : [site du jeu](https://subwaysurfers.com/),
[captures de gameplay](https://www.malavida.com/en/soft/subway-surfers/android/)
et [vidéo de gameplay repérée](https://www.youtube.com/watch?v=7ghSziUQnhs).
La lecture de la vidéo n’était pas accessible dans l’environnement. Les visuels
combinent géométrie locale et textures du dépôt ci-dessus ; les assets officiels
ne sont pas importés.

La préparation crée une session et une partie serveur, puis charge le top 25.
La cible est le joueur au score strictement supérieur le plus proche ; son écart
diminue localement pendant la course. À la fin, le résultat est rejoué par le
serveur, envoyé par le relayer et suivi jusqu’à confirmation. En cas d’indisponibilité
au départ, l’interface annonce une partie locale non enregistrée.
Le fantôme reste retiré à la demande de Noé.
Voir [le moteur partagé](../shared/game/README.md) et [l’API](../docs/backend-api.md).

## Essai réel restant

1. Sur `/jeu`, saisir un pseudo, activer la caméra, reculer et rester immobile.
2. Vérifier le départ automatique, gauche/centre/droite et l’accroupissement tenu.
3. Franchir une barre basse : le personnage reste en saut 0,9 seconde même après
   l’atterrissage physique. Régler cette durée avec les obstacles après essai.
4. Sortir du cadre puis revenir : aucun tick ni obstacle ne doit avancer en pause.
5. Finir une course puis relancer « Nouvelle piste » ; aucun fantôme ne doit apparaître.
6. Recharger la page : le pseudo doit rester disponible sur cet appareil.
7. Ouvrir Calibration puis revenir au jeu ; vérifier l’arrêt de la webcam à la sortie.
8. Dépasser 75 secondes, mettre en pause et reprendre ; le chrono doit rester
   croissant et la piste doit continuer à proposer des obstacles.
9. Relever GPU/CPU, inférence, image → résultat et images/s dans Calibration,
   puis comparer la sensation des gestes en jeu avec le réglage précédent.
10. Prendre la rampe du premier train, collecter ses pièces sur le toit, sauter
    vers un autre train puis quitter le toit. Vérifier les atterrissages et la caméra.
11. Depuis le sol, toucher le flanc d’un wagon ; vérifier qu’un impact retire
    une seule vie et bloque l’entrée dans le wagon, même après une rampe évitée.
    Un passage au sol ne doit pas collecter les pièces du toit.
12. Changer de couloir puis sauter presque simultanément depuis un toit ;
    le saut doit démarrer même si la caméra détecte le mouvement latéral en premier.

13. Descendre d’un train vers la rampe voisine, à gauche puis à droite ; vérifier
    l’appui, puis atterrir sur une barrière et comparer avec un choc de face.
14. Observer un train venant en face, l’éviter, puis mettre en pause : son
    déplacement doit s’arrêter avec la piste. Tester aussi une réception sur son toit.
15. Activer et quitter le plein écran, puis basculer FPV/vue extérieure ; tester
    saut et accroupissement dans les deux vues et vérifier le chargement des textures.

Vérifications automatiques : `pnpm test`, `pnpm typecheck`, `pnpm build`.
Les tests couvrent la simulation des trains, le raccord rampe/toit, le cadrage
mathématique des deux vues, le plein écran simulé et la taille bornée des objets du décor. Ils ne
remplacent pas un essai visuel WebGL.
Les essais webcam réels restent à effectuer sur la machine de démonstration.
