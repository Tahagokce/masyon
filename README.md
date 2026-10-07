# Jira → Gemini → fork-backed Playwright MCP

Phase 1 implementation for sequential Jira CSV execution, browser verification,
action-code recording and execution reports. Python orchestrates the official
Google GenAI SDK (`gemini-2.5-flash`) and official MCP Python client. A small Node
MCP bridge loads browser tools and selector generation directly from your built
Playwright fork. No standard Playwright package is installed by this project.

**Acceptance status:** local browser/MCP recording and replay have been tested.
The real Gemini/application/Jira run and the user's ID-first fork remain unverified
because those inputs were not supplied. See [test results](docs/TEST_RESULTS.md).
The example CSV is a synthetic fixture, not a real Jira export.

## Local setup

Requirements: Python 3.11+, Node 20+ (tested with Node 24), a built custom fork
containing the current MCP/core APIs, and its installed Chromium browser (or an
explicit compatible Chrome executable).

```sh
cd /Users/sahih/Downloads/masyon
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock.txt
.venv/bin/python -m pip install --no-deps -e .
npm ci --ignore-scripts
```

The verified upstream API baseline is `@playwright/mcp@0.0.83` /
`playwright-core@1.64.0-alpha-1790635538000`. Your fork needs the equivalent built
`lib/coreBundle.js`, `tools.createConnection`, `tools.parseResponse`, and
`tools.Tab.forPage` APIs. Follow your fork's build instructions. An older fork
requires bringing these MCP changes into the fork and rebuilding. This project
will not substitute an upstream library or modify your fork automatically.

Set environment variables using your shell or secret manager. Do not put real
values in source files or command arguments. `.env.example` documents all options;
the runner does not automatically read `.env` files.

```sh
export PLAYWRIGHT_FORK_PATH=/absolute/path/to/your/built-playwright-fork
export WBS_BASE_URL=https://your-test-application.example
# Set GEMINI_API_KEY, WBS_USERNAME and WBS_PASSWORD securely in the environment.
# Optional, when not using the fork's installed Chromium:
export PLAYWRIGHT_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

# Check real stdio MCP startup and ID-first generation without calling Gemini.
.venv/bin/python check_fork.py

# Execute a real Jira CSV. No interactive input is needed during execution.
.venv/bin/python main.py /absolute/path/WBT-10891.csv
```

Required: `GEMINI_API_KEY`, `PLAYWRIGHT_FORK_PATH`; application credentials for
login steps. `WBS_BASE_URL` is needed only when the URL is not in the case.
`SECRET_ENV_NAMES` defaults to `WBS_USERNAME,WBS_PASSWORD`; add any additional
browser secrets there. Only names are sent to Gemini. Never add `GEMINI_API_KEY`
to browser secret names.

`PLAYWRIGHT_MCP_COMMAND` optionally overrides the default
`["node", "/absolute/path/to/this/project/bridge/server.mjs"]` as a JSON argv
array, without shell evaluation. It must start this fork-aware bridge or a
compatible implementation of its control tools. Bare `npx @playwright/mcp` is
rejected. `HEADLESS=false` opens a visible browser. Call and timeout budgets are
listed in `.env.example`.

Exit codes: **0 SUCCESS**, **1 FAILED**, **2 BLOCKED**. Missing prerequisites,
ambiguous intent, budget exhaustion and uncertain outcomes are BLOCKED. A failed
browser assertion is FAILED. No later Jira step executes after failure/blocking.

## CSV and outputs

UTF-8 (with optional BOM), comma or semicolon, quoted multiline fields. Supported
column aliases include Action/Test Step, Data/Test Data, Expected Result/Expected
Results, Issue Key/Jira Key, and optional Step Number. One case per file. Jira key
priority is `--jira-key`, CSV content, then filename; conflicting CSV keys fail.

```sh
.venv/bin/python main.py examples/DEMO-1.csv --normalize-only
.venv/bin/python main.py /path/case.csv --jira-key WBT-10891 --output-dir outputs/run-02
```

Each run creates:

```text
outputs/WBT-10891/
  normalized-test-case.json
  recording.spec.ts
  execution.json
  run.log
```

An existing case directory is never overwritten. Choose a new `--output-dir` for
reruns. Reports include attempted steps, unexecuted step numbers, generated values,
page/opener relationships, fork path/version/hash and ID-first probe results,
recording completeness, Gemini request/token counts, browser-facing tool counts,
and underlying MCP calls. Failure recordings preserve available action code and
end in an explicit failure. When no recording was obtained, the `.spec.ts` is an
explicitly failing diagnostic marker, never a claimed successful recording.

Use the **fork's Playwright test distribution** to replay the generated spec.
Its test project must resolve `@playwright/test` and `playwright-core` to your
fork; do not install unqualified npm Playwright as a shortcut. Replay requires
the same credential environment variables. The application may need resetting
before replay because recorded values and actions are reused exactly.

