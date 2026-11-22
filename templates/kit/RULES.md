# HLens Rules

This project records the intent, implementation and behavior of each feature in the `.features/` folder.
When you change code, update the related feature folder in the same task.

A **feature** is the unit of work the user asks for. A new request creates a feature folder.
A follow-up request that touches the same area updates that folder instead of creating another one.

## When to update

- When you implement a new feature, create a new feature folder.
- When you change an existing feature, rewrite its files to match the current code.
- When you delete a feature, delete its folder entirely.
- If a feature folder contains `.review.md`, it is a review comment. Apply it to the code and the feature files, then delete `.review.md`.

## Folder layout

```
.features/
  config.json              # project-wide settings (root only)
  login/                   # feature id = path, kebab-case
    intent.md              # intent
    implementation.mm.md   # implementation mind map
    scenario.spec.ts       # behavior scenario (web); ios/android use scenario.dart
    meta.json              # status, owned files
    social/                # sub-feature (login/social)
      ...
```

- Only folders that contain `meta.json` are features. Folders without it are plain groups.
- Nest at most 3 levels deep.

## Language

Write feature documents in the language the user writes in. Keep the fixed section headings below in English.

## intent.md

Describes why the feature exists and what it does.

- Use exactly three sections: `Purpose`, `User flow`, `Decisions`.
- In `Decisions`, state the rules and constraints that are actually in the code, concretely. (e.g. locked for 10 minutes after 5 failures)
- Prefer what the user told you. Never write down guesses.
- If the intent cannot be determined from the code alone, add a `Needs confirmation` section with questions for a human. When they answer, fold the answer into the body and delete the section.

## implementation.mm.md

Describes how the feature is implemented, as a Markmap mind map.

- Use exactly four top-level groups: `Screens`, `API`, `State`, `Impact`. Delete a group that does not apply; do not leave empty nodes.
- No sentences. Nodes are names or short keywords only.
- Link file nodes with a path from the project root. Example: `[LoginForm](/src/pages/login/LoginForm.tsx)`
- Under `Impact`, list other features that must be re-checked when this one changes, and link sub-features.

```md
# Login

## Screens
- [LoginPage](/src/pages/login/LoginPage.tsx)
  - [LoginForm](/src/pages/login/LoginForm.tsx)

## API
- `POST /auth/login`
  - failure count in response

## State
- [useAuthStore](/src/stores/auth.ts)
  - failCount

## Impact
- [Social login](social/implementation.mm.md)
- Password reset
```

## Scenario

A scenario is a script that records how the feature actually behaves.
`platform` in `config.json` decides which file is used. If omitted, it is detected from the project (`pubspec.yaml` with flutter means `ios`, otherwise `web`).

| platform | File | Run and recording |
|---|---|---|
| `web` | `scenario.spec.ts` (Playwright) | Playwright records the browser |
| `ios` | `scenario.dart` (Flutter `integration_test`) | the simulator is recorded with `simctl` while `flutter test` runs |
| `android` | `scenario.dart` (Flutter `integration_test`) | the emulator is recorded with `screenrecord` while `flutter test` runs (3 minutes max) |

Common rules:

- One test per feature.
- Split the test into steps by user action. Keep step names short.
- Assert (`expect`) after each meaningful change on screen so a person watching the video can follow along.
- Put shared setup such as login in `auth` from `config.json`; do not repeat it in scenarios.
- Never perform irreversible actions (account deletion, payment, deletion of data). Verify up to the confirmation screen only.

`web` (`scenario.spec.ts`):

- Wrap each user action in `test.step`. Step names become the chapter names of the video.
- Prefer selectors in this order: `getByRole`, `getByLabel`, `getByText`.
- `auth` is a Playwright setup file. After logging in, it saves `storageState` to `.features/.auth/state.json`.

`ios`, `android` (`scenario.dart`):

- Use `IntegrationTestWidgetsFlutterBinding` and exactly one `testWidgets`.
- Separate steps with `// Step: name` comments.
- Prefer finders in this order: `find.byKey`, `find.bySemanticsLabel`, `find.text`.
- `auth` is a Dart helper file. Call `Future<void> signIn(WidgetTester tester)` once at the very start of the scenario.
- The run command can be changed with `testCommand` in `config.json` (default `flutter test {scenario} -d {device}`).

## meta.json

- `name`: the feature name shown in the UI
- `status`: `draft` | `review` | `approved`
  - Set `review` when you create or modify a feature.
  - Only a human sets `approved`.
- `files`: code paths owned by this feature (globs allowed)
  - Never list the same file under two features. Do not list a sub-feature's files in its parent.
- `sourceHash`: managed by tooling. Do not edit it.

## Keep it clean

- Always overwrite feature files with the current state. No history phrases such as "previously" or "changed in v2". Put the reason for a change in the commit message.
- Do not commit `.out/` (videos and other generated files), `.playwright.config.cjs`, `.auth/` or `.review.md`.
- In code, do not leave the old implementation as comments, unused functions, or TODOs that are already done.
- Finish one round of review feedback in a single commit.

## Full scan

The procedure for filling `.features/` for the first time, or re-aligning it.

1. Skim routes, pages, API modules and stores, and split features by **what the user does**. Do not mirror the folder structure.
2. Keep top-level features to 20 or fewer; split big ones into sub-features.
3. Never delete existing feature folders. Add only the missing ones, and fix existing ones only when `files` or the implementation mind map differ from the current code.
4. For each feature create `meta.json`, `intent.md`, `implementation.mm.md` and the scenario file for the current `platform`, following the rules above. Set the new feature's `status` to `draft`.
5. Do not modify source code in this procedure. Write only under `.features/`.
6. When done, summarize the features you created and the ones that have `Needs confirmation` questions.
