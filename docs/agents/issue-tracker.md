# Issue tracker: Forgejo

Issues and specs for this repo live as Forgejo issues on `git.sbrn.eu/simonbrunou/mailysleguilloux` (the `origin` remote). The `github` remote is a push-disabled mirror. GitHub Issues are enabled there but unused. Never file issues there.

Use the [`fj`](https://codeberg.org/forgejo-contrib/forgejo-cli) CLI (v0.7.0) for everyday operations. The clone has two remotes and T3 worktree branches have no upstream, so `fj` cannot infer the repo on its own and fails with `no repo info specified`. Point it at the repo explicitly:

- `fj issue` takes `-R origin` either after `issue` or after the subcommand: `fj issue -R origin view 12` and `fj issue view -R origin 12` both work. Before `issue` (`fj -R origin issue ...`) it still fails with `unexpected argument '-R' found`.
- `fj pr` takes `-R origin` right after `pr`, before the subcommand: `fj pr -R origin view 12`. After the subcommand (`fj pr view -R origin 12`) it fails with `unexpected argument '-R' found`. The old `fj -H git.sbrn.eu pr view simonbrunou/mailysleguilloux#12` form still works.
- `fj repo labels` takes the repo as an argument and also needs the host: `fj -H git.sbrn.eu repo labels simonbrunou/mailysleguilloux view`.

`fj` has no JSON output. It has dependency commands: `fj issue -R origin depend list <n>`, `depend add <issue> <target>...` and `depend remove`, the same under `block`, and under `fj pr` with the PR passed as `-p <n>` (`fj pr -R origin depend list -p <n>`). Only the `list` commands have been run against this Forgejo. For JSON and for adding a dependency, call the Forgejo REST API with the token `fj` already stores:

```sh
FJ_TOKEN=$(jq -r '.hosts["git.sbrn.eu"].token' ~/.local/share/forgejo-cli/keys.json)
API=https://git.sbrn.eu/api/v1/repos/simonbrunou/mailysleguilloux
curl -s -H "Authorization: token $FJ_TOKEN" "$API/issues/<n>"
```

Never print the token. The `curl ...` shorthand below means the authenticated call above.

`fj` output contains invisible U+2068/U+2069 isolate characters that break plain `grep`. When you need to check a result, read it from the API with `jq`.

## Conventions

- **Create an issue**: `fj issue create -R origin "<title>" --body-file <file>`. Write multi-line bodies to a temp file with a heredoc. `fj issue create` has no label flag, so apply labels right after creating.
- **Read an issue**: `fj issue view -R origin <n>` for the body, `fj issue view -R origin <n> comments` for the comments. For JSON with labels: `curl ... "$API/issues/<n>" | jq '{number, title, body, state, labels: [.labels[].name]}'`.
- **List issues**: `fj issue search -R origin --state open --labels <label>`. For JSON: `curl ... "$API/issues?state=open&type=issues&labels=<label>&limit=50" | jq '[.[] | {number, title, labels: [.labels[].name]}]'`. Keep `type=issues`, because without it the endpoint also returns PRs.
- **Make an issue a child of a parent**: Forgejo has no sub-issues. Put `Part of #<parent>` at the top of the child body and add the child to a task list in the parent body.
- **Comment on an issue**: `fj issue comment -R origin <n> "..."`, or `--body-file <file>` for multi-line comments.
- **Apply / remove labels**: `fj issue edit -R origin <n> labels --add "..."` / `--rm "..."`. Repeat the flag for several labels. An unknown label prints `'X' doesn't exist` and still exits 0, so confirm the labels with the API afterwards.
- **Close**: `fj issue close -R origin <n> --with-msg "..."` posts the message as a comment, then closes. Always give `--with-msg` a value; a bare `--with-msg` may open an editor.

Renovate owns the "Dependency Dashboard" issue. Leave it out of triage.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `fj pr` equivalents:

- **Read a PR**: `fj -H git.sbrn.eu pr view simonbrunou/mailysleguilloux#<n>`, with `comments` or `diff` appended for the rest.
- **List external PRs for triage**: `curl ... "$API/pulls?state=open" | jq '[.[] | select(.user.login | IN("simonbrunou", "renovate") | not) | {number, title, author: .user.login, labels: [.labels[].name]}]'`.
- **Comment / label / close**: `fj -H git.sbrn.eu pr comment|edit|close simonbrunou/mailysleguilloux#<n> ...`, with `edit ... labels --add`/`--rm` for labels.

Forgejo shares one number space across issues and PRs, so a bare `#42` may be either. Resolve it with `curl ... "$API/issues/42" | jq .pull_request`: a non-null value means a PR.

## When a skill says "publish to the issue tracker"

Create a Forgejo issue on `origin`.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

The `wayfinder:*` labels exist on the repo (`map`, `research`, `prototype`, `grilling`, `task`); check with `fj -H git.sbrn.eu repo labels simonbrunou/mailysleguilloux view`.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. Create it with `fj issue create`, then add the label.
- **Child ticket**: an issue with `Part of #<map>` at the top of its body, listed in a task list in the map body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: Forgejo's native issue dependencies, enabled on this repo and visible in the UI. Mark `<child>` as blocked by `<blocker>` with `curl -s -X POST -H "Authorization: token $FJ_TOKEN" -H 'Content-Type: application/json' "$API/issues/<child>/dependencies" -d '{"owner":"simonbrunou","repo":"mailysleguilloux","index":<blocker>}'`. The `index` is the blocker's `#number`, not a database id. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children, then drop any with an assignee or an open blocker (`curl ... "$API/issues/<child>/dependencies" | jq '[.[] | select(.state == "open")] | length'` is above 0). First in map order wins.
- **Claim**: `fj issue assign -R origin <n> simonbrunou`, the session's first write.
- **Resolve**: `fj issue close -R origin <n> --with-msg "<answer>"` (it posts the answer as a comment, then closes), then append a context pointer (gist + link) to the map's Decisions-so-far.
