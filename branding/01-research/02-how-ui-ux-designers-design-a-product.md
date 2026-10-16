# How UI/UX designers design a product — and how it was applied here

Product design is the discipline of making the right thing, then making it
usable. The two halves are separate: a beautiful screen for the wrong task is
a failure; an ugly screen that gets a buka owner to a costed plate in four
minutes is a success that can be made beautiful later.

## The standard process

Agencies and studios describe the same five gates, for example
[Design Studio UI/UX](https://www.designstudiouiux.com/process),
[Phenomenon Studio](https://phenomenonstudio.com/article-faq/what-is-the-typical-process-for-a-ui-ux-design-project/)
and [Purrweb](https://www.purrweb.com/services/ui-ux):

| Gate | What the designer does | Output |
|---|---|---|
| 1. Discovery | Stakeholder interviews, user interviews, competitor teardown, analytics. Writes personas and jobs-to-be-done. | Personas, problem statement |
| 2. Structure | Information architecture (what lives where), user flows for the top tasks, content inventory. | IA map, flow diagrams |
| 3. Wireframes | Low-fidelity layouts to settle hierarchy before colour. Tested with five users. | Wireframes, test notes |
| 4. Visual design and design system | Tokens (colour, type, spacing, radius, motion), components, then hi-fi screens built from those components. Every state: empty, loading, error, success, locked. | Design system, hi-fi screens |
| 5. Handoff and validation | Annotated screens, specs, accessibility checks, then watch real users again. | Spec sheets, acceptance criteria |

Professional habits worth copying:

- **Mobile first, worst phone first.** Design at 360 px and a slow network, then let the desktop breathe.
- **States are the design.** The empty state is what every new user sees. The error state is what they remember.
- **Numbers are the product** in a money app: tabular figures, consistent decimals, the currency sign never separated from its number, and never a fake zero.
- **One primary action per screen.** If two buttons compete, the user does neither.
- **Write the copy with the screen.** Labels are design. "Dish" beats "Recipe variant".
- **Test with five people.** Nielsen's rule: five users find most of the stalls. The repo's `docs/USABILITY_SESSIONS.md` is exactly this.

## How it was applied here

| Gate | Done for Menu Master |
|---|---|
| Discovery | Personas taken from the usability script (a buka or rice seller, a caterer, a baker). Jobs: "What does this plate cost me now?", "What should I charge?", "Did I make money this week?". Current screens audited from the 142 screenshots in `web/e2e/shots/`. |
| Structure | `09-uiux/01-information-architecture.md` and `02-user-flows.md`: five primary destinations (Home, Sales, Purchases, Recipes, More) as the app already ships, with every other page reachable from the one it belongs to. |
| Wireframes | Not a separate deliverable: the live app is the wireframe. Hierarchy decisions are recorded per screen in the spec sheets. |
| Visual | `09-uiux/00-design-system.md` (tokens from `web/src/app/globals.css`, brand fonts, components) and hi-fi mockups of every screen in `09-uiux/screens/`, rendered to PNG in `09-uiux/renders/`. |
| Handoff | A spec per screen in `09-uiux/specs/`: purpose, who uses it, primary action, every state, copy, and what changes from the current build. |
