# Selected event filter designs

Design handoff for [GitHub issue #88](https://github.com/srijan-kapoor/doon.today/issues/88).

## Choices

- **Desktop:** Quick categories, with a short visible row and an expandable full category list.
- **Phone:** Mobile filter sheet, with Community picks as the visible shortcut. Community picks comes before Free only inside the sheet.
- The mobile backdrop closes the sheet and discards pending changes. Close and Escape do the same. Show N events applies pending filters.

## Review

Download `prototype.html` and open it in a browser. Use its bottom design picker to switch between the two selected designs. The moon/sun button switches the product between light and dark mode. The prototype contains local illustrative event data; it does not change the live site.

`source.html` is the editable visualization fragment used to generate the standalone prototype. The other reviewed alternatives are intentionally excluded from this handoff.

## Images

| State | Light | Dark |
| --- | --- | --- |
| Desktop quick categories | [Preview](desktop-light.jpg) | [Preview](desktop-dark.jpg) |
| Phone filter sheet open | [Preview](mobile-light.jpg) | [Preview](mobile-dark.jpg) |
| Phone sheet closed; Community picks shortcut | [Preview](mobile-closed-light.jpg) | — |

## Interaction checks

Checked in the standalone prototype:

- Selecting Music previews 4 sample events; dismissing via the backdrop keeps all 12 applied events.
- Community picks plus Books applies 1 sample event, with two active filters shown on Filters.
- Light and dark styles render for desktop and phone; the phone sheet is contained within the preview.

These are prototype checks. Production integration, URL state, List/Month behavior and the repository checks remain part of the implementation issue.
