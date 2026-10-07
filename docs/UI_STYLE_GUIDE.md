# EquipMap UI Style Guide

Version 1.0 — agent-operational specification

## 1. Design intent

EquipMap is an operational tool, not a marketing site. Interfaces should support quick scanning, confident action, and long working sessions. The visual language is dark, glassy, cool-toned, and restrained.

Every screen must feel:

- calm rather than flashy;
- compact rather than cramped;
- structured rather than boxed-in;
- precise rather than ornamental;
- consistent with adjacent EquipMap screens.

When several designs are valid, choose the one with fewer containers, fewer competing accents, clearer labels, and less vertical travel.

## 2. Source of truth

The order of authority is:

1. This guide.
2. Tokens and foundational primitives in `frontend/src/index.css`.
3. Shared semantic classes in `frontend/src/utilities.css`.
4. The nearest established component pattern.
5. Component- or page-specific CSS.

Do not copy visual values from an old component when a current token or primitive exists. Existing inconsistencies are not precedent.

## 3. Design tokens

### 3.1 Color

Use the existing variables. Components must not contain literal color values.

| Role | Required token | Use |
|---|---|---|
| App background | `--bg-color` | Page canvas |
| Deep background | `--bg-darker` | Backdrops and recessed regions |
| Main glass surface | `--surface-color` | App panels |
| Elevated surface | `--surface-elevated` | Menus, dialogs, popovers |
| Subtle card | `--surface-card` | Section cards and grouped metadata |
| Standard border | `--surface-border` | Inputs, cards, panels |
| Quiet border | `--surface-border-subtle` | Dividers and low-emphasis separation |
| Hover border | `--surface-border-hover` | Interactive surface hover |
| Primary | `--primary-color` | Primary action, selected state, focus |
| Primary subtle | `--primary-subtle` | Selected backgrounds and icon boxes |
| Primary border | `--primary-border` | Selected or linked-item border |
| Primary text | `--text-primary` | Titles and main content |
| Secondary text | `--text-secondary` | Labels and supporting content |
| Muted text | `--text-muted` | Optional metadata and hints |
| Success | `--success-*` | Completed, available, confirmed |
| Warning | `--warning-*` | Needs attention, not destructive |
| Danger | `--danger-*` | Errors and destructive actions |
| Information | `--info-*` | Templates, references, informational state |

Rules:

- Blue is the default interactive accent.
- Semantic colors are reserved for their semantic role.
- A large panel must not be fully tinted with a semantic color. Use subtle background + semantic border/icon/text.
- Text must meet WCAG AA contrast for its size.
- Do not use `--text-muted` for essential instructions, labels, or values.
- State always includes text, icon, shape, or position in addition to color.

### 3.2 Spacing

Only use this scale for new UI:

| Token | Value | Intended use |
|---|---:|---|
| `--space-1` | 4px | Tight icon/text separation |
| `--space-2` | 6px | Label-to-control gap |
| `--space-3` | 8px | Compact action groups and chips |
| `--space-4` | 12px | Internal card rhythm and grid row gap |
| `--space-5` | 16px | Standard card horizontal padding and grid column gap |
| `--space-6` | 18px | Separation between major form sections |
| `--space-7` | 24px | Page section separation |
| `--space-8` | 32px | Large page-region separation |

If these variables are not yet present in `:root`, add them once before using them. Do not introduce values such as 13px, 15px, 17px, 19px, or 22px to solve local spacing.

Required form rhythm:

```css
.equip-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-6); /* 18px between major sections */
}

.equip-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2); /* 6px from label to control */
}

.equip-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4); /* 12px inside a grouped section */
  padding: 14px var(--space-5) var(--space-5);
}
```

The 14px top padding is the only allowed intermediate value in a standard section card. It visually centers the compact section heading within 16px side/bottom padding.

### 3.3 Radius

Use the existing radius tokens:

