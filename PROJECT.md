# Monad Blitz Paris — Le projet

Un « Subway Surfers IRL » : ton corps devient la manette, tes performances et tes
récompenses rejoignent Monad.

Ce document est la référence produit du dépôt. Il intègre les décisions validées
par Noé le 19 septembre 2026 ; les propositions et détails techniques encore ouverts
sont indiqués comme tels. « Monad Blitz » reste un nom provisoire.

## 1. Concept

Un runner contrôlé par les mouvements du joueur devant une caméra. Sur l'écran, le
personnage avance et des obstacles arrivent. Dans la pièce, le joueur saute,
s'accroupit et se déplace à gauche ou à droite pour les éviter.

Un modèle de reconnaissance corporelle transforme les mouvements filmés en commandes
de jeu. Le joueur accumule un score et ramasse des pièces.

Le parcours est généré aléatoirement avec une graine conservée pour chaque partie.
Cette graine permet au serveur de reconstruire le parcours et de rejouer les commandes.
La génération du parcours ne dépend pas des blocs Monad.

Le fantôme du joueur précédent donne une cible à rattraper et pousse à rejouer.
Pour l'affronter sur le même parcours, la nouvelle partie reprend sa graine.

La boucle centrale est : bouger, éviter les obstacles, rattraper le fantôme
précédent, enregistrer son score, laisser son propre fantôme au suivant.

## 2. Contexte et objectif

Hackathon Monad Blitz Paris, équipe de deux personnes. Une expérience dans le
navigateur, avec une webcam et un écran devant le joueur.

La démo doit être facilement essayable par les participants. Le format du jugement
et les horaires restent à confirmer auprès de l'organisation.
Voir [Démo et pitch](docs/demo-et-pitch.md).

La priorité absolue est la qualité des commandes corporelles. Si le jeu répond mal
aux mouvements, aucune autre fonctionnalité ne sauve la démonstration.

## 3. Parcours du joueur

1. Ouvrir le site et saisir un pseudo.
2. Autoriser la caméra et se placer entièrement dans le cadre.
3. Effectuer une courte calibration debout, au centre.
4. Lancer la partie après un compte à rebours.
5. Éviter les obstacles et collecter les pièces, avec le fantôme précédent visible
   devant.
6. Voir son score et ses pièces sur l'écran de fin, puis le classement.
7. Relancer une partie.

Il n'y a pas de connexion de wallet. Le joueur saisit un pseudo et le serveur
enregistre le résultat pour lui avec une clé relayer privée, qui paie les transactions.
Le pseudo et l’expiration de session sont inscrits onchain ; un cookie privé identifie le joueur. L'inventaire n'est pas lié à un wallet joueur.

## 4. Gameplay

### Commandes

| Mouvement réel | Action dans le jeu |
| --- | --- |
| Déplacement vers la gauche | Aller dans le couloir de gauche |
| Retour au centre | Revenir dans le couloir central |
| Déplacement vers la droite | Aller dans le couloir de droite |
| Saut | Franchir un obstacle bas |
| Accroupissement | Passer sous un obstacle haut |

Trois couloirs. La course vers l'avant est automatique, le joueur reste dans sa zone
devant la caméra.

### Obstacles et difficulté

Obstacles bloquant un couloir, obstacles bas à franchir en sautant, obstacles hauts
à éviter en s'accroupissant, pièces disposées pour encourager les changements de
trajectoire. Vitesse et fréquence croissantes.

Les séquences doivent rester physiquement réalisables. Des parties courtes sont
recommandées pour faire tourner les joueurs pendant la démo.

Le parcours utilise un générateur pseudo-aléatoire déterministe initialisé avec
une graine tirée au lancement d'un nouveau parcours. La même graine et la même
version du moteur doivent produire les mêmes obstacles et pièces. Le générateur
filtre les séquences impossibles à réaliser physiquement.

La simulation avance à pas de temps fixe, indépendamment du rendu. Sa fréquence
reste à choisir après des essais de réactivité ; 5 ticks par seconde n'est pas une
décision validée. Les pauses de suivi caméra suspendent la simulation.

### Retour visuel

Le personnage, les obstacles, le score et les pièces doivent rester lisibles depuis
la salle. Un petit aperçu de la caméra avec les points du corps aide le joueur à se
repositionner. En cas de perte du suivi, le jeu se met en pause et indique comment
revenir dans le cadre.

## 5. Reconnaissance corporelle

Approche proposée : MediaPipe Pose Landmarker, puis des règles simples sur les points
corporels. Traitement local dans le navigateur, sans envoi ni stockage du flux vidéo.

