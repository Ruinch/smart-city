# Issue tracker: GitHub

Issues and specs for `Ruinch/smart-city` live as GitHub issues. Use the `gh` CLI for issue operations.

## Conventions

- Create: `gh issue create --title "..." --body-file <file>`. Use a body file for multiline text.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,body,labels,comments`, with suitable state and label filters.
- Make a sub-issue: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` (`gh` 2.94+). If sub-issues are unavailable, put `Part of #<parent>` at the top of the child issue.
- Comment: `gh issue comment <number> --body-file <file>`.
- Add or remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

Run commands inside this clone so `gh` can infer the repository from the Git remote.

## Pull requests as a triage surface

**PRs as a request surface: no.** Set this to `yes` only if external PRs should enter the request queue.

When enabled, use `gh pr view`, `gh pr diff`, `gh pr comment`, `gh pr edit`, and `gh pr close`. GitHub shares issue and PR numbers, so check which type a number refers to.

## Skill instructions

- “Publish to the issue tracker” means create a GitHub issue.
- “Fetch the relevant ticket” means read its GitHub issue, including comments and labels.

## Wayfinding operations

A wayfinder map is one issue labelled `wayfinder:map`; its child issues are tickets.

- Create tickets as sub-issues of the map. If sub-issues are unavailable, put them in a task list in the map and start each child body with `Part of #<map>`.
- Label tickets `wayfinder:<type>`, where type is `research`, `prototype`, `grilling`, or `task`.
- Record a blocker with GitHub's issue dependency API: `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`. Get the database ID with `gh api repos/<owner>/<repo>/issues/<n> --jq .id`. If dependencies are unavailable, put `Blocked by: #<n>` at the top of the child body.
- To find the frontier, consider the map's open children in map order. Skip tickets with an assignee or any open blocker; the first remaining ticket is next.
- Claim a ticket with `gh issue edit <n> --add-assignee @me`. To resolve it, comment with the answer, close it, and add a context pointer to the map's Decisions-so-far section.