- `--radius-xs` (4px): tiny indicators only.
- `--radius-sm` (6px): badges and compact buttons.
- `--radius-md` (8px): controls, standard buttons, inline actions.
- `--radius-lg` (12px): section cards, dropdowns, medium surfaces.
- `--radius-xl` (16px): main panels and modals.
- `--radius-2xl` (20px): rare large hero surfaces.
- `--radius-full`: pills and circular controls.

Do not combine three or more different radii in one component. A normal modal uses 16px outer radius, 12px section radius, and 8px control radius.

### 3.4 Shadows and glass

- Use `--modal-shadow` for dialogs.
- Main glass surfaces use `--glass-bg` and `--glass-blur` through existing classes.
- Use borders to define most elevation. Add shadow only when a surface must clearly float over another surface.
- Do not add colored glow to ordinary cards or fields.
- A primary or semantic icon box may use one restrained glow.
- Never stack blur on multiple nested containers; one blurred ancestor is enough.

## 4. Typography

Use Outfit for all application UI. Use monospace only for identifiers, codes, measurements requiring alignment, logs, or machine values.

| Role | Size | Weight | Color |
|---|---:|---:|---|
| Page title | 24px | 700 | `--text-primary` |
| Modal/drawer title | 18px | 700 | `--text-primary` |
| Card title | 15px | 600–700 | `--text-primary` |
| Body/control | 14px | 400–500 | `--text-primary` |
| Field label | 12px | 600 | `--text-secondary` |
| Section eyebrow | 11px | 700 | `--text-secondary` |
| Supplementary metadata | 11px | 400–600 | `--text-muted` |
| Badge | 11–12px | 600 | Semantic |

Rules:

- Field labels use sentence case, never all caps.
- A section eyebrow may use uppercase with `letter-spacing: 0.04em` to `0.06em`.
- Do not use 10px text for user-facing information.
- Do not use bold for entire paragraphs.
- Use one clear title per region. Avoid a title immediately followed by another title of equal weight.
- Supporting copy is one short sentence. If more explanation is necessary, use a help disclosure or documentation link.

## 5. Icons

- Use `lucide-react` only.
- Default stroke width is the Lucide default or 1.8–2.0 when explicitly set.
- Standard sizes: 14px inline, 16px in controls, 18px in headers, 20px in primary icon boxes.
- Icon-only controls are 32–38px square on desktop and at least 44px on touch-focused narrow layouts.
- Every icon-only button has `aria-label`. Add a tooltip when the action is not universally obvious.
- Do not use emoji, multicolor illustrations, or decorative icons inside dense operational forms.
- Do not place an icon in every label. Use icons for section identity, actions, status, and important navigation.

## 6. Layout and hierarchy

### 6.1 Pages

A standard page contains:

1. Page header: title, optional one-line context, primary action.
2. Optional filter/search toolbar.
3. Main content surface.
4. Empty/loading/error state in the same content region.

Page rules:

- The primary page action is right-aligned on desktop and remains discoverable on narrow screens.
- Do not wrap every page section in a glass card. The background, one main surface, and occasional semantic subpanels are enough.
- Keep data controls close to the content they modify.
- Do not place destructive actions beside the primary create/save action without clear separation.
- Dense desktop layouts must still have a single reading order when stacked.

### 6.2 Grids

- Two-column form metadata: `repeat(2, minmax(0, 1fr))`, 12px row gap, 16px column gap.
- Collapse labeled form grids to one column below 700px.
- Three-column schedules may use `1fr 1fr 112px–140px`; stack or make the compact field span on narrow screens.
- Never use a four-column row for labeled fields in a modal.
- Use `minmax(0, 1fr)` to prevent overflow.
- Avoid fixed heights for content-bearing regions.

### 6.3 Section cards

Use a section card only when fields or information share a semantic topic such as Location, Assignment & Schedule, Safety, or Checklist.

A section card contains:

1. Optional 26–30px semantic icon box.
2. 11px uppercase section eyebrow.
3. Optional one-line helper text.
4. Fields/content separated by 12px.

Rules:

