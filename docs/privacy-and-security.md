# Privacy and security

For what the plugin itself can and can't do on your computer (no hooks, MCP servers, dependencies or downloads, and how to verify your copy), see [Is it safe to install?](is-it-safe.md).

## What runs where

| Part | Where it runs | What it sends |
|---|---|---|
| Scan, build, updates | your computer (Node.js) | nothing |
| Writing names and descriptions | Claude or Codex, through your session | the files it reads, the same as any other task you give it |
| The map | your browser | nothing. Its layout engine and fonts are bundled into the file, so it works offline |
| The map's server (`serve.mjs`) | your computer, listening on `127.0.0.1` only | nothing on its own |
| Asking questions (Claude Code CLI) | a `claude -p` session on your computer, with your account | your question, and the files Claude chooses to read |
| Asking questions (Codex) | a `codex exec` run on your computer, with your ChatGPT sign-in, not saved to your Codex history | your question, and the files Codex chooses to read |
| Changing a blueprint from the map | the same as asking questions, with Claude Code or Codex; the map's server then writes only the plan's files in `floorplan/` | your request, and the files the AI chooses to read |
| Asking questions (Claude app) | your claude.ai account | the map (names, descriptions, structure), never your source code. Claude asks before publishing it there |
| Exporting a copy | your computer: the map's server writes one HTML file | nothing. You decide who gets the file. It holds the map, plus Health or recent work only if you tick them, and never your folder path, git remotes or source code |
| Floorplan Cloud waitlist (only if you sign up) | the map's server, to Floorplan's waitlist service | the email you typed or chose, and "just me" or "with my team". See [below](#floorplan-cloud-waitlist) |

Floorplan has no analytics or telemetry, no dependencies to install, and no install scripts. Its only outside connection is the opt-in waitlist below, and nothing reaches it unless you sign up. The map's few links to documentation open only when you click them.

The layout engine ([elkjs](https://github.com/kieler/elkjs) 0.9.3, EPL-2.0) and fonts (Inter and JetBrains Mono, SIL Open Font License) are bundled in `skills/floorplan/assets/vendor/` with their licenses, and every build copies them into the map.

## The local server

- By default it listens on `127.0.0.1` only, so other machines on your network can't reach it. Optional authenticated LAN mode is described below.
- Every start creates a random token, which only the map page it serves receives. Asking questions and saving flows require that token, and those requests are refused when they come from another website.
- It answers only to `127.0.0.1` and `localhost` at its own port, so a website that points its own domain at your computer (DNS rebinding) can't load the map or its token.
- Questions run Claude with **read-only** tools: reading files, searching, and the map's own lookup script. It can't edit files or run other commands.
- With Codex, questions run in Codex's **read-only** sandbox: it can read and search, but not write files.
- On a blueprint (a map planned from a PRD), **Change** requests run the same read-only way. The agent replies with the updated plan, and the server itself writes only `floorplan/plan.json`, `floorplan/architecture.json` and `floorplan/recent-work.json`, after checking them, keeping the old copies for Undo.
- It stops by itself two hours after the last tab closes, and `node floorplan/serve.mjs --stop` stops it immediately.

### Optional LAN access

For trusted devices with stable addresses, `--allow-client` replaces key sign-in
with an exact source IPv4 allowlist:

```bash
node floorplan/serve.mjs --lan --public-url http://192.168.1.20:4378 --allow-client 192.168.1.21
```

Comma-separated addresses are supported; wildcards and subnets are not. This
mode never creates an access key or asks the allowed clients to sign in. Host,
Origin and API-token checks still apply. The socket's peer address is used;
forwarded-address headers do not grant access. Behind a TCP proxy, the peer is
the proxy, so the proxy/firewall must separately restrict the original clients.
Do not allow a shared proxy address unless that boundary is restricted too.
`--allow-client` and `--lan-key-file` are mutually exclusive. Loopback management
remains local in either mode.

To use a map from another trusted device on your local network, opt in explicitly:

```bash
node floorplan/serve.mjs --lan --public-url http://192.168.1.20:4378 --port 4378
```

Replace the address with this computer's LAN address. Permit and forward only
this port through your host firewall or VM/WSL host as needed. The server binds
to `0.0.0.0`, but accepts only the configured public Host and the loopback names.
Unlike local mode, it fails if the chosen port is occupied instead of silently
changing the address. `open.mjs` supports the same flags and reuses a matching
server; changing modes or public origin restarts it.

Network browsers must enter an access key before receiving the map, source
metadata, API token, or any API responses. The server creates a random key at
`floorplan/.cache/lan-access-key.txt` with owner-only permissions on POSIX. Read
that private file locally; its value is never printed or embedded in a URL.
An existing key is retained across restarts. `--lan-key-file <path>` selects
another regular file containing a 64-character random hexadecimal key.

Successful sign-in creates an HttpOnly, SameSite=Strict session cookie that
expires after 12 hours. Sessions are revoked when the server restarts. A
same-origin `POST /api/logout` with the map's `x-floorplan-token` revokes that
browser's session. The existing API token and Origin checks still apply after
sign-in. Loopback management remains available to this computer, and network
clients cannot bypass sign-in by sending a loopback Host header. In LAN mode,
raw map files, server state, keys and worksheets are never served as downloads.

HTTP LAN access does not encrypt traffic. Use it only on a trusted network;
for an untrusted network use an HTTPS reverse proxy and configure its exact
`https://` origin (which also enables Secure cookies). This mode is not a
multi-user authorization system: anyone given the key can use the map and Ask
through this computer's coding-agent account. Agent execution remains read-only.

## Floorplan Cloud waitlist

Once a map has been open for two minutes, a card in its bottom-left corner asks whether you'd like an email when **Floorplan Cloud** launches. It's a hosted version with one shared map per team, kept in sync with GitHub. It asks once:
- **Not now** asks again in two weeks.
- **Don't ask again** and signing up both stop it for good, in every project.

Nothing is sent unless you click **Notify me**.

**What's sent:** only the email address in the box, and whether you'd use Floorplan Cloud just yourself or with a team. Nothing about you, your project or your code goes with it.

**Use my Claude email:** this button fills the box with the email of the Claude account your Claude Code is signed in with. Claude Code is asked only at that moment, and you see the address before anything is sent. Nothing is read when you don't click it.

**Where it goes:**
- The map's local server sends it to a small service on Google Cloud Run. You can read its code [here](https://github.com/haydenschmitty/floorplan/blob/4cb4ff9337b2d021abbd52148e25a1e0016f099d/services/waitlist/server.mjs). It's kept in this repo's history rather than in the plugin, so it isn't downloaded when you install Floorplan.
- That service adds a row to a private Google Sheet that only Floorplan's maker, [Hayden Smith](https://github.com/haydenschmitty), can see. The row holds the date, the email and your answer.

**What it's used for:** only to email you when Floorplan Cloud launches, and to gauge whether it's worth building. The list is never sold or shared. Every email on it will include a way to unsubscribe, and you can ask to be removed at any time by emailing [hismith142@gmail.com](mailto:hismith142@gmail.com).

**Your IP address** is used briefly to rate-limit sign-ups and is never written to the sheet. Google Cloud keeps its standard request logs, which include IP addresses, for 30 days.

**Turning it off:**
- Click **Don't ask again**, or
- set the environment variable `FLOORPLAN_NO_PROMPTS=1`.

Your answer is kept in `~/.floorplan/settings.json`.

**How the service is protected:** its address is in Floorplan's public code, so it's built to be harmless if abused.
- It only accepts new sign-ups, and never returns anything from the list.
- A repeat sign-up looks the same as a new one, so nobody can check whether an address is on the list.
- Input is checked strictly and saved as plain text.
- Sign-ups are limited per IP address and overall, and the list has a size cap.
- It runs as a single small instance, so a flood of requests can't run up costs.

## Secrets

The Health check looks for passwords, API keys and private keys in your code, and for `.env` files that would be committed. When it finds one, it records only the file, the line, the kind of secret, and a masked hint like "starts AKIA…, 20 characters". **Secret values are never stored in the map, printed, or sent anywhere**, and Claude is instructed never to repeat them.

Text written about your code is checked too. If a description, label, summary, note or recent-work entry (in `architecture.json`, `descriptions/`, `recent-work.json` and the other files in `floorplan/`), or a comment the scan picked up, holds something that looks like a secret, the build puts it in the map as «hidden» and warns, naming the file and the field but never the value, so you can take it out. Your files are left as they are. It looks for well-known key formats, passwords in database addresses, quoted values given a secret-sounding name, `NAME=value` settings, and long generated-looking strings; ordinary words, file paths, commit hashes and IDs are left alone.

The check is a helpful first pass, not a security audit.

## Maps of code you didn't write

A map shows text Floorplan didn't write: file names, endpoint paths and comments from the code, and descriptions written by an AI or a person. All of it is treated as text, never as part of the page: it's escaped wherever it's shown, it goes into the page's data in a form the browser can't mistake for markup, and characters that are invisible or reverse the text around them (which can make one file name read as another) are shown as a visible marker such as `[U+202E]`. Every map carries a Content-Security-Policy that lets only its own scripts run and keeps an exported copy from contacting anything (see [Is it safe to install?](is-it-safe.md#the-network)). A pattern in `architecture.json` that isn't valid is reported as a build error, and the scan skips config files over 1 MB and reads large files without slowing down.

## Git

Nothing Floorplan creates is committed. See [What's in your project](project-files.md#staying-out-of-git).

## Reporting a vulnerability

Please report security problems privately, as described in [SECURITY.md](../SECURITY.md), rather than in a public issue.
