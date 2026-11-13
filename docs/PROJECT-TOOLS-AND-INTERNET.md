# Build and use project tools, connectors and internet sources

The execution path is: choose a useful action, build or reuse the needed software, run it, inspect the result and continue. A plan, pitch or document is not a substitute for that action.

## Turn on a real executor

1. Sign into **Codex / ChatGPT** in **Models & sign-in** and check coding sandbox readiness.
2. Pause the project. In its **Selected project model** panel, keep your local model as the planning connection, check **Use Codex to build and run project tools**, enter your configured Codex model ID, and click **Use this model for this project**.
3. The panel and project banner now distinguish the planning model from the task executor. Planning and optional meetings use the first model; **all task roles** explicitly use the Codex executor and its subscription allowance. This is a saved selection, not an automatic paid fallback. Saving it makes no inference request.
4. In **Edit plan**, enable **Allow tool network** when the work needs internet access. Enable **Allow Codex web research** for read-only discovery/search. These are separate from Creative exploration. Use **Creative exploration** when the team should challenge its approach and invent alternatives.
5. If the old plan only describes text deliverables, edit it to request concrete implementation/review/testing, or use **Restart project → Create a new model-generated plan**. The saved brief and old run remain available. The planner now sees the real file/command capability and should plan the next verifiable milestone rather than a speculative document chain.

You can instead select Codex directly as the project model and enable **shared coding folder and commands**. The separate executor is useful when keeping local planning. There is no confidence-based automatic per-agent model router.

Project tasks remain serial within a shared coding folder. A read-only coordinator on the explicitly configured hybrid executor can request a **separate builder** to implement a needed utility, then use a reviewer's saved result. It does not gain direct write access itself. Design-only restrictions remain in force.

## Reusable tool library

Managed workspaces contain actual executable utilities and machine-consumed configuration:

- `tools/workroom-tools.json`: tool commands, inputs, purposes and the extension protocol. It is a catalog, not a claim that agent-generated tools passed tests.
- `tools/network-policy.json`: default and per-host network policy.
- `tools/network.mjs`: a GET client that agent-authored connectors can import.
- `tools/workroom-download.mjs`: an image download command.
- `tools/workroom-crawl.mjs`: a scoped HTML crawler and local index search command.
- `tools/workroom-tools.mjs`: checked tool promotion, rollback and Workroom patch preparation.

They are installed when a workspace is enabled, created/restarted or dispatched for work. Existing user/agent edits are not overwritten. They are software/configuration, not sample projects or canned work results. View them in the project's source files or local `.data/projects/.../tools` folder.

Each tool-enabled role is instructed to read the catalog, prefer an existing suitable tool/repository, and build a project-owned utility when needed. It should check the candidate with the lifecycle command below, then use the registered tool for the current goal. A future task can inspect and reuse the same code. Tools and results stay in the project folder and retain the normal workspace file/sandbox boundaries.

## Intelligent source selection before requests

Before bulk access, the executor is instructed to research the site's official API, access requirements, documented quotas and available data sources. It should record the source and configure the relevant host rule. A suitable cache, archive, indexed excerpt, export or dataset may be more useful than the original page; availability must be checked rather than invented. Google's former cached-page feature is not assumed to exist. Robots handling is a separate explicit crawl setting described below.

For GitHub reuse, the executor can search for repositories with Codex web research, inspect licenses/dependencies/install scripts, clone into this project, install needed dependencies and test the candidate in the managed workspace. Network must be enabled. Repository text is untrusted project data; it does not change Workroom permissions. No particular repository or install script is executed merely by saving settings.

The network client then enforces the chosen policy programmatically:

- A host can be `api-only` or `blocked`, with `preferredSources` explaining the actual API/cache/dataset alternative. Those rules can prevent a direct request before it is sent. `disallowPaths` records excluded path prefixes, including applicable robots/site rules.
- Requests are sequential per client. Per-host pacing is shared through the project's persisted host-state file and exclusive request lock. Other clients return `NETWORK_BUSY` rather than racing the same state or sending parallel requests. A configured site interval can be stricter than the default; stricter limits take effect on the next request.
- Common `RateLimit-Remaining` / `X-RateLimit-Remaining` and reset headers adjust pacing; zero remaining stops the next network request until reset.
- `Retry-After` and persisted host pauses prevent immediate reruns after a rate limit. 401/403/429, server failures and transport failures are not automatically retried. The agent can inspect the reason and choose an appropriate permitted source or real authentication setup.
- Cached GET responses avoid requests; ETag/Last-Modified enable conditional requests and 304 reuse. Cache-Control no-store/no-cache/max-age are respected. Cached data is labeled; it does not become newly verified source material.
- Redirects count against the request budget and undergo URL checks. Response sizes and timeouts are bounded. No URL credentials, direct IP literals or local hostnames are accepted by this utility.