Points à traiter dans le prototype :

- calibrer une position neutre pour adapter les seuils à chaque joueur ;
- déduire le couloir du déplacement latéral, en tolérant la dérive du joueur ;
- distinguer un saut d'un simple mouvement du buste en combinant plusieurs points
  et leur évolution ;
- détecter l'accroupissement à partir de la hauteur relative du corps ;
- lisser les variations et garantir qu'un geste produit une seule commande ;
- vérifier que gauche et droite correspondent au ressenti avec l'aperçu en miroir ;
- préserver la fluidité du rendu pendant l'analyse des images.

Ces quatre commandes doivent être validées avant tout investissement dans les décors
ou les animations. C'est le poste de travail le plus long du projet et il demande
deux personnes : une devant la caméra, une sur les seuils.

## 6. Score, pièces et skins

Une progression du score avec la distance parcourue est proposée ; la formule reste
à fixer. Les pièces sont ramassées pendant la partie et servent de monnaie pour la
boutique ; elles sont distinctes du score. Le serveur recalcule les deux par rejeu.

Les skins sont uniquement cosmétiques, avec quelques variantes et des prix fixes.
L'inventaire reste dans le contrat, sans NFT ni token. Un bitmask pour représenter
les skins possédés est proposé dans la spécification backend.

La boutique est la fonctionnalité la moins prioritaire du projet. Elle saute sans
conséquence si le temps manque.

## 7. Rôle de Monad

| Dans le navigateur | Sur Monad |
| --- | --- |
| Caméra et reconnaissance des mouvements | Résultats validés par le serveur |
| Génération aléatoire, simulation et collisions | Meilleur score et nombre de parties par joueur |
| Rendu, animations et interface | Solde de pièces, skins possédés et équipé |
| Lecture du classement et rejeu des fantômes | Stockage des fantômes proposé, à préciser |

Une transaction à la fin de la partie enregistre le résultat et crédite les pièces.
L'achat d'un skin en constitue une autre. Les mouvements individuels ne déclenchent
aucune transaction.

Monad testnet conserve les résultats et l'état des joueurs. La validation par rejeu
est réalisée côté serveur et ne dépend pas de la blockchain.

Le suivi de la confirmation est prévu après chaque soumission. Les temps de
confirmation, coûts et éventuelles démonstrations de charge doivent être mesurés sur
l'implémentation ; aucun débit ou coût de classement n'est garanti à ce stade.

Détails dans [Backend Monad](docs/backend-monad.md) et
[Référence Monad](docs/monad-reference.md).

## 8. Validation des résultats et confiance

Un score enregistré ne prouve pas que le joueur a exécuté les mouvements. Le
navigateur est modifiable et peut transmettre des résultats fabriqués.

L'approche retenue est la validation par rejeu. Le client transmet l'identifiant de
partie, la graine, la version du moteur, le nombre de ticks, les commandes, le score
et les pièces annoncés. Le serveur vérifie les paramètres de la session, reconstruit
le parcours avec la même graine et rejoue les commandes dans la simulation partagée.
Il recalcule le score et les pièces et refuse une partie incohérente.

Chaque partie doit être créditée une seule fois. L'identification de la session et
la protection contre les doubles soumissions restent à implémenter, y compris en
cas de nouvelle tentative après un échec réseau.