- Padding: 14px top, 16px sides/bottom.
- Radius: 12px.
- Border: one `--surface-border`.
- Background: `--surface-card` or equivalent existing subtle surface.
- Do not put a section card inside another section card.
- Do not wrap a single ordinary input in a section card.
- Avoid more than three section cards in one modal before reconsidering the flow.

## 7. Components

### 7.1 Buttons

Use the existing `.btn` variants and size classes.

- Primary: the single recommended action in the current region.
- Secondary: safe alternative or supporting action.
- Ghost: low-emphasis action such as Close, Clear, or Remove reference.
- Danger: destructive action only.
- Success: explicit completion action only when success is the domain meaning; do not use instead of primary by preference.

Rules:

- One primary button per modal, drawer, panel, or page header.
- Button labels are verbs: “Create work order”, “Save changes”, “Assign technician”.
- Do not use vague labels such as “Submit”, “OK”, or “Yes” when a specific verb fits.
- Icon precedes text unless it indicates forward movement.
- A destructive confirmation names the object being affected.
- Loading buttons preserve width, show progress, and are disabled against duplicate submission.

### 7.2 Inputs

Use `.input-field` or the established shared form primitive.

- Minimum desktop height: 38px.
- Horizontal padding: 12–14px.
- Font size: 14px.
- Radius: 8px.
- Textarea minimum height: 80–88px.
- Focus: primary border plus a restrained focus ring.

Rules:

- Every field has a visible label.
- Placeholder text is an example or search cue, never the only label.
- Optional markers are quiet, right-aligned label metadata.
- Required fields are identified consistently. Do not put a red asterisk on every label if the form instead declares optional fields.
- Validation appears next to the field and focuses the first invalid control after submit.
- Help and error text must not cause adjacent controls to jump unpredictably; reserve space when errors are expected.
- Do not make controls visually tiny inside large padded containers.

### 7.3 Search and multi-select

- Reuse `EntitySearchSelector` for room, equipment, user, or similar entity selection.
- Selected values appear as compact removable chips below or inside the control.
- Search results clearly show primary label and differentiating metadata.
- Keyboard interaction supports typing, arrows when applicable, Enter to select, and Escape to close.
- “Clear all” is available only when multiple selections exist.
- Never implement a second entity-search visual pattern without first extending the shared component.

### 7.4 Modals

Use the existing structure:

```jsx
<div className="modal-overlay modal-backdrop-dark">
  <div className="modal-card modal-xl glass-panel" role="dialog" aria-modal="true">
    <div className="modal-card-header">…</div>
    <form className="modal-card-body equip-form">…</form>
    <div className="modal-card-footer">…</div>
  </div>
</div>
```

Width tiers:

- Small 420px: confirmation or one compact decision.
- Medium 540px: short form or simple details.
- Large 740px: multi-part details.
- Extra-large 900px: complex create/edit flow.
- 1180px: data-heavy inspection or print preview only.

Modal rules:

- Header and footer never scroll; body owns scrolling.
- Maximum height is `calc(100dvh - 40px)` on desktop.
- Header contains one title, optional short subtitle, and one close button.
- Footer contains optional status/help text on the left and actions on the right.
- Cancel precedes the primary action.
- Clicking backdrop may close only when no destructive data loss is likely.
- Escape closes under the same rule.
- On narrow screens, the modal may become full-screen; keep header and footer visible.
- Do not put the primary description after location and assignment metadata. Content-first order is preferred.

Standard complex form order:

1. Linked template/reference banner, if any.
2. Title.
3. Description.
4. Classification metadata in a 2×2 grid.
5. Location section.
6. Assignment & Schedule section.
7. Checklist or attachments when present.

### 7.5 Drawers

- Use a drawer for contextual detail that benefits from keeping the page or map visible.
- Use a modal for a focused create/edit transaction.
- Drawer width must be deliberate and responsive, not an arbitrary percentage.
- Drawer header and footer stay fixed; body scrolls.
- Preserve the selected map/table entity while the drawer is open.

