#!/usr/bin/env bash
# PostToolUse(Edit|Write): server.js + contact-intake.js are the site's whole dynamic + security
# surface, and their tests assert exact strings against them. Surface the invariants + test-sync need.
input=$(cat)
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
case "$path" in
  */server.js|server.js|*/contact-intake.js|contact-intake.js)
    jq -n '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:"server.js or contact-intake.js edited (the site security surface). If you changed the CSP, security headers, rate limit, contact intake, or the Turnstile/Resend adapters: (1) keep the CSP in sync with what site/index.html inlines/loads (unsafe-inline for inline <style>/<script>/onerror, fonts.googleapis.com, fonts.gstatic.com, static.cloudflareinsights.com, and challenges.cloudflare.com for Turnstile script-src + frame-src); (2) Turnstile fails OPEN when TURNSTILE_SECRET_KEY is unset (contactIntakeFromEnv composes the always-pass adapter) and enforces when set — keep that pattern; (3) tests assert EXACT strings — server.test.js: CSP directives and Cache-Control max-age values; contact-intake.test.js: the French replies, the 60000ms rate-limit window, the Turnstile siteverify form and the Resend JSON — update those assertions and run `bun test`; (4) consider running the /security-review skill on the branch."}}'
    ;;
esac
exit 0
