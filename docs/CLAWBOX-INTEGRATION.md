# Konto -> ClawBox / OpenClaw Integration

## Purpose

This document defines how `Konto` should be integrated into ClawBox or OpenClaw.

The goal is not to expose all Konto endpoints directly to the agent.

The goal is to provide:
- a small curated action set
- useful artifact hints
- clear `Open in Konto` targets
- a file structure that can be implemented progressively

## UX Rule

For Konto integration, always use this order:

1. answer in text from Konto API
2. render an artifact when useful
3. offer `Open in Konto`

No iframe-first approach in v1.

## What Konto Should Provide

Konto should provide four things:

### 1. Shared identity support
- shared Clerk app
- local `users` mapping by `clerk_user_id`
- minimal local account provisioning allowed

### 2. Integration status
- `GET /api/integration/status`

This endpoint is the app discovery entrypoint for ClawBox.

### 3. Curated action metadata
- small action catalog for the agent
- artifact hints per action
- deep links per action

### 4. Stable response normalization
- responses should be easy for ClawBox to normalize
- avoid forcing the model to interpret complex raw responses directly

## Recommended File Structure In Konto

This is the target structure for Konto-side integration work:

```text
konto/
  docs/
    CLAWBOX-INTEGRATION.md
  backend/
    src/
      routes/
        integration.ts
      integration/
        actions.ts
        manifest.ts
        normalize.ts
        deeplinks.ts
  tests/
    api/
      integration-status.test.ts
      integration-actions.test.ts
```

## What Each File Should Do

### `backend/src/routes/integration.ts`
Expose Konto integration routes for ClawBox or OpenClaw.

Start with:
- `GET /api/integration/status`

Later, if useful:
- `GET /api/integration/actions`
- `POST /api/integration/execute/:actionId`

### `backend/src/integration/actions.ts`
Define the curated Konto actions used by the agent.

Each action should include:
- id
- description
- source API path
- input expectations
- output expectations
- artifact hint
- deep link target

### `backend/src/integration/manifest.ts`
Expose a machine-friendly action catalog for ClawBox/OpenClaw.

This is the structured app metadata layer.

### `backend/src/integration/normalize.ts`
Normalize raw Konto API responses into stable shapes that ClawBox can use.

This file should convert:
- raw loans data
- raw summary data
- raw asset data

into stable action response shapes.

### `backend/src/integration/deeplinks.ts`
Define how `Open in Konto` targets are built.

Examples:
- `/dashboard`
- `/loans`
- `/loans/:id`
- `/assets`

### `tests/api/integration-status.test.ts`
Test:
- authenticated discovery
- missing user state
- existing user state
- capability flags

### `tests/api/integration-actions.test.ts`
Test:
- curated actions
- normalized response shapes
- artifact hints
- deep link mapping

## Initial Curated Action Set

Do not start with too many actions.

Start with:
- `konto.get_summary`
- `konto.list_loans`
- `konto.get_loan_detail`
- `konto.get_loan_timeline`
- `konto.list_assets`

## Action Definitions

### `konto.get_summary`

Purpose:
- answer high-level finance questions quickly

Source:
- `GET /api/v1/summary`

Good for:
- patrimoine overview
- total assets
- total loans
- account counts

Artifact hint:
- `stat_card`

Open in app:
- `/dashboard`

### `konto.list_loans`

Purpose:
- answer questions about all active loans

Source:
- `GET /api/v1/loans`

Good for:
- loan list
- end dates
- monthly payments
- rates

Artifact hint:
- `table`

Open in app:
- `/loans`

### `konto.get_loan_detail`

Purpose:
- answer questions about one specific loan

Source:
- initially derived from `GET /api/v1/loans`
- later can use a dedicated loan detail endpoint if added

Good for:
- one loan's end date
- one loan's monthly payment
- one loan's remaining amount

Artifact hint:
- `stat_card`

Open in app:
- `/loans/:id`

### `konto.get_loan_timeline`

Purpose:
- support richer timeline visualization

Source:
- dedicated timeline endpoint later
- temporary derived timeline logic if needed

Good for:
- repayment progress
- end date visualization
- balance trend

Artifact hint:
- `timeline`
  or
- `line_chart`

Preferred visualization:
- `timeline` if only milestones matter
- `line_chart` if points over time are available

Open in app:
- `/loans/:id`

### `konto.list_assets`

Purpose:
- answer questions about linked assets and patrimoine composition

Source:
- `GET /api/v1/assets`

Good for:
- asset inventory
- values
- linked real estate context

Artifact hint:
- `table`

Open in app:
- `/assets`

## Artifact Mapping

Konto can suggest the best visualization for its own data, but ClawBox/OpenClaw should map that into canonical artifact types.

Initial mapping:

- summary -> `stat_card`
- loan list -> `table`
- single loan detail -> `stat_card`
- loan timeline -> `timeline` or `line_chart`
- assets -> `table`

Later possible mappings:
- loan distribution -> `pie_chart`
- occupancy-like comparisons are not Konto
- spending evolution -> `bar_chart` or `line_chart`

## Example User Flows

### Example 1
User:
`When is my loan ending?`

Flow:
1. call `konto.list_loans` or `konto.get_loan_detail`
2. answer with the end date in text
3. render a loan timeline artifact if possible
4. show `Open in Konto`

### Example 2
User:
`Show me all my loans`

Flow:
1. call `konto.list_loans`
2. answer with a short summary
3. render a `table`
4. show `Open in Konto`

### Example 3
User:
`What assets do I have linked to my finances?`

Flow:
1. call `konto.list_assets`
2. answer in text
3. render a `table`
4. show `Open in Konto`

## What ClawBox / OpenClaw Should Expect From Konto

For each curated action, ClawBox should receive a stable normalized response shape that includes:
- `text_summary`
- `data`
- `artifact_hint`
- `preferred_visualization`
- `open_in_app`

Example shape:

```json
{
  "action_id": "konto.list_loans",
  "text_summary": "You have 2 active loans. The latest one ends on 2048-03-05.",
  "artifact_hint": "table",
  "preferred_visualization": "table",
  "open_in_app": "/loans",
  "data": {
    "loans": []
  }
}
```

## Recommended Implementation Order

### Step 1
Add app-specific integration files:
- `backend/src/integration/actions.ts`
- `backend/src/integration/manifest.ts`
- `backend/src/integration/deeplinks.ts`

### Step 2
Move `GET /api/integration/status` into a dedicated `routes/integration.ts` file if we want cleaner separation.

### Step 3
Implement the initial curated actions in the integration layer.

### Step 4
Add tests for:
- status endpoint
- curated actions
- deep link mapping

### Step 5
Integrate with ClawBox/OpenClaw and test with the real user account.

## Real-User Validation Checklist

Validate with the actual user account:
- status endpoint returns the right user state
- loans are correctly discovered
- loan end dates are correct
- artifacts reflect the real account data
- `Open in Konto` lands on the correct screen

## Final Rule

Konto should not try to solve the whole cross-app integration alone.

Konto should do these things well:
- identity resolution
- status discovery
- curated finance actions
- suggested artifact metadata
- deep link targets

ClawBox/OpenClaw will own:
- final agent orchestration
- final artifact rendering
- final shared UX consistency
