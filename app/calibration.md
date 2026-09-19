# Diagnostic caméra

Route : `/calibration`, accessible depuis l’accueil. Lancer avec Node.js 24 et
`pnpm dev --port 3000`. Les API caméra exigent HTTPS ou localhost.

## Analyse et ressources

L’activation est explicite. Les images ne sont ni envoyées ni enregistrées.
Le worker charge MediaPipe Tasks Vision **0.10.21** depuis jsDelivr et le modèle
Pose Landmarker Lite float16, version **1**, depuis Google Storage. Une connexion
est nécessaire au premier chargement ; les erreurs et l’expiration sont affichées.
Aucune ressource MediaPipe n’est chargée avant l’activation.

`public/pose.worker.js` est un worker classique avec import ESM dynamique : le
chargeur WASM de cette bibliothèque utilise `importScripts`. L’inférence
synchrone reste hors du fil d’affichage. Le worker essaie le GPU, puis bascule sur
CPU si son initialisation ou son inférence échoue. Un seul `ImageBitmap`
transférable est en vol, largeur plafonnée à 640 pixels. La caméra demande 60
images/s quand le matériel le permet ; le plafond logiciel de 20 images/s est retiré.
`requestVideoFrameCallback` déclenche la capture dès qu’une image est présentée,
avec repli sur `requestAnimationFrame` si nécessaire. Quand le worker se libère,
la dernière image disponible repart immédiatement ; les images intermédiaires
ne sont pas mises en file d’attente. Le worker ferme chaque bitmap.
La sortie, l’arrêt et le masquage de l’onglet arrêtent les pistes et
terminent le worker. Les permissions et bitmaps reçus après l’arrêt sont libérés.

Le panneau de diagnostic indique GPU/CPU, la durée d’inférence, le délai image →
résultat et la fréquence des résultats. Le délai commence à la notification de
l’image dans le navigateur (à la capture du bitmap pour le repli rAF) : il ne mesure
pas le délai physique complet du capteur au personnage affiché. Les nouvelles
performances restent à mesurer sur le Mac de Noé. Le choix du worker suit la
[documentation MediaPipe](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js),
qui décrit le caractère bloquant de `detectForVideo`.

## Reconnaissance

Le bouton de calibration est accessible même si le corps n’est pas encore cadré.
Un compte à rebours de cinq secondes laisse le temps de reculer ; la collecte
attend ensuite une posture valide, sans second clic. Les images prises avant la
fin du compte à rebours ne participent pas à la mesure.

La référence est calculée sur 1,8 seconde stable, avec au moins 18 observations.
La tête, les épaules, les hanches, les genoux et les pieds doivent être cadrés et
fiables pendant la calibration. Une fois la référence mesurée, le suivi exige les
épaules, les hanches et deux points fiables sur chaque pied ; la tête hors cadre
ou un genou masqué ne l’interrompent plus. La calibration exige une posture debout
au centre ; un mouvement ou une
interruption réinitialise la collecte. Les seuils latéraux utilisent la largeur
des épaules et les seuils verticaux la hauteur du corps calibrées.

Le lissage dépend du temps entre observations. Le couloir utilise un lissage de
10 ms, une confirmation de 12 ms sur au moins deux images et une hystérésis : entrée à 0,65 largeur
d’épaules, sortie à 0,38 largeur. Après un retour depuis un côté, le bassin doit
rester 90 ms dans la zone centrale avant de pouvoir sélectionner un côté à nouveau.
Une traversée rapide gauche → droite s’arrête donc au couloir central ; ce verrou
évite les doubles changements dus à un dépassement ou à un rebond du geste.
Le premier déplacement conserve sa confirmation courte. Le bassin détermine gauche/droite en coordonnées
miroir ; bouger seulement le buste ne suffit pas. Le saut combine l’élévation du
bassin, des épaules et des deux pieds, y compris les pointes. L’accroupissement
exige un abaissement du bassin et des épaules avec les pieds au sol.

L’axe vertical utilise un lissage de 30 ms. Une fois l’accroupissement confirmé
pendant 20 ms, son maintien tolère les petites
variations du buste et des pieds. Il se termine quand le bassin et les épaules
reviennent près de leur hauteur debout pendant 160 ms, ou lorsqu’un saut est
confirmé. Une perte du suivi neutralise toujours la commande immédiatement.

Le décollage utilise les observations avant lissage et une confirmation sur au
moins deux images séparées de 12 ms. Les seuils minimaux sont de 2,5 % de la hauteur
calibrée pour le bassin, 2 % pour les épaules et 1,2 % pour chacun des pieds. Le
compteur « Sauts détectés » conserve les détections après l’impulsion ; il revient
à zéro à la recalibration ou à l’arrêt de la caméra.

`shared/types.ts` reprend exactement les quatre types de `docs/interface.md`.
Dans ce diagnostic, `lane` représente le couloir cible, `crouch` reste actif
pendant l’accroupissement, et `jump` est une impulsion de 180 ms, réarmée après un
retour debout au sol. Le runner de `/jeu` échantillonne cette commande à 60 ticks/s
et déclenche un saut de jeu indépendant de 0,9 seconde.

Consigne de Noé pour le runner : le saut du personnage doit durer un peu
plus longtemps que le temps passé physiquement en l’air, pour laisser la marge
nécessaire au franchissement des obstacles. Le geste déclenche un saut dont la
durée est gérée par la simulation partagée en ticks, indépendamment de la pose
caméra après l’atterrissage du joueur. La durée exacte reste à régler avec les
obstacles ; l’impulsion caméra de 180 ms ne définit pas la durée du saut en jeu.
Le premier réglage est de 54 ticks à 60 Hz (0,9 seconde).

La perte du suivi neutralise immédiatement la commande. La reprise attend 200 ms
de suivi continu ; un nouveau saut nécessite de retrouver le sol. Une image vieille
de plus de 600 ms est ignorée. La référence reste disponible après une perte du
suivi, mais une nouvelle personne ou une caméra déplacée exige une recalibration.

## Vérifications

```sh
pnpm test:camera
pnpm typecheck
pnpm build
```

Les tests couvrent les séquences synthétiques de reconnaissance et le cycle caméra
avec des API navigateur simulées. Ils ne valident ni le téléchargement des assets
ni l’inférence MediaPipe sur des images réelles.

À essayer sur le matériel de démonstration :

1. Refuser la caméra, vérifier le message, puis l’autoriser et réessayer.
2. Cliquer sur « Calibrer ma position » depuis le Mac, reculer pendant les cinq
   secondes, puis cadrer tête et pieds et rester debout au centre sans bouger.
3. Faire gauche → centre → droite → centre en marquant brièvement le centre ;
   vérifier le sens du miroir et l’absence de double changement sur un geste brusque.
4. Bouger seulement les bras ou le buste, lever un pied, puis faire deux sauts
   séparés par un retour au sol. Se baisser, tenir, puis se redresser.
5. Sortir du cadre, revenir et vérifier la reprise sans commande parasite.
6. Relever les mesures du diagnostic, recommencer avec une autre morphologie.
7. Arrêter, changer de page ou d’onglet ; vérifier l’extinction de la webcam.

Le sandbox de développement ne permet pas l’ouverture du port 3000 ni le lancement
de Chromium. Le rendu SSR est vérifiable en mémoire, mais l’essai navigateur et
webcam ci-dessus reste nécessaire avant de valider les commandes physiques.
