# Démo et pitch

## 1. Objectif et format

Faire essayer un runner contrôlé avec le corps, enregistrer un résultat sur Monad
testnet et donner envie au participant suivant d'affronter le fantôme précédent.
Les décisions produit figurent dans [PROJECT.md](../PROJECT.md).

Le mode de jugement, la durée du pitch et les horaires doivent être confirmés auprès
de l'organisation. Le format de trois minutes ci-dessous est une proposition.

## 2. Ouvrir la station tôt

Prévoir une période d'essais avant les pitchs pour valider le cadrage, faire jouer
plusieurs participants et remplir le classement. La boutique passe après les
commandes fiables, le runner, l'enregistrement du score et le fantôme.

Un objectif d'ouverture vers 16 h et un gel des fonctionnalités vers 17 h 30 peuvent
servir de repères si le programme de l'événement le permet.

## 3. Le fantôme

À la table, afficher le fantôme du joueur précédent ; pendant le pitch, celui du
leader. Le fantôme est rejoué avec le moteur partagé, sa graine, sa version et ses
commandes. Le joueur courant reprend ce parcours avec un nouvel identifiant de partie.

La génération est aléatoire et indépendante de Monad. Conserver la graine permet
de retrouver exactement les mêmes obstacles pour le serveur et le fantôme.

Prévoir un premier joueur sans fantôme, ainsi que le cas d'un replay indisponible
ou incompatible. Ne pas afficher une trajectoire inventée comme un replay réel.
Le stockage des replays reste à préciser dans [le backend](backend-monad.md).

## 4. Informations visibles

Priorité au personnage, aux obstacles, au score, aux pièces et au pseudo du fantôme.
Après la partie, afficher le résultat local, la validation serveur, la transaction
et sa confirmation. Un panneau technique peut montrer des mesures réelles si elles
sont utiles à la présentation.

Les coûts de gas, délais de finalisation et débits ne doivent pas être renseignés
avec les chiffres illustratifs de la proposition initiale. Toute mesure doit
correspondre au chemin réellement exécuté, avec son périmètre indiqué.

## 5. Proposition de pitch, trois minutes

| Temps | Contenu |
| --- | --- |
| 0:00 | Un joueur est déjà devant la caméra ; montrer les mouvements et leur effet. |
| 0:30 | Faire essayer une courte partie à une personne de la salle. |
| 1:30 | Soumettre le résultat et montrer sa validation puis sa confirmation réelle. |
| 2:00 | Afficher le classement et le fantôme laissé au participant suivant. |
| 2:30 | Expliquer la simulation partagée, le rejeu et le rôle de Monad testnet. |
| 2:45 | Conclure avec la prochaine partie face au fantôme. |

Messages techniques :

- le parcours aléatoire reste reproductible grâce à sa graine ;
- le serveur recalcule le score et les pièces avant que le relayer enregistre le résultat ;
- Monad testnet conserve les résultats et l'état des joueurs ;
- les mouvements et le rendu restent locaux, sans transaction pendant la course.

Le rejeu vérifie la cohérence des commandes, pas leur origine corporelle. Les joueurs
n'ont pas de wallet ; le serveur paie et signe les transactions.

## 6. Essais et gel

Tester l'éclairage, le cadrage et les quatre commandes à l'endroit prévu pour la
démo. Vérifier que l'inférence ne bloque pas le rendu et que les pauses conservent
la synchronisation avec le fantôme.

Tester le RPC, les reprises après échec réseau et l'absence de double crédit.
Réserver la fin du créneau aux essais à plusieurs et aux répétitions chronométrées.
La démonstration de charge et la boutique restent secondaires face à une partie
complète fiable.
