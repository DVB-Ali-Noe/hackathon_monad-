# Contrat d'interface entre les deux développeurs

Le [document produit](../PROJECT.md) fixe les décisions validées. Le moteur et
le serveur utilisent les types ci-dessous. Les échanges HTTP et les limites
effectives sont décrits dans [backend-api.md](backend-api.md).

## 1. Répartition

Le front produit un `RunResult` à la fin de chaque partie. Le serveur le valide
avec le même moteur et le transmet au relayer. Le type `Ghost` reste disponible
pour une évolution future ; le fantôme a été retiré du jeu à la demande de Noé.

## 2. Types partagés

Implémentés dans [shared/types.ts](../shared/types.ts) :

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
`tickCount` fixe la durée simulée, indépendamment des pauses. Les sessions et les paramètres de partie sont inscrits dans le contrat avant le départ.

## 3. Commandes et encodage

Le format proposé exprime le couloir cible et l'action séparément : le retour au
centre est explicite, et un changement de couloir peut accompagner un saut ou un
accroupissement. Les règles de déclenchement et de maintien restent à préciser.

Le JSON contient une entrée par tick. Après validation, le serveur compacte chaque
entrée dans un octet : `(lane + 1) * 3 + action`, avec `none=0`, `jump=1`,
`crouch=2`. Pour décoder : `lane = floor(octet / 3) - 1`, `action = octet % 3`.
Ces octets sont conservés dans l’événement onchain `RunSubmitted` ; la graine,
la version, les ticks et leur empreinte sont accessibles par `getRun`.

## 4. Pas de temps fixe

La simulation avance par pas fixes, indépendants du taux de rafraîchissement du
rendu. Le rendu interpole entre deux pas ; il ne fait pas avancer la simulation.

La fréquence actuelle est de 60 ticks par seconde. Les règles précises sont dans
[la documentation du moteur](../shared/game/README.md) ; toute évolution de ces
règles nécessite une nouvelle version de simulation.

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

Les replays sont conservés onchain ; le fantôme reste retiré de l’interface. Le rejeu exact est la cible ; une trajectoire inventée
ne doit pas être présentée comme la course enregistrée d'un joueur.

## 7. Module de simulation partagé

Le moteur est un module pur, sans accès au DOM ni au réseau. Le navigateur l'utilise
pour jouer, le serveur pour vérifier et le rendu three.js pour afficher le fantôme.

La graine et les commandes suffisent à reproduire une partie avec la même version
du moteur. Monad conserve la préparation avant le jeu, puis le résultat et le replay après validation.
