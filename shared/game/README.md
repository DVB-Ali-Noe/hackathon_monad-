# Simulation du runner

Module pur partagé entre navigateur et rejeu serveur. Aucun accès au DOM, à
l’horloge, au réseau ou à `Math.random()`. Les types d’échange de `shared/types.ts`
restent ceux de `docs/interface.md`.

Version actuelle : `runner-5-oncoming-60hz`. Le prototype avance à **60 ticks/s**, avec des
distances en millimètres entiers. Les règles ci-dessous sont des réglages du
prototype à ajuster après essai ; toute modification exige une nouvelle version.

- Course sans limite de durée : elle se termine à la perte des trois vies.
  La vitesse augmente de 12 à 18 m/s ; le chrono compte le temps joué.
  Une collision frontale avec un train roulant termine immédiatement la course.
- Trois couloirs espacés de 2,4 m ; déplacement vers le couloir cible en deux
  ticks depuis le couloir adjacent (33 ms). Le rendu interpole entre deux états.
- Saut de 54 ticks, soit **0,9 seconde**, déclenché sur le front montant de
  `action: 'jump'`. Il continue après le retour physique au sol du joueur.
  Une commande maintenue ne relance pas automatiquement un saut.
  Une tolérance de six ticks (100 ms) après le bord du toit absorbe le décalage
  entre déplacement latéral et détection du saut. Une nouvelle impulsion reçue
  jusqu’à six ticks avant l’atterrissage reste en attente. Aucun double saut
  n’est possible pendant un saut en cours ou une chute au-delà de cette tolérance.
- Accroupissement maintenu par `action: 'crouch'`, au sol ou sur un toit.
- Trains de 18 m de long et 3 m de haut, avec des rampes de 4,5 m sur certains
  wagons. Le premier train possède toujours une rampe. Marcher sur une rampe
  augmente la hauteur ; un saut part du toit et peut atterrir sur un autre train.
  Quitter un toit déclenche une chute ; le saut reste possible durant la courte
  tolérance de décollage.
- Le trafic est plus dense, avec un train roulant dans chaque rangée impaire.
  Il avance vers le joueur à 100 mm/tick (6 m/s). Sa position dépend uniquement
  du tick et d’un tick de rencontre calculé à partir de la distance de la rangée.
  Le déplacement est plafonné à 60 m de chaque côté de cette distance pour borner
  les fenêtres ; le train sort du champ avant ce plafond pendant une course normale.
- Trains bloquants, barres basses à sauter, portiques à franchir accroupi.
  Chaque rangée garde au moins un couloir libre ; espacement minimal de 21 m.
- Un impact retire une vie puis accorde 72 ticks d’invulnérabilité.
  Le flanc refuse le déplacement vers le wagon, même pendant l’invulnérabilité.
  Le contact latéral continu ne cumule pas les dégâts. Une collision frontale
  bloque l’avancée devant un train arrêté : il faut esquiver, sinon un nouvel impact
  retire une vie à l’expiration de l’invulnérabilité. La largeur du personnage
  est prise en compte pour les flancs et les appuis sur les toits.
- Les barrières basses sont des volumes de 1 m de long et 0,9 m de haut.
  Une réception par le dessus donne un appui sans dégâts ; la face retire une vie.
  Les réceptions sur les rampes utilisent la hauteur de la pente aux deux ticks,
  pour distinguer son passage sous les pieds d’un choc contre un flanc.
- Les pièces ont une hauteur : celles du toit ne sont pas accessibles depuis le sol.
- Score : 10 points par mètre entier parcouru et 25 par pièce collectée.

## API

`createCourse(config, fromDistance = 0)` génère une fenêtre de 180 mètres à partir
de la graine et vérifie la version. Chaque rangée dépend uniquement de la graine
et de son indice ; deux fenêtres qui se recouvrent ont exactement les mêmes objets.
`updateCourse(config, course, distance)` renouvelle la fenêtre quand il reste moins
de 120 mètres devant le joueur, en conservant deux mètres derrière. La taille du
parcours en mémoire reste bornée pendant les longues parties. Le tableau `Course`
porte `endDistance`, borne de renouvellement. Les trains mobiles sont inclus
avec une marge de 60 m avant et après la fenêtre pour conserver leurs volumes
durant le mouvement. Leur distance nominale ne suffit donc pas à interrompre
une boucle de rendu ou de collision : utiliser `itemDistance(item, tick)`.
Un train est conservé tant que son extrémité se trouve dans la fenêtre, même si
son entrée est déjà derrière le joueur. `TrackItem` porte sa longueur, la présence
d’une rampe, l’élévation des pièces et, pour les trains roulants, la vitesse et
le tick de rencontre. `itemLength` fournit les longueurs par défaut.

`createState()` crée l’état initial. `stepGame(state, input,
course)` renvoie l’état du tick suivant sans modifier l’état précédent.
L’état conserve la hauteur `y`, le support `supportId`, l’état `grounded`,
l’origine du saut et la vitesse de chute. Les collisions utilisent ces données
de simulation, indépendamment du rendu.
`replayRun(config, inputs)` recalcule un état final ; il rejette les commandes
invalides, les versions incompatibles et les entrées après la fin d’une partie.

Le serveur utilise ce moteur pour vérifier propriétaire, identifiant, graine,
version, durée, état terminal, score et pièces. Il n’accepte que 30 minutes de
simulation et 4 Mio par enregistrement, même si le jeu local est sans limite.
Les pauses sont permises ; les ticks ne peuvent dépasser le temps réellement écoulé.
Voir [l’API et ses limites](../../docs/backend-api.md).

Le front reçoit désormais la graine et l’identifiant du serveur avant le départ.
En cas d’indisponibilité, il annonce une partie locale avec identifiant `local-…`,
qui ne sera pas soumise au relayer. Le fantôme reste retiré à la demande de Noé.

Les anciennes versions sont incompatibles avec les nouvelles collisions et
tolérances de saut. Le serveur devra accepter explicitement la version 5 ; elle est celle acceptée par l’API intégrée.

Les pauses suspendent les ticks du joueur et le mouvement des trains. Elles ne sont
pas ajoutées aux commandes enregistrées. Une interruption du rendu supérieure à
250 ms déclenche une pause plutôt qu’un rattrapage de collisions.

Tests : `pnpm test`.