Après validation, le relayer signe et envoie la transaction. Le rejeu vérifie la
partie ; la signature autorise l'écriture. Aucun wallet joueur ni protocole de
signature de résultat séparé n'est prévu pour le MVP.
Voir [Contrat d'interface](docs/interface.md).

Ce que la validation ne fait pas : elle ne prouve pas l'authenticité du flux caméra.
Un joueur qui injecterait des inputs cohérents sans bouger passerait le contrôle.
Cette limite est assumée et annoncée telle quelle.

L'interface distingue le résultat local, la transaction en attente et le résultat
confirmé. En cas d'échec, l'enregistrement peut être retenté sans créditer deux fois
les pièces.

## 9. Architecture

| Partie | Choix ou état |
| --- | --- |
| Application web | Nuxt 4, Vue 3, TypeScript, en place |
| Styles | Tailwind CSS 4, en place |
| Dépendances | pnpm uniquement |
| Environnement | Node.js 24 |
| Hébergement | Vercel, déploiement via GitHub Actions sur `main`, validé |
| Reconnaissance corporelle | MediaPipe Pose Landmarker, proposé |
| Rendu du jeu | three.js en composant client, boucle de rendu propre |
| Simulation | module pur partagé navigateur et serveur, pas de temps fixe |
| Parcours | génération pseudo-aléatoire à graine conservée, indépendante de Monad |
| API | routes serveur Nuxt, relayer côté serveur |
| Réseau | Monad testnet, chain ID 10143 |
| Contrat | contrat unique, sans proxy ni token |

## 10. Périmètre du MVP

Par ordre de priorité décroissante :

1. Les quatre commandes corporelles fiables, avec calibration.
2. Un parcours jouable avec obstacles, collisions et difficulté progressive.
3. Collecte de pièces et écran de résultat.
4. Enregistrement du score sur Monad et classement affiché avec les pseudos.
5. Badge de finalité après soumission.
6. Fantôme du joueur précédent.
7. Boutique de skins, achat et équipement.

Les six premiers points constituent la démonstration. Le septième est optionnel.

À envisager après : multijoueur en temps réel, tournois, nouveaux environnements,
marketplace de skins, détection de fraude plus avancée.

## 11. Répartition

| Personne | Responsabilité principale |
| --- | --- |
| Développeur A | Caméra, calibration, reconnaissance des mouvements, moteur de jeu |
| Développeur B | Contrat, routes serveur, relayer, classement, fantômes |
| Ensemble | Interface commune, intégration, essais physiques, préparation de la démo |

Une fois la boucle score et classement fonctionnelle, le développeur B peut rejoindre
le réglage des commandes corporelles. Les durées de réalisation restent à estimer.

Le [contrat d'interface](docs/interface.md) doit être précisé tôt pour que les deux
parties partagent les mêmes commandes, paramètres de parcours et résultats.

## 12. Ordre de réalisation

1. Socle web et déploiement — terminé.
2. Préciser l'interface, les paramètres de rejeu et la fréquence du pas fixe.
3. Commandes corporelles — gauche, droite, saut, accroupissement, sur la caméra réelle.
4. Runner jouable avec parcours aléatoire à graine, obstacles, score et pièces.
5. Sessions, rejeu serveur et protection contre les doubles soumissions.
6. Enregistrement du score sur testnet, classement et suivi de confirmation.
7. Fantôme du joueur précédent.
8. Boutique et skins.
9. Essais à plusieurs joueurs et préparation de la démo.

## 13. Démo cible

Un participant se place devant l'écran, effectue la calibration et joue une courte
partie, avec le fantôme du joueur précédent devant lui. Le public voit ses mouvements
contrôler le personnage. À la fin, son résultat est enregistré sur Monad, le badge de
finalité s'affiche, son pseudo apparaît au classement et son propre fantôme devient
la cible du joueur suivant.

Ouvrir la station avant les pitchs est recommandé pour recueillir des essais et
remplir le classement. Les horaires exacts restent à confirmer.

## 14. État et décisions

État de l’intégration sur `dev` : runner three.js en FPV, caméra/calibration,
moteur partagé 60 Hz, contrat avec top 25, sessions, rejeu serveur, relayer et
classement raccordés. Le fantôme a été retiré du front à la demande de Noé.
Décision complémentaire de Noé : toute la persistance métier est onchain, y compris
les pseudos, sessions, paramètres de partie et replays. PostgreSQL et le worker
séparé sont supprimés. Voir [l’API actuelle](docs/backend-api.md).

Décisions validées par Noé :

- pas de connexion wallet, saisie d'un pseudo et relayer côté serveur ;
- validation des résultats par rejeu serveur ;
- simulation déterministe partagée et pas de temps fixe ;
- parcours généré aléatoirement, avec une graine conservée pour le rejeu ;
- aucune génération du parcours à partir des blocs Monad pour cette version ;
- fantôme du joueur précédent, avec celui du leader pour la démo ;
- boutique optionnelle et inventaire sans NFT ni token, dans un contrat unique ;
- rendu three.js, trois couloirs en perspective ;
- réseau Monad testnet, chain ID 10143.

Décisions restantes :

- nom définitif du jeu ;
- provenance des assets et niveau de détail du rendu ;
- matériel, cadrage et distance de jeu pour la démo ;
- règles de score, collisions, vies et durée des parties ;
- prix des skins et règles d'attribution des pièces ;
- suivi du solde relayer, des quotas et de la disponibilité du RPC ;
- emplacement et format de stockage des fantômes ;
- confirmation de MediaPipe sur le matériel de la démo ;
- répartition nominative, temps disponible et horaires de l'événement.