### 7.6 Tables and dense lists

- Keep headers short and sentence case.
- Align numeric values right; align labels and identifiers left.
- Use monospace selectively for order numbers, equipment IDs, dates requiring alignment, or codes.
- Row actions remain low-emphasis until hover/focus unless they are the primary workflow.
- Avoid zebra striping on glass surfaces; use quiet row separators and hover state.
- Truncation must expose the full value by tooltip or detail view.
- Mobile behavior must be intentional: prioritized columns, horizontal region with clear affordance, or card conversion. Accidental page-level horizontal scroll is forbidden.

### 7.7 Badges and status

- Badges are for state or compact classification, not decoration.
- Use the existing badge variants.
- One item should not display more than three badges in a compact row.
- Status wording must be stable across screens.
- Add a dot or icon only when it improves scanning; do not duplicate the same signal three ways.

### 7.8 Empty, loading, error, and success states

Every data-bearing region must define all applicable states.

Loading:

- Keep the surrounding layout stable.
- Use a spinner for short actions and a skeleton for content regions when available.
- Never show an empty-state message before loading finishes.

Empty:

- State what is absent.
- Explain the next useful action in one sentence.
- Offer one action only when the user can resolve the state.

Error:

- State what failed in plain language.
- Preserve entered data.
- Offer Retry when retry is meaningful.
- Technical detail belongs in logs, not the primary user message.

Success:

- Confirm the object and outcome.
- Keep confirmation lightweight unless the user needs an order number or next-step choices.

## 8. Responsive behavior

Target validation widths when the harness supports viewport control:

- 1440×900 desktop.
- 1024×768 compact desktop/tablet landscape.
- 390×844 phone.

Rules:

- Responsive design means reprioritization, not simply shrinking.
- Two-column form grids become one column below 700px.
- Toolbars wrap with the primary action remaining discoverable.
- No page-level horizontal scrolling at required widths.
- Fixed or sticky elements must respect safe-area insets.
- At 390px, ordinary interactive targets are at least 44px high or have an equivalent 44px hit area.
- Long text, identifiers, and translated labels must not overlap actions.
- Do not hide essential actions behind hover-only behavior.

## 9. Accessibility

Minimum requirements:

- Semantic headings follow a logical order.
- Forms use real labels connected by `htmlFor`/`id`.
- Dialogs use `role="dialog"`, `aria-modal="true"`, and an accessible title.
- Focus moves into an opened modal and returns to the trigger when it closes.
- Tab order matches the visual order.
- Focus indicators are visible on every interactive element.
- Icon-only controls have accessible names.
- Menus, selectors, and disclosures are keyboard operable.
- Error messages are associated with their field.
- Color is never the only state indicator.
- Motion respects `prefers-reduced-motion`.
- Text and interactive states meet WCAG AA contrast.

## 10. Motion

- Default interaction transition: 150–200ms ease.
- Modal entrance: up to 240ms; small translate + fade only.
- No bouncing, continuous pulsing, parallax, or decorative background motion in operational screens.
- Loading animation may repeat while work is active.
- Hover effects may change background, border, color, or move by at most 1px.
- Disable nonessential motion under `prefers-reduced-motion`.

## 11. Content style

- Use plain operational language.
- Titles use sentence case: “Create work order”, not “Create Work Order”.
- Use “&” only where the established compact section name uses it, such as “Assignment & Schedule”.
- Labels name the data: “Assigned trade”, “Due date”, “Estimated hours”.
- Button labels name the action: “Create work order”, “Save changes”, “Close work order”.
- Avoid filler such as “Please”, “Simply”, “Just”, or generic reassurance.
- Error messages explain the problem and useful recovery: “Enter a title before creating the work order.”
- Optional helper text is concise and does not restate the label.

## 12. Forbidden patterns

An agent must not introduce:

- inline style objects for ordinary visual styling;
- raw color values in JSX;
- a new font or icon library;
- emoji used as interface icons;
- four-column labeled forms inside modals;
- labels below 12px;
- nested padded cards without separate semantic meaning;
- multiple primary buttons in one action region;
- gradients on every surface;
- colored glows on ordinary content;
- global selectors created to fix one component;
- new utility classes that duplicate existing utilities;
- `!important` without a documented third-party override reason;
- fixed content heights that clip validation or translated text;
- hover-only required actions;
- placeholder-only fields;
- color-only status communication;
- destructive actions styled as ordinary primary actions;
- broad redesigns while implementing a focused feature.

## 13. Agent implementation procedure

For every UI request, the coding agent must follow this sequence.

### Discover

1. Identify the exact affected user path.
2. Locate the component, its stylesheet, and all shared primitives it uses.
3. Inspect one or two nearest analogous screens.
4. Record the existing data/interaction behavior that must remain unchanged.
5. Identify desktop and narrow-screen layout requirements.

### Design

1. State the content hierarchy in reading order.
2. Choose the existing page, modal, drawer, form, table, or section-card pattern.
3. Map every color, space, radius, type size, and control height to a token.
4. Identify the one primary action.
5. Define loading, empty, error, disabled, and success states.

### Implement

1. Reuse shared JSX components and semantic CSS classes.
2. Add the smallest component-specific CSS required.
3. Keep behavior changes separate from visual refactoring where practical.
4. Preserve IDs, payload shapes, permission checks, and navigation behavior unless explicitly changed.
5. Add accessibility semantics during implementation, not afterward.

### Verify

1. Focused lint passes for changed files.
2. Production build passes.
3. When browser execution is available, the exact affected interaction is exercised.
4. When viewport control or screenshots are available, 1440×900, 1024×768, and 390×844 layouts are checked.
5. When browser interaction is available, keyboard operation and browser console errors are checked.
6. When browser tooling is unavailable, responsive CSS, rendered structure, accessibility semantics, and relevant component tests are inspected as the fallback.
7. No clipping, overlap, accidental horizontal scroll, or hidden action is observed in every layout the harness can render.
8. Loading, empty, error, disabled, and success states are checked when the available harness can reach them.
9. Every unavailable check and its resulting uncertainty is listed in the completion summary.

### Report

The completion summary must include:

- the affected user path;
- reused primitives;
- any new shared primitive and its consumers;
- validation performed;
- remaining known limitations or guide exceptions.

## 14. Review checklist

A reviewer should reject the change if any answer is “no”.

### Hierarchy

- Is the primary action obvious?
- Does the reading order match the task order?
- Are related controls grouped without unnecessary containers?
- Is secondary information visibly quieter than primary information?

### Consistency

- Are all values token-based?
- Were existing components and utilities reused?
- Do buttons, controls, badges, and modals match adjacent screens?
- Is component-specific CSS correctly scoped?

### Density

- Are major sections separated by 18px?
- Are section interiors separated by 12px?
- Are labels separated from controls by 6px?
- Are fields compact but comfortably legible?

### Behavior

- Are loading, empty, error, disabled, and success states handled?
- Are primary and destructive actions protected against duplicate execution?
- Does validation preserve entered data and focus the first problem?
- Does the exact user path still work?

### Responsive and accessible

- Does the layout work at every target width the available harness can verify?
- Is there no accidental horizontal scrolling?
- Are labels, accessible names, focus order, and focus styles correct?
- When interactive browser testing is available, can all required actions be completed with a keyboard?
- Is important state communicated without relying only on color?

## 15. Migration rule for existing UI

This guide applies immediately to new and changed UI. Do not perform a repository-wide visual rewrite as part of an unrelated task.

When touching an existing component:

1. Make the requested change.
2. Bring the directly affected region into compliance.
3. Reuse or extract a shared primitive only when the change reveals an immediate second consumer.
4. Log larger inconsistencies for a dedicated design-system cleanup rather than expanding scope.

The goal is steady convergence, not a risky one-time redesign.
