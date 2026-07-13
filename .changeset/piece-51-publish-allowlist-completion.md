---
"@bradygaster/squad-cli": patch
---

Cross-repo publish: complete the ephemeral/state allowlist (fold append-only histories, casting state, and onboarding artifacts; per-agent history via the B outcome); declare machine-local scratch and keep `publish-history.json` pipeline-owned; and have `install-fold-pipeline` install the same allowlist-aware `.gitignore` as `init` so folded state cannot be swept onto the product branch.