Example host configuration **after the agent has checked the actual site policy**:

```json
{
  "minIntervalMs": 1000,
  "maxRequests": 100,
  "hosts": {
    "the-site-you-checked.example": {
      "access": "api-only",
      "policySource": "The actual documentation URL the agent inspected",
      "preferredSources": ["The actual permitted API or dataset URL"]
    }
  }
}
```

This is a configuration example, not a default site rule or a fabricated source. Site policies differ, and a 403 can also mean authentication/access restrictions rather than request frequency. The client records that distinction without retry storms or traffic disguise.

## Download images to a real folder

Give the team a concrete brief, for example: “Find appropriate image sources, inspect their published access rules, and download the requested images into a project folder. Reuse or build a paced connector. Verify the downloaded files and report missing items rather than substituting invented results.” State relevant source/licensing requirements and the desired quantity.

The agent creates a JSON array of **actual** HTTPS image URLs from its research, then can run:

```bash
node tools/workroom-download.mjs --urls image-urls.json --output images
```

The command writes image files and `images/download-index.json`, containing source URLs, byte counts and SHA-256 checksums. Successful files are preserved if access is blocked. A rerun skips files whose checksums still match, instead of repeatedly downloading them. Failed/partial work exits nonzero; the caller should inspect the receipt and host policy before continuing. Existing files are not overwritten.

For a Node installation using an inherited HTTP(S) proxy, use current Node 24 LTS with `NODE_USE_ENV_PROXY=1` configured at process start or `node --use-env-proxy ...`. Preserve supplied proxy/CA settings. Codex worker environments are deliberately restricted; a proxy that requires additional credentials needs separately supported configuration, rather than copying browser/server secrets into a project.

## Crawl a site and reuse its data

The engineer can run these commands inside the managed project folder:

```bash
node tools/workroom-crawl.mjs --start https://the-site-you-selected.example/docs/ --output site-index --max-pages 100 --max-depth 3 --robots ignore
node tools/workroom-crawl.mjs --search "the information needed" --output site-index --limit 5
```

The first command writes actual page text, titles, source URLs, checksums and fetch times to `site-index/search-index.json`, plus `crawl-state.json` for resume. The second searches the saved data locally without another site request. Agents can read those results and use them as evidence or input to another tool. This is a static HTML connector; JavaScript-rendered pages or specialized APIs need a suitable additional connector.

`crawlRobots` in `tools/network-policy.json` defaults to `"ignore"`, as requested. `--robots ignore` skips robots.txt entirely; `--robots respect` checks it and applies disallow/allow rules and crawl-delay. The receipt records the chosen mode. Either mode keeps request pacing, published-rate feedback, cache reuse, access-error pauses and same-origin/path redirect checks. It does not turn an authentication failure into access. HTML/header noindex and nofollow directives are honored separately.

The crawl stays in the start URL's origin and directory path prefix, skips query links and fragments to avoid crawl traps, and follows links only to the selected depth. Page text clipping is labeled with original length. It saves completed pages when blocked rather than starting from scratch. Rerun with the same start URL, output folder and robots setting to resume; increase `--max-pages` if the total page allowance was reached. Use a new output folder for a new source, changed robots mode or a fresh crawl. A per-output lock prevents concurrent checkpoint writes.

Visible command limits: pages default 25 (1–1,000 total across resumes), depth default 2 (0–10), text per page default 100,000 characters (1,000–1,000,000), pending queue 10,000, search results default 5 (1–50). `--max-text-chars`, `--max-depth` and `--max-pages` adjust them; run `--help`. Exit 2 means paused or partial work; the receipt identifies the reason and saved paths. The HTTP request budget also includes redirects and any robots fetch.

`userAgent` defaults to `WorkroomProjectTool/1.0`. Set a stable application identifier with optional project contact information in the policy. The client does not rotate identities or impersonate a crawler to evade an access refusal.

## Safely add or improve tools

