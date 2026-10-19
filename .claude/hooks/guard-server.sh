#!/usr/bin/env bash
# PostToolUse(Edit|Write): server.js (the header policy) + contact-intake.js are the site's whole
# dynamic + security surface, and their tests assert exact strings against them. Surface the
# invariants + test-sync need.
input=$(cat)
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
case "$path" in
  */server.js|server.js|*/contact-intake.js|contact-intake.js)
    jq -n '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:"server.js or contact-intake.js edited (the site security surface). If you changed routing, the CSP, security headers, cache rules, rate limit, contact intake, or the Turnstile/Resend adapters: (1) server.js is the header policy: every branch of route() returns plain { status, body, headers } and only fetchHandler builds the Response, so no reply skips the security headers and CSP; keep it that way; (2) the CSP must allow every origin site/index.html loads: server.test.js reads index.html and fails on a blocked origin, and FOLLOW_ON_LOADS there lists what third-party scripts load in turn (Google Fonts files, the Turnstile iframe, beacon reports); (3) Turnstile fails OPEN when TURNSTILE_SECRET_KEY is unset (contactIntakeFromEnv composes the always-pass adapter) and enforces when set; keep that pattern; (4) tests assert EXACT strings: server.test.js has the full CSP string, the security headers and Cache-Control max-age values; contact-intake.test.js has the French replies, the 60000ms rate-limit window, the Turnstile siteverify form and the Resend JSON. Update those assertions and run `bun test`; (5) consider running the /security-review skill on the branch."}}'
    ;;
esac
exit 0
