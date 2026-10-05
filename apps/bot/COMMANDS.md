# Commandes du bot

Commandes slash enregistrées dans le code du bot. Les paramètres entre `[]` sont facultatifs ; les autres sont obligatoires.

## Utilitaire

| Commande | Description |
| --- | --- |
| `/ping` | Répond en privé avec « pong », le ping WebSocket et la latence. Aucun paramètre. |
| `/help` | Envoie toutes les commandes et leurs paramètres en MP, en Components V2 avec séparateurs entre les catégories. La liste est générée depuis le registre du bot. Aucun paramètre ni permission particulière ; les MP doivent être ouverts. |

## Polls

`/poll` takes **no slash-command options**. It opens one modal with five labeled fields:

- **Question**: required, up to **300 characters**.
- **Answers**: required multiline text, **one answer per line**, with **2–10 distinct answers** of up to **55 characters** each. Whitespace is trimmed and empty lines are ignored.
- **Duration in hours**: a whole number from **1 to 768** (32 days), prefilled with **24**; leaving it empty also defaults to 24.
- **Voting mode**: a dropdown for **Single choice** (default) or **Multiple choice**.
- **Post in channel**: a required channel selector, with the current channel preselected when supported.

Submitting the modal creates a **native Discord poll**, not a reaction-based poll, publicly in the selected destination. Text channels, announcement channels, and active threads are supported. The private processing response is deleted after successful publication, leaving only the poll. Creation errors remain visible privately. The command has no default member-permission restriction in Discord's command picker; permissions are checked in the destination when it runs. Both the user and bot need **View Channel**, **Send Polls**, and **Send Messages** (or **Send Messages in Threads**) in the destination. Archived or locked threads are rejected. In private threads, both the user and bot must be thread members or have **Manage Threads**. Discord handles voting, results, and automatic expiry; no reactions, extra gateway intents, or database migration are needed.

Closing the modal without submitting does not publish anything. Only the user who opened the form can submit it; permissions are checked again at submission.

Deploy/restart the updated bot, then run `nub --cwd apps/bot run sync` to remove the old slash options and register the modal-based `/poll`. Reload the Discord client with **Ctrl+R** if it still shows the old definition.

## Solo Leveling: ARISE

| Commande | Description |
| --- | --- |
| `/sla redeem` | Opens a modal with required coupon code and Personal ID (Member code) fields. No command options. |
| `/sla create-coupon [item_1] … [item_8]` | Choose up to eight optional rewards using autocomplete across the complete `couponItems` catalog. Suggestions use object keys as labels and emoji names as values, return at most 25 matches, and exclude items selected in other options. Duplicate or unrecognized item values are rejected. Enter the coupon code and select a destination channel in the first modal (the current channel is selected by default). The private draft shows four selected items per page; each **Set quantity** button opens a separate modal requiring a positive whole-number quantity. Saved quantities can be edited. All selected items must have a quantity before publication; with no selected items, publish directly without rewards. The five category selects have been removed. The Components V2 card displays the title and code beside the thumbnail, followed by optional rewards and a Primary Claim button using the existing Claim/PID flow. Drafts expire after 5 minutes and are deleted immediately after publication or cancellation. Both you and the bot need permission to post in the destination channel. The legacy `/sla create` command has been removed; use `/sla create-coupon` instead. |
| `/sla news create [backfill-count]` | Crée ou réactive le forum de news. Importe de **0 à 10 articles** (10 par défaut), plus au maximum une publication épinglée. |
| `/sla news backfill [count]` | Importe de **1 à 50 articles** historiques sans notifier les rôles (10 par défaut). |
| `/sla news status` | Affiche la configuration des news. |
| `/sla news disable` | Arrête les futures publications de news. |
| `/sla news clean` | Supprime définitivement le forum, les rôles et l’historique des news, après confirmation administrateur. |

La gestion des news nécessite **Gérer les salons** ; leur suppression nécessite **Administrateur**.

## Configuration