The engineer develops a candidate separately from the working tool and writes a meaningful Node behavior check. The check receives the candidate path as `process.argv[2]`; it should execute/import that candidate and assert the intended behavior, including relevant failures. Then:

```bash
node tools/workroom-tools.mjs promote --candidate candidates/new-tool.mjs --target tools/my-tool.mjs --check checks/my-tool-check.mjs --id my-tool --purpose "The actual function this tool provides"
```

The manager runs syntax and behavior checks, captures actual output/exit status, and only installs/registers the candidate when both pass and checked files have not changed during testing. Existing tool and catalog versions are retained under the returned `.workroom-tools/<revision>` folder. Failed checks do not promote the candidate. The catalog records the installed checksum and check receipts; another agent can inspect and use the command. Independent review remains appropriate for important changes; passing a trivial test does not establish broad correctness.

Checks receive a temporary candidate beside the intended target, using the target's module extension. Relative imports and Node module format are therefore checked in the installation context while the active tool stays in place.

To restore the previous version:

```bash
node tools/workroom-tools.mjs rollback --revision .workroom-tools/REPLACE_WITH_RETURNED_REVISION
```

Rollback preserves unrelated tool entries and refuses to overwrite subsequent manual changes. Checks run inside the existing project worker sandbox, not a new sandbox; check scripts can have side effects and should use temporary fixtures. The lifecycle manager cannot replace its own active file through promotion.

## Prepare changes to Workroom itself

The engineer can clone Workroom **inside the managed project**, modify that separate checkout, install its dependencies, stage intended new files, and run:

```bash
node tools/workroom-tools.mjs propose-core --repo workroom-checkout
```

This executes `npm run build` and `npm test` in that checkout. Changes to UI, shared logic, server/runtime, dependencies or browser tests also require `npm run test:e2e`. It captures each command and confirms the patch/base did not change during checks. Missing or failing checks produce `readyForReview: false`; the patch is still saved for diagnosis. Environment files, credentials and generated/runtime directories are excluded from eligible patches. Untracked new source files must be inspected/staged first so they cannot silently disappear from a patch.

`tool-proposals/<revision>/workroom.patch` and `checks.json` are visible in the project's source files/export. Review them against the recorded base commit before applying to your main Workroom checkout. This tool prepares a checked integration patch; it does not edit or restart the app that is running the team. It does not commit, push or deploy. Tests reduce regression risk within their coverage; the receipt distinguishes actual checks from broader claims.

All lifecycle paths stay within the project. Each check defaults to a 600,000 ms timeout, adjustable with `--check-timeout-ms` from 5,000 to 3,600,000 ms. Per-command captured output is capped at 4 MiB; timeout/output failures fail the check. Concurrent changes use `.workroom-tools/change.lock`; inspect a stale lock after a crashed process before removing it. Revision evidence is kept locally and hidden from normal source exports; core proposals have a separate visible copy for review.

## Adjustable network limits

Run `node tools/workroom-download.mjs --help` and edit `tools/network-policy.json`. These are separate from Workroom's **model-request** limits.

| Field               | Default | Accepted range / meaning                                                                |
| ------------------- | ------- | --------------------------------------------------------------------------------------- |
| `minIntervalMs`     | 1000    | 250–3,600,000 ms; per-host overrides may be stricter                                    |
| `maxRequests`       | 100     | 1–10,000 per tool run, including redirects; a host can impose a lower additional budget |
| `maxBytes`          | 10 MiB  | 1 byte–100 MiB per response                                                             |
| `timeoutMs`         | 30,000  | 1,000–300,000 ms per request                                                            |
| `cacheTtlMs`        | 600,000 | 0–86,400,000 ms, further restricted by cache headers                                    |
| `blockedCooldownMs` | 900,000 | 1,000–86,400,000 ms when the server supplies no usable retry time                       |
| `maxRedirects`      | 3       | 0–10; each hop consumes a request                                                       |

State/cache lives in `.workroom-http/` and is excluded from browser source exports. These are project-client controls, not an account-wide rate limiter for unrelated projects/programs. Custom tools should reuse this client and its default shared state directory; arbitrary third-party software is not automatically intercepted. Inspect an imported tool's network behavior and configure shared account quotas conservatively.

The bundled connector is for public GET/download work. Authenticated brokerage, payment or donation operations still require a service-specific connector, supported account setup and authorization for its actions. Agents now have a real workspace path to build and test that software; those specific live integrations have not been fabricated or preconfigured.
