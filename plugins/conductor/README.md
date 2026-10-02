# conductor: Remote Control Conductor in Claude Code

A Claude Code plugin that shows the hosts Remote Control Conductor paired with, their Claude
accounts and sessions, in a pane beside the conversation. Select a session to resume, stop or
restart it, or to open it on claude.ai. Stop and restart ask for a second press.

- `/hosts` opens the pane. It refreshes every minute, and on **Refresh** (`r`).
- `/hosts text` answers as text, for `claude -p` and wherever panes don't draw.

It's a mod: it needs Claude Code 2.1.287 or later, in a terminal or the Desktop app's Code tab.

## What it uses

- The hosts the Mac app paired with, in `~/Library/Application Support/ai-profiles/remote-hosts.json`,
  and their tokens in the login Keychain. Pair hosts in the app first; nothing here pairs yet.
- `curl`, `openssl`, `shasum` and `security`, all part of macOS.

The servers have self-signed certificates. Each request goes through curl pinned to the server's
public key, whose hash is taken once from the certificate the pairing recorded (its SHA-256) and
kept in the plugin's store. The token is read from the Keychain by a shell and handed to curl on
stdin, so it never enters the plugin's code or a command line.

## Install

```sh
claude plugin marketplace add marcusadolfsson/remote-control-conductor
claude plugin install conductor@remote-control-conductor
```

Or load it from a checkout for one session:

```sh
claude --plugin-dir plugins/conductor
```

If Claude Code says hooks modules are turned off for installed plugins, set
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in its environment.
