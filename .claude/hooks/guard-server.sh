#!/usr/bin/env bash
# PostToolUse(Edit|Write): server.js is the site's whole dynamic + security surface and
# server.test.js asserts exact strings against it. Surface the invariants + test-sync need.
input=$(cat)
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
case "$path" in
  */server.js|server.js)
    jq -n '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:"server.js edited (the site security surface). If you changed the CSP, security headers, rate-limit, contact, or Turnstile logic: (1) keep the CSP in sync with what site/index.html inlines/loads (unsafe-inline for inline <style>/<script>/onerror, fonts.googleapis.com, fonts.gstatic.com, static.cloudflareinsights.com, and challenges.cloudflare.com for Turnstile script-src + frame-src); (2) Turnstile fails OPEN when TURNSTILE_SECRET_KEY is unset and enforces when set — keep that pattern; (3) server.test.js asserts EXACT strings (CSP directives, Cache-Control max-age values, the 60000ms rate-limit window, the Resend + Turnstile request shapes) — update those assertions and run `bun test`; (4) consider invoking the security-reviewer agent."}}'
    ;;
esac
exit 0