| Commande | Description |
| --- | --- |
| `/setup logs [channel]` | Configure le salon de logs. Permet d’utiliser un salon textuel existant ou d’en créer un via un formulaire. |
| `/setup youtube` | Crée ou répare le forum YouTube par défaut, sans ajouter de créateur. Réutilise le forum déjà configuré. |
| `/setup clean [tag]` | Nettoie les vidéos ou les ressources YouTube. Le paramètre `tag` propose la liste des tags créateurs du forum ; sans tag, tous les créateurs sont concernés. |

`/setup logs` et `/setup youtube` nécessitent **Gérer les salons** (le propriétaire peut également configurer YouTube). `/setup clean` est réservé aux **administrateurs / propriétaire**.

### Choix de suppression YouTube

`/setup clean [tag]` demande quoi supprimer via des boutons, avec confirmation liée à l’utilisateur et au serveur, valable **5 minutes**. Il est possible d’annuler sans rien supprimer.

- **Vidéos uniquement** : supprime les publications vidéo gérées par le bot dans la portée choisie, y compris les posts archivés. Conserve le salon, les tags et le suivi des créateurs. Les vidéos supprimées ne sont pas republiées automatiquement ; les futures vidéos continuent à être publiées.
- **Tout dans la portée choisie**, avec un tag : supprime les vidéos, le tag appartenant au bot et le suivi de ce créateur. Les autres créateurs et le salon restent inchangés.
- **Tout dans la portée choisie**, sans tag : supprime le forum créé par le bot et tout le suivi YouTube du serveur. Si le forum a été choisi par l’utilisateur, conserve ce salon et ses posts/tags non gérés, mais supprime les vidéos gérées, les tags appartenant au bot et le suivi YouTube.

L’historique YouTube partagé et les autres serveurs ne sont jamais supprimés. En cas d’échec partiel, les publications sont suspendues ; relancer `/setup clean` avec la même portée permet de réessayer.

## YouTube

| Commande | Description |
| --- | --- |
| `/youtube add [backfill-count]` | Ouvre un formulaire pour le créateur (URL de chaîne, `@handle` ou identifiant `UC…`) et un sélecteur de forum Discord. Le forum de `/setup youtube` est présélectionné ; un forum existant peut être choisi explicitement. Importe de **0 à 15 vidéos** (10 par défaut). Une valeur de 0 suit uniquement les prochaines découvertes. Ne crée jamais de salon implicitement. |
| `/youtube status` | Affiche le forum configuré, les créateurs suivis et l’état des publications. |
| `/youtube sync` | Publie les vidéos en attente déjà collectées par l’API. Ne déclenche pas une nouvelle collecte RSS. |

La gestion YouTube nécessite **Gérer les messages**, avec accès également pour les administrateurs et le propriétaire.

Un seul forum YouTube est utilisé par serveur. Le choix effectué est conservé pour les publications suivantes. Tant que des créateurs sont suivis, sélectionner un autre forum est refusé : il faut d’abord supprimer tout le suivi via `/setup clean`, puis configurer ou sélectionner le nouveau forum. Choisir un autre forum avant tout suivi ne supprime pas l’ancien salon. Les permissions d’un forum choisi par l’utilisateur ne sont pas réécrites ; le bot vérifie qu’il dispose des permissions nécessaires.

## Mise à jour des commandes Discord

Après déploiement du code, synchroniser les commandes du serveur avec `nub --cwd apps/bot run sync`. Cette opération contacte Discord et remplace les définitions enregistrées, notamment `/videos` par `/youtube` et `/setup news …` par `/sla news …`.

To inspect the definitions actually stored by Discord without changing them, run `nub --cwd apps/bot src/scripts/check-commands.ts`. It lists global and configured-server commands, their default permissions, contexts and installation types, and reports any missing local commands. Command registration does not confirm that a particular user's Discord client shows the command: server integration overrides and channel permissions can still restrict access.

## Références

- Registre : [`src/core/command-registry.ts`](src/core/command-registry.ts)
- News : [`../../docs/netmarble-news-operations.md`](../../docs/netmarble-news-operations.md)
- YouTube : [`../../docs/youtube-videos-operations.md`](../../docs/youtube-videos-operations.md)
