# Contributing to TT-STUDIO

Thank you for your interest in this project! We want to make contributing as easy and transparent as possible.

If you're interested in making a contribution, please familiarize yourself with our technical [contribution standards](#contribution-standards) outlined in this guide.

Next, request the appropriate write permissions by [opening an issue](https://github.com/tenstorrent/tt-studio/issues/new/choose) for GitHub permissions.

All contributions require:

- An issue:
  - Please file a feature request or bug report under the Issues section to help get the attention of a maintainer.
- A pull request (PR).
- Your PR must be approved by the appropriate reviewers.

## Contribution Standards

### Code Reviews

We actively welcome your pull requests! To ensure quality contributions, any code change must meet the following criteria:

- A PR must be opened and approved by:
  - A maintaining team member.
  - Any codeowners whose modules are relevant to the PR.
- Run pre-commit hooks.
- Pass all acceptance criteria mandated in the original issue.
- Pass the automated GitHub Actions workflow tests.
- Pass any testing requirements specified by the relevant codeowners.

### Pull Request Guidelines

- All PRs must first be merged into the `staging` branch. We use a squash merge strategy for this, meaning that all the individual commits from a feature branch are combined into a single commit when merged. This simplifies the commit history, ensuring that the feature is tracked as a single change while keeping the repository clean and manageable.

- When merging from `staging` into `main`, we do **not** use squashing. This ensures that the full commit history between these branches is preserved.

Please ensure that this process is followed when submitting PRs to keep the repository organized and maintainable.
