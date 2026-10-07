# EquipMap Agent Instructions

## Scope

These instructions apply to the entire repository. For any frontend or user-facing change, also follow `docs/UI_STYLE_GUIDE.md`.

## Product contract

EquipMap is a dense facilities-operations application. It must feel calm, precise, compact, and dependable. Preserve the established dark glass-panel aesthetic. Prioritize legibility, information hierarchy, predictable interaction, and efficient use of space over novelty or decoration.

## Required workflow for UI work

Before editing:

1. Read `docs/UI_STYLE_GUIDE.md`.
2. Inspect `frontend/src/index.css` and `frontend/src/utilities.css` for an existing token or shared class.
3. Inspect the closest existing component with the same interaction pattern.
4. Identify the page's primary action, content hierarchy, loading state, empty state, error state, and narrow-screen behavior.

While editing:

1. Reuse existing primitives before creating CSS.
2. Use CSS variables for every color, radius, shadow, spacing value, and control height.
3. Keep component JSX structural. Put visual styling in a stylesheet; do not add inline style objects for normal layout or appearance.
4. Use one primary action per panel, modal, or drawer.
5. Preserve existing behavior, data flow, permissions, and accessibility unless the request explicitly changes them.
6. Keep the smallest coherent change. Do not restyle unrelated screens.

Before completion:

1. Run focused lint on every changed frontend file.
2. Run the frontend production build.
3. When the available harness supports browser execution, exercise the actual affected path and check browser console errors.
4. When the harness supports viewport control or screenshots, verify desktop and narrow-screen layouts.
5. When browser or viewport tooling is unavailable, complete the strongest available substitute: inspect responsive CSS and rendered structure, run relevant component tests if present, and report exactly which visual or runtime checks remain unverified.
6. Confirm keyboard focus and interactive states when the harness supports interaction; otherwise inspect their implementation and disclose that runtime behavior was not verified.
7. Report which existing primitives were reused and any new primitive introduced.

Do not claim a check was performed when the harness could not perform it. A UI task may be completed with explicitly disclosed visual-verification limitations when browser tooling is unavailable, but not when the build or other available required checks fail. When browser testing is available, do not claim completion if the affected path was not exercised or it shows clipping, accidental horizontal scrolling, unreadable contrast, overlapping controls, or console errors caused by the change.

## Non-negotiable visual rules

- Use Outfit, the existing EquipMap typeface. Do not introduce another UI font.
- Use `lucide-react` for interface icons. Do not mix icon libraries or use emoji as interface icons.
- Use the tokens in `frontend/src/index.css`. No raw hex, RGB, or HSL values in JSX.
- Use only the spacing, radius, type, and size values defined in the style guide.
- Field labels are sentence case and at least 12px. Do not use 10px or 11px for primary form labels.
- Standard controls are at least 38px high. Primary touch targets are at least 44px on narrow screens.
- Major form sections use an 18px gap. Content inside a section card uses a 12px gap. Labels use a 6px gap from their control.
- Metadata fields use two columns on desktop and one column below 700px. Do not place four labeled controls in one row.
- Modal headers and footers do not scroll. Only the modal body scrolls.
- Section cards use one subtle surface, one border, and restrained padding. Do not nest padded cards without a semantic reason.
- Color communicates role: blue for primary action/selection, green for success, amber for warning, red for destructive/error, purple only for informational/template concepts.
- Never rely on color alone to communicate state.
- Animation is optional. If present, it must be short, subtle, and disabled by `prefers-reduced-motion`.

## CSS architecture

Use these locations:

- `frontend/src/index.css`: global tokens and foundational primitives.
- `frontend/src/utilities.css`: genuinely reusable single-purpose or semantic utilities.
- `frontend/src/components/<Component>.css`: styles unique to a component.
- `frontend/src/pages/<Page>.css`: page layout unique to one page.

Rules:

- Do not create a utility for a one-off value.
- Do not duplicate a selector already defined in `index.css` or `utilities.css`.
- Do not add `!important` unless overriding a third-party library that cannot be controlled another way. Add a short comment explaining the exception.
- Do not use DOM-order selectors such as `:nth-child()` for semantic styling.
- Do not use fixed pixel widths for ordinary responsive content. Modal width tiers and deliberate compact fields are exceptions.
- Prefix component-specific classes with the component domain, such as `wo-create-`, `asset-detail-`, or `pm-scheduler-`.
- A new shared primitive requires at least two immediate consumers or a clearly documented near-term second consumer.

## React structure

- Prefer existing components such as `EntitySearchSelector` and the shared modal/button/input classes.
- Split a component when a visual region has its own state, interaction, or reuse value. Do not split JSX only to reduce line count.
- Keep selection identifiers and API payload behavior unchanged during visual refactors.
- Every input has a programmatic label. Icon-only buttons have an accessible name and tooltip where the meaning is not obvious.
- Use real buttons for actions and real links for navigation.
- Preserve focus when validation fails; move focus to the first invalid field.

## Stop conditions

Ask for direction before:

- changing brand colors, typography, or the global density scale;
- introducing a new icon library, CSS framework, or component library;
- replacing a shared primitive used by several screens;
- making a visual change that requires changing API behavior or domain workflow;
- intentionally violating an accessibility requirement.

When an explicit product requirement conflicts with this guide, follow the requirement and note the exception in the completion summary.
