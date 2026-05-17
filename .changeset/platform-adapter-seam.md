---
"@bradygaster/squad-sdk": minor
---

Platform adapter seam with GitHub and Azure DevOps implementations (#12)

- Add `'unknown'` to `PlatformType`; `detectPlatformFromUrl` returns `'unknown'` for unrecognized hosts
- Add `'unknown'` to `WorkItemSource` for unidentified work-item sources
- `detectPlatform` honors `SQUAD_PLATFORM` env var; throws `PlatformConfigError` for invalid values including `'planner'`
- `detectWorkItemSource` fallback changed from `'github'` to `'unknown'`
- Add `normalizeRemoteUrl(url)` that collapses all ADO URL forms to canonical `dev.azure.com` path
- Add `PlatformConfigError` typed error class; factory and detect functions now throw it instead of generic Error
- `createAdapterForOrigin(url)` factory fails closed for unknown hosts with `PlatformConfigError`
- `AzureDevOpsAdapter`: remove `shell:true` Windows injection risk; use `AZ_CMD` (`az.cmd` on Windows) for safe argv dispatch
- `AzureDevOpsAdapter`: internal helpers `getAvailableWorkItemTypes`/`validateWorkItemType` made private, removed from barrel
- `comms.ts`: `console.warn` added in `detectPlatform` catch block to surface errors
- `planner.ts`: `PlannerAdapter.type` now `'planner' as const`, no longer typed as `PlatformType`
- Barrel exports: `PlatformConfigError` and `normalizeRemoteUrl` added; internal ADO helpers removed
