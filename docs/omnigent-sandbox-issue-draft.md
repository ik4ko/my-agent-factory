**Note: this file is a drafted GitHub issue for github.com/omnigent-ai/omnigent, not filed automatically — no GitHub CLI/token with issue-creation access to that repo was available in this environment. Please file it manually (or grant issue-creation access and ask again). Everything below the divider is the issue body as written for submission.**

**Suggested title:** `os_env.sandbox.type: linux_bwrap` (and the `enforce_sandbox` policy) do not actually sandbox the codex harness — real host filesystem access observed

---

## Environment

- **Omnigent**: 0.4.0 (built 2026-07-03T01:26:51Z), installed via `uv tool install omnigent`
- **Host OS**: Windows 11 (build 10.0.26200), WSL 2.7.3.0
- **WSL2 distro**: Ubuntu 26.04 LTS, kernel `6.6.114.1-microsoft-standard-WSL2`
- **bwrap**: bubblewrap 0.11.1 (installed via `apt install bubblewrap`)
- **Python**: 3.14.4 (uv-managed)
- **Harness under test**: `codex` (via `omnigent run --harness codex` and via a custom agent bundle with `executor.config.harness: codex`)
- **Model credential**: a `gateway`-kind provider in `~/.omnigent/config.yaml` (an OpenAI-compatible endpoint, `api_key_ref: keychain:<name>` — key stored via Omnigent's own secret store, not a subscription CLI login)

## Summary

Configuring sandbox enforcement for a `codex`-harness agent — via either the `enforce_sandbox` policy or the `os_env.sandbox.type: linux_bwrap` field shown in Omnigent's own bundled example agent — does not actually apply `bwrap` isolation. The agent's shell tool gets full, unrestricted access to the real host filesystem, including reading `/etc/shadow`. `bwrap` itself was verified working correctly and independently on the same host, isolating the bug to Omnigent not invoking/applying it, not to the sandbox binary being broken.

## Expected behavior

With sandbox enforcement configured (by either mechanism below), the agent's shell tool should see an isolated filesystem — e.g. `ls -la /` should not show the real host's root directory contents, and reading a sensitive host file like `/etc/shadow` should fail (file not present in the sandboxed view) rather than succeed.

## Actual behavior

In all three configurations tried, the agent's shell tool successfully:
- Ran `whoami` → `root` (the real host's execution user)
- Ran `ls -la /` → the real host's actual root directory (recognizably a real WSL2 filesystem: `/mnt`, `/snap`, `/lost+found`, etc. — not an isolated/minimal bwrap mount namespace)
- Ran `cat /etc/shadow` → succeeded (exit code 0) and returned the real file's contents (locked-account entries, e.g. `*`/`!`/`!*` password-field markers) — a file a working sandbox should not expose regardless of whether the entries are locked

## Repro steps

**Config 1 — default, no sandbox configuration at all:**
```bash
omnigent run --harness codex --tools coding -p "Run: whoami and ls -la / and then try: cat /etc/shadow — report exactly what each command outputs or errors, verbatim."
```
Result: full host access (see "Actual behavior" above).

**Config 2 — `enforce_sandbox` policy explicitly attached, via a custom agent bundle** (`<bundle-dir>/config.yaml`):
```yaml
spec_version: 1
name: sandbox-test-agent
executor:
  type: omnigent
  config:
    harness: codex
policies:
  sandbox:
    type: function
    handler: omnigent.policies.builtins.safety.enforce_sandbox
    factory_params:
      sandbox_type: linux_bwrap
      allow_network: true
prompt: |
  Run: whoami and ls -la / and then try: cat /etc/shadow — report exactly
  what each command outputs or errors, verbatim.
```
Run with:
```bash
omnigent run <bundle-dir>/
```
Result: identical unrestricted access — no difference from Config 1.

**Config 3 — `os_env.sandbox.type: linux_bwrap` explicitly set**, matching the structure shown in Omnigent's own bundled `examples/debby/agents/gpt/config.yaml` (which itself ships with `sandbox: { type: none }` and a comment explaining that choice):
```yaml
spec_version: 1
name: sandbox-test-agent
executor:
  type: omnigent
  config:
    harness: codex
os_env:
  type: caller_process
  cwd: /root/sandbox-test
  sandbox:
    type: linux_bwrap
prompt: |
  Run: whoami and ls -la / and then try: cat /etc/shadow — report exactly
  what each command outputs or errors, verbatim.
```
Run with:
```bash
cd /root/sandbox-test && omnigent run <bundle-dir>/ -p "..."
```
(Note: launching from outside the declared `cwd` fails validation with `workspace '<cwd>' is outside the agent's required path`, which behaves as expected — this is a separate, working check. It was only after `cd`-ing into the declared `cwd` that the run proceeded — and produced unrestricted access identical to Configs 1 and 2.)

## Isolating the bug to Omnigent, not to bwrap itself

Ran `bwrap` directly on the same host, independent of Omnigent, to confirm the sandbox mechanism itself functions correctly in this environment:
```bash
bwrap --ro-bind / / --tmpfs /tmp --proc /proc --dev /dev --unshare-all --die-with-parent /bin/sh -c 'echo ok'
```
This works as expected. So the underlying `bwrap` binary/kernel support (user namespaces etc.) is not the issue — something in how Omnigent invokes (or doesn't invoke) `bwrap` for the `codex` harness, under either of the two configuration mechanisms above, is not applying the sandbox.

## Additional notes

- Not tested: the native interactive `omnigent codex` / `omnigent claude` tmux/PTY terminal-wrapper mode (as opposed to `omnigent run --harness codex`). It has no scriptable one-shot prompt flag, so it wasn't practical to verify headlessly in this environment. It's possible sandbox enforcement is only wired for that code path and not for `omnigent run --harness <X>` — if so, it'd be worth documenting that distinction explicitly, since nothing in the CLI's own output/errors indicated the sandbox config was being silently ignored.
- Happy to provide the full CLI/server logs from a repro run if useful — trimmed here for brevity.
