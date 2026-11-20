# Team Handbook

Use this guide to get the classroom project onto your computer, make a small change, and ask a teammate to review it. You can start with a documentation change or a test before setting up the whole app.

## Get your own copy

A **repository** is the project’s files and change history. To **clone** it is to download a working copy that stays linked to the shared repository on GitHub.

1. Accept the team’s invitation and sign in to GitHub Desktop with the account that has access. Open the [Nova classroom repository](https://github.com/Daniele75491/Tubarao-Event-Management-Nova) on GitHub to check access. If it does not open, ask the maintainer to verify your invitation.
2. In GitHub Desktop, choose **File → Clone Repository**. Select **Tubarao-Event-Management-Nova**, or paste the classroom repository address in the **URL** tab.
3. Choose where to keep the copy on your computer and click **Clone**. Open the folder that contains `README.md` and `package.json` in your editor.
4. Use the [Developer Guide](TECHNICAL.md#run-the-automated-checks) to install the libraries and run the first checks. When you want to try checkout and check-in together, follow its [local database setup](TECHNICAL.md#run-the-whole-app-locally).

Use the classroom repository throughout. The original Tubarão repository and its services are separate. [GitHub Desktop cloning guide](https://docs.github.com/en/desktop/adding-and-cloning-repositories/cloning-and-forking-repositories-from-github-desktop)

## Make and share a small change

A **branch** gives you a place to work without changing the shared `main` branch. A **commit** saves a snapshot of your changes. A **pull request**, or **PR**, asks the team to review your branch and decide whether to merge it into the shared project.

1. **Get the latest copy.** In GitHub Desktop, select `main` under **Current Branch**. Click **Fetch origin** to check for updates, then **Pull origin** if it appears to bring those updates onto your computer.
2. **Create a branch.** Choose **Current Branch → New Branch**, base it on `main`, and give it a short name such as `docs/clarify-check-in`.
3. **Make one focused change.** Check the **Changes** tab to see exactly what changed. Run the relevant checks in the [Developer Guide](TECHNICAL.md#test-a-change-and-troubleshoot). Keep private settings, keys, guest information, and generated files out of the change.
4. **Save and share it.** Enter a short summary in GitHub Desktop and commit to your branch. Click **Publish branch** the first time, and **Push origin** for later commits. A push sends your saved changes to GitHub.
5. **Open a pull request.** Choose **Preview Pull Request** and check that the base, meaning the branch receiving your changes, is the classroom repo’s `main`. Choose **Create Pull Request** and finish in the browser. Explain what changed, why, and which checks you ran. Mention any checks you could not run.
6. **Work through feedback.** Ask a teammate to review. If you make changes, commit and push again on the same branch to update the PR. Merge after team review when you have permission, or ask the maintainer to merge. Switch back to `main` and pull before your next task.

If Git reports a **merge conflict**, two edits need a person to decide how they fit together. Ask the teammate who made the other change if you’re unsure which lines to keep. [Syncing branches](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/syncing-your-branch-in-github-desktop) · [Working with branches](https://docs.github.com/en/desktop/making-changes-in-a-branch/managing-branches-in-github-desktop) · [Opening pull requests](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/creating-an-issue-or-pull-request-from-github-desktop)

## Use Codex safely

Codex can explain a file, suggest a focused edit, or run checks. Start by asking it to explain which files are involved. Work in the local classroom folder on your task branch and read each proposed change before sharing it.

- Ask Codex to follow [AGENTS.md](../AGENTS.md), the project’s rules for changes. Give it one goal, a few relevant files, and the checks you want it to run. [OpenAI guide to AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- Use made-up examples. Keep `.env`, access codes, keys, and real guest information out of prompts, screenshots, and shared logs. Use the local demo only. Leave hosted databases, real payments, real email, and deployments outside the task.
- Keep access limited to the classroom folder. When Codex asks for broader access, read what the action will do before approving it. Handle commits, pushes, and merges yourself after reviewing the changes in GitHub Desktop. [OpenAI guide to permissions and approvals](https://learn.chatgpt.com/docs/agent-approvals-security)
- Read the final changes and the test results yourself. Ask Codex to explain any part you can’t follow, including a permission check or database change.

Example prompt:

> Work in this Nova classroom repository and read AGENTS.md. Explain how a guest resumes checkout after a refresh. Improve the explanation in docs/PROJECT-OVERVIEW.md using a made-up example. Change documentation only, check the links, and show me what changed. Leave GitHub and deployments to me.

## Report a problem

A useful bug report lets a teammate see the same problem. First check [known limits and next ideas](TECHNICAL.md#known-limits-and-next-ideas) in case the behavior is an expected limitation.

Open an issue on the classroom repository if issues are enabled, or use the team’s agreed channel. Include the page and role, steps with made-up data, what you expected, and what happened. Add the branch and any error message after removing private information.
