# Skill: Lifecycle Resolver Fail-Closed Review

## Context

Lifecycle commands start durable resources such as bridges, tunnels, PTYs, child processes, signal handlers, and audit streams. Resolver mistakes have a higher blast radius here than in short-lived commands because the wrong squad identity can remain live after startup.

## Pattern

For any command that starts long-running state:

1. Resolve the squad before importing or invoking the runner.
2. Treat resolver ambiguity, malformed explicit registry input, and stale resolved paths as fatal startup errors.
3. Validate that the resolved squad path is an existing directory before passing it to bridge metadata or roster loading.
4. Keep subprocess CWD as the user-facing start directory; use the resolved squad path only for squad metadata and roster reads.
5. Test both failure and success paths with assertions that no bridge, tunnel, PTY, or child process starts on resolver failure.

## Review checklist

- Does the dispatch layer fail before runner import on null or error resolution?
- Are clone/origin registry matches checked for existing squad directories?
- If an explicit registry path is malformed or unreadable, does the command fail closed instead of falling back?
- Does the test include a fallback squad fixture to prevent false positives from silent fallback?
- Does subprocess spawn use the user-facing CWD rather than the resolved squad directory?
