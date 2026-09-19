# Contrat d'interface entre les deux développeurs

Le [document produit](../PROJECT.md) fixe les décisions validées. Cette spécification
propose le format à partager entre le moteur de jeu, le serveur et le fantôme ; les
types exacts restent à figer avant l'intégration.

## 1. Répartition

Le développeur A produit un `RunResult` à la fin de chaque partie et consomme un
`Ghost` au lancement. Le développeur B valide un `RunResult` et fournit un `Ghost`.
Les deux côtés partagent la simulation, les règles du générateur et leur version.

## 2. Types partagés proposés

À placer dans un fichier partagé, par exemple `shared/types.ts`, lors de
l'implémentation :

```ts
export type GameInput = {
  lane: -1 | 0 | 1
  action: 'none' | 'jump' | 'crouch'
}

export type RunConfig = {
  seed: string
  simulationVersion: string
}

export type RunResult = RunConfig & {
  runId: string
  pseudo: string
  score: number
  coins: number
  tickCount: number
  inputs: GameInput[]
}

export type Ghost = RunConfig & {
  pseudo: string
  score: number
  tickCount: number
  inputs: GameInput[]
}
```

`seed` est la graine du générateur pseudo-aléatoire. Une nouvelle graine est tirée
pour un nouveau parcours, puis conservée avec la partie. Elle ne provient pas d'un
bloc Monad. Le même générateur, sa version et sa graine reproduisent le même parcours.

`runId` identifie une partie unique, y compris lorsqu'elle reprend le parcours d'un
fantôme. Le serveur doit vérifier son rattachement à une session et empêcher son
crédit multiple. Le pseudo est un nom d'affichage, pas une preuve d'identité.

`simulationVersion` identifie les règles, le générateur et la fréquence de simulation.
`tickCount` fixe la durée simulée, indépendamment des pauses. Le mécanisme de création
de session et le format réseau restent à préciser avec le backend.

## 3. Commandes et encodage

Le format proposé exprime le couloir cible et l'action séparément : le retour au
centre est explicite, et un changement de couloir peut accompagner un saut ou un
accroupissement. Les règles de déclenchement et de maintien restent à préciser.

Pour commencer, une entrée par tick suffit. La compression des commandes est une
optimisation ultérieure ; aucun encodage à 3 bits ni budget de stockage n'est figé.
Le format doit conserver toutes les commandes nécessaires au rejeu exact.

## 4. Pas de temps fixe

La simulation avance par pas fixes, indépendants du taux de rafraîchissement du
rendu. Le rendu interpole entre deux pas ; il ne fait pas avancer la simulation.

Le principe est validé. La fréquence reste à choisir après les essais de commandes
corporelles : les 5 ticks par seconde de la proposition initiale ne sont pas retenus
comme contrainte.

Contraintes du moteur :

- aucune lecture de `Date.now()` ou `performance.now()` dans la simulation ;
- aucun appel à `Math.random()` dans la simulation : utiliser le générateur à graine ;
- l'horloge et l'accumulateur de temps restent dans la boucle qui pilote le moteur ;
- aucune dépendance à la fenêtre ou au framerate dans les collisions ;
- les pauses suspendent les ticks, sans modifier le parcours ;
- le générateur produit des séquences physiquement réalisables.

## 5. Validation par rejeu

Le serveur vérifie les paramètres de la session, initialise le moteur avec la graine
et la version attendues, puis rejoue les commandes pendant le nombre de ticks annoncé.
Il recalcule le score et les pièces et refuse les résultats incohérents.

Les durées, tailles d'entrée, actions et états de fin doivent être bornés et validés.
Le rejeu prouve la cohérence de la partie, pas l'origine corporelle des commandes.
La protection contre les doubles crédits est une exigence distincte du rejeu.

## 6. Fantôme

Le fantôme conserve sa graine, sa version du moteur, sa durée et ses commandes.
Pour l'affronter, le joueur reprend le même parcours avec un nouvel identifiant de
partie. Les deux simulations avancent sur les mêmes ticks et se mettent en pause
ensemble. Un replay d'une version incompatible ne doit pas être joué avec de
nouvelles règles.

Le stockage des replays et le choix entre le joueur précédent et le leader restent
à préciser dans le backend. Le rejeu exact est la cible ; une trajectoire inventée
ne doit pas être présentée comme la course enregistrée d'un joueur.

## 7. Module de simulation partagé

Le moteur est un module pur, sans accès au DOM ni au réseau. Le navigateur l'utilise
pour jouer, le serveur pour vérifier et le rendu three.js pour afficher le fantôme.

La graine et les commandes suffisent à reproduire une partie avec la même version
du moteur. La connexion à Monad intervient après le jeu pour enregistrer le résultat.
