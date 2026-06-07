> For the Japanese version, see [README.ja.md](README.ja.md).
> Part of the [neko-HQ](https://github.com/aliksir/neko-hq) ecosystem.

# neko-not-yoshi

A PII and customer name scanner. The **last line of defense** before `git push` to public repositories, detecting leaks (personal information, customer names, global IPs) and blocking the push. It catches things the cat can't say "Yoshi!" (= all clear) to. A zero-dependency, in-house tool in the yoshi family.

## Features

- **Zero dependencies** (Node.js v22+)
- **Two NG-word lists**:
  - `ngwords.public.json` — Regex patterns (email / home paths / phone numbers / IPs / local paths). Contains no specific names, safe to publish
  - `ngwords.private.json` — Actual customer and personal names (`.gitignore`d, not published)
- **3-tier severity**: `block` (prevents push = exit 1) / `warning` (report only = exit 0) / allowlist (false positive suppression)
- **IP detection**: Global IP = block / Private, loopback, and subnet masks = warning
- **Masking**: Redacts detected content (dry-run by default, `--write` for actual file modification)

## Installation

```bash
git clone https://github.com/aliksir/neko-not-yoshi.git
cd neko-not-yoshi
```

No dependencies required (zero-dependency design).

## Usage

### scan — Leak detection

    node src/cli.mjs scan <path>                       # exit 1 on block detection
    node src/cli.mjs scan <path> --format json         # JSON output
    node src/cli.mjs scan <path> --no-private          # disable private list
    node src/cli.mjs scan <path> --warnings-as-errors  # treat warnings as exit 1

### add — Register NG words (manual + Claude auto-accumulation)

    node src/cli.mjs add --private "customer name"          # register in private (.gitignore'd)
    node src/cli.mjs add --public "regex" --category pii    # register public pattern

### list — Show registered lists

    node src/cli.mjs list
    node src/cli.mjs list --private

### import — Bulk import NG words

    node src/cli.mjs import words.csv      # CSV (value,category,severity)
    node src/cli.mjs import words.txt      # TXT (one word per line, defaults to custom/block)
    node src/cli.mjs import words.md       # Markdown table (| value | category | severity |)

Duplicates are automatically skipped. All entries are added to the private list.

See [examples/](examples/) for sample import files (CSV, TXT, Markdown).


### export — Export NG words

    node src/cli.mjs export                # CSV to stdout (default)
    node src/cli.mjs export --format txt   # values only
    node src/cli.mjs export --format md    # Markdown table
    node src/cli.mjs export --public       # include public patterns

### mask — Redaction

    node src/cli.mjs mask <path>           # dry-run (preview only)
    node src/cli.mjs mask <path> --write   # modify files in place (git-tracked recommended)

## Scan Scope

- **Default**: Scans git-tracked files + **untracked files not excluded by .gitignore** (equivalent to `git ls-files --cached --others --exclude-standard`), excluding only .gitignore'd files. Scans all files if not in a git repository
- **`--all`**: Full scan including .gitignore'd files
- This ensures untracked new files (potential leaks) are inspected before `git add`, while .gitignore'd local artifacts (execution logs, etc.) are excluded
- **Note**: ASCII matching for private words is case-sensitive (`Acme` registered will not match `acme`). Pay attention to the exact spelling when registering customer names
- **Note**: The `**/test/**` entry in `allowlist.json` is for this project's own test fixtures. **Do not place real personal information in test fixtures** — use RFC 5737 reserved IPs (`203.0.113.x` / `198.51.100.x`) and `example.org` instead (to avoid masking real leaks)

## Completion Gate Integration

Run as part of the completion gate for tasks that involve pushing to public repositories. Confirm exit 0 (zero blocks) before pushing.

    node src/cli.mjs scan <repo> && git push

## NG-Word List Management

- **Public list** (`ngwords.public.json`): Regex patterns only. Safe to include in the repository
- **Private list** (`ngwords.private.json`): Actual customer names. Excluded via `.gitignore`, local-only. Copy `ngwords.private.example.json` to create it
- **Allowlist** (`allowlist.json`): Permits legitimately public information such as OSS author names (scoped by pathGlob). Each entry has an `action`:
  - `"allow"` (default): Full permit (`match` required). Suppresses the finding entirely
  - `"downgrade"`: Demotes `block` to `warning` (`match` optional, scoped by `pathGlob` / `category`). The finding remains in reports but exit 0 (push proceeds) = **nothing is silently missed**. Used to suppress false positives from security detection rules (IOCs and synthetic attack samples under `**/semgrep-rules/**`, which are detection targets rather than actual leaks). The `customer` category is exempt from downgrade (invariant protection)

### IOC Downgrade Rules (Public Threat Intelligence C2 IPs, v0.1.4+)

Security detection tool repositories may hardcode attacker C2 IPs (threat intelligence IOCs) directly in README files or detection scripts rather than under `semgrep-rules/` (e.g., [nextjs-security-scanner](https://github.com/aliksir/nextjs-security-scanner) includes Cisco Talos C2 IPs for CVE-2025-55182 React2Shell in `scan.sh` / `README.md` / `README_ja.md` / `claude-code/SKILL.md`). These are **detection targets, not actual leaks from the repository**, causing false positive blocks.

These are suppressed with **per-IP, file-scoped `downgrade` entries** (see `allowlist.json`):

```json
{"action":"downgrade","match":"<IOC IP>","category":["network"],"pathGlob":"**/scan.sh"}
```

- **Two-layer safeguard**: `match` = specific IOC IP (exact literal, no subnet/wildcard) + `pathGlob` = actual file where the IOC appears. This ensures unlisted real global IPs (including future leaks), real IPs in the same file, and IOC IPs outside the `pathGlob` all remain **blocked** (zero false negatives).
- **`pathGlob` must reference the actual relPath file** (`**/scan.sh`, etc.). Repository names (`**/nextjs-security-scanner/**`) do not work because `cd repo && scan .` strips the repo name from relPaths.
- **Brace expansion `{a,b}` is not supported** (fails silently, causing false negatives). Always list one file per `pathGlob`.
- **Snapshot note**: These entries are snapshots of the target repository at registration time. If the target repository adds or renames IOC files, `allowlist.json` needs to be updated (missing entries result in false positive = over-blocking on the safe side, never false negatives).

**Procedure for adding a new IOC repository** (operational):
1. Run `scan` on the target repository to identify `block`ed IOC IPs and their source files (relPath)
2. Verify that the IP is a **published threat intelligence IOC (Cisco Talos / NVD, etc.) and not an actual leak** — human confirmation required (prevents accidentally allowlisting real leaked IPs)
3. Add `{"action":"downgrade","match":"<IP>","category":["network"],"pathGlob":"**/<file>"}` entries to `allowlist.json` for each IP x source file combination
4. Re-run `scan` to confirm `block=0` and that the IOC IPs appear as `warning` (zero false negatives)

## Disclaimer

NEKO-not-yoshi is an **assistive tool** based on pattern matching and NG-word lists. It does **NOT guarantee 100% complete detection or removal** of personal information, customer names, or confidential data. Unknown patterns, context-dependent secrets, and obfuscated/encrypted data may be missed. **Always have a human review before publishing.** The author assumes no liability for any leaks or damages arising from the use of this tool.

## License

MIT
