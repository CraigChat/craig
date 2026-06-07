# Contributing

Thanks for considering contributing!

A few rules of thumb:
- This repository uses Yarn for the TypeScript workspaces.
- Install the Python pre-commit hooks before working on TASMAS changes:
  - `pip install pre-commit`
  - `pre-commit install`
- Code contributions should match the existing code style.
  - `yarn lint` to check the formatting
  - `yarn lint:fix` to fix some of the issues
  - `ruff check tasmas tests` checks Python linting.
  - `ruff format tasmas tests` formats Python files.
  - `pyright tasmas/ tests/` checks Python types.
- Before opening a PR, run `pre-commit run --all-files` and the relevant tests for your changes.
- Make sure to run your own instance and ensure minor/major/dependency changes work correctly.