## How execution and recording work

See the pre-implementation inspection and [implementation plan](docs/IMPLEMENTATION_PLAN.md).

* `src/jira`: CSV normalization and immutable step models.
* `src/gemini`: official SDK requests, bounded function calling and system rules.
* `src/mcp`: actual child-process stdio transport and isolated environment.
* `src/runner`: sequential step orchestration, verification gates and checkpoints.
* `src/state`, `src/security`, `src/recording`: reusable values, redaction and export.
* `bridge`: fork-only loading, real upstream MCP server, page events and codegen capture.

The preflight performs real MCP input/button actions on a local fixture using
accessibility references. Both generated locators must prefer the fixture's IDs.
This tests the loaded code's behavior, not merely a configured pathname.

Recording starts before step 1 and stops in a `finally` block. It captures code
generated by the fork for **actual MCP operations**. The GUI recorder is intended
for manual gestures; `--save-session` is a transcript, not a runnable spec. The
bridge uses the fork's response parser for code-bearing responses. In this version,
JSON mode implies raw mode and excludes generated code, so JSON is used only for
explicit structured snapshots. Model-written guesses never become action code.

The bridge observes browser page/dialog events, maintains stable aliases, selects
new pages in MCP, and inserts listeners before the action that caused a popup or
dialog. TypeScript AST rewriting preserves string literals while rebinding page
references. The final TypeScript receives a syntax check; the supplied integration
harness can additionally replay it in a real browser.

`browser_assert` is a constrained trusted tool. It obtains a fork-generated locator
through MCP, then performs a fixed assertion loop through upstream MCP's code tool.
It checks actual visibility, text, value, checked/enabled state or exact URL. Gemini
cannot submit arbitrary JavaScript. Assertions produce evidence IDs. Completion
requires successful operations and relevant evidence produced after the latest
mutation. The model still judges whether its assertions cover the Jira requirement;
the mechanical gate cannot prove natural-language business semantics.

## Context and secrets

Only the current step, generated values, short previous-state summary, page aliases
and recent complete tool exchanges are sent to Gemini. Routine action responses do
not contain snapshots. Explicit snapshots are capped at 8,000 characters with a
visible truncation indicator; scoped snapshots are available. History has four
exchange pairs and a 20,000-character pruning target; oversized individual batches
stop at 30,000 characters. Tool-call count and step deadlines prevent infinite loops.

Browser fill tools receive environment variable **names**. MCP resolves them in
memory and generates `process.env['WBS_PASSWORD']!`, etc. Known secrets and common
encodings are scrubbed from browser results and persisted outputs. Code containing
secrets/redaction markers is rejected, rather than exported as a broken replay.
Logs contain tool names/statuses and generated values, not model transcripts,
arguments, snapshots or raw exception messages. Console persistence and incidental
MCP file output are disabled. No screenshot, trace, video or storage-state tools
are exposed. Gemini's API key is never forwarded to the browser child process.

Register all browser credentials with `SECRET_ENV_NAMES`. Pattern-based masking is
not a universal detector for arbitrary sensitive text rendered by an application.
Use a dedicated test environment/account and avoid sensitive business data in CSV
content intended for Gemini.

## Tests and current limitations

```sh
.venv/bin/python -m unittest discover -s tests -v
npm test

# Real fork + real browser/MCP integration; no Gemini call:
PLAYWRIGHT_FORK_PATH=/path/to/built/fork node tests/live_contract.mjs
# Optional replay in a test project resolving @playwright/test to the same fork:
# CONTRACT_OUTPUT=/path/to/fork-test-project
# CONTRACT_REPLAY_CLI=/path/to/fork/packages/playwright/cli.js
```

`tests/live_contract.mjs --upstream-contract` is explicitly a developer contract
test for standard upstream Playwright. It must demonstrate that production
preflight rejects that installation. It directly tests the journal separately;
it cannot make a production run bypass preflight and is not POC acceptance.

Known limits:

* No real Gemini/application acceptance run without the supplied inputs. Unit
  protocol test doubles are labeled as such and never used by the runner.
* Fork adapter uses version-dependent MCP/private APIs. Unsupported builds stop.
* One isolated Chromium session and one recording per run. MFA/CAPTCHA or unclear
  business actions require BLOCKED. No file upload/download workflows in Phase 1.
* A late popup is attributed to the most recent mutating operation. Spontaneous
  popups without an originating action invalidate recording completeness.
* Hidden checks need a resolvable element/selector; fully removed targets whose
  prior reference cannot be resolved cannot be verified by that assertion.
* Failed calls can have partial browser effects. No automatic action retries;
  reports and partial recordings do not imply transactional rollback.
* A process kill, unavailable bridge or failed code secret scan can prevent
  recording export; checkpoints preserve the report and flag unavailable recording.
* No Java, Cucumber, Jira API, RAG, CI, Git commits or PR creation.
