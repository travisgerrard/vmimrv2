---
name: CLI multiline content and tags
description: Always use --file for multi-line post content; never pass content inline via npm run cli
type: feedback
---

Always write content to a temp file and use `npm run cli -- add --file /tmp/post.md --tags foo,bar` for any multi-line post content.

**Why:** Passing multi-line strings as inline CLI arguments through npm run is fragile — newlines and special chars can get mangled, and without `--`, npm intercepts `--tags` and disrupts arg parsing.

**How to apply:** Whenever creating a post with more than one line of content, write it to `/tmp/` first with the Write tool, then use `--file`. Always include `--` before subcommand args when using `npm run cli`.
