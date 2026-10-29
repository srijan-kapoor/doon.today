# Event typography: current site and selected prototype

Approved direction for [issue #88](https://github.com/srijan-kapoor/doon.today/issues/88): carry the selected prototype's event headings and supporting text into the filter redesign.

## Comparison

Live computed styles were checked on https://doon.today/ on 29 October 2026 at 1280px desktop and 390px phone width. The live title and metadata values below were identical at both widths.

| Element | Live site | Selected prototype |
| --- | --- | --- |
| Event title family | Georgia, serif | Georgia, serif |
| Event title weight | 700 (bold) | 500, a lighter treatment; system Georgia may resolve this to its regular face |
| Event title size | 18.24px | 19px desktop, 18px phone |
| Event title line height | normal | 1.3: 24.7px desktop, 23.4px phone |
| Venue/area metadata family | Inter with system sans-serif fallbacks | Arial, sans-serif |
| Venue/area metadata weight | 400 | 400 |
| Venue/area metadata size | 14.08px | 12px |
| Venue/area metadata line height | normal | 1.5 (18px) |
| Title-to-metadata gap | Existing live row spacing | 7px below the title |

The heading family is already Georgia on the live site. The visual change comes mainly from reducing the title's weight, setting explicit line spacing, and using smaller Arial supporting text.

## Implementation direction

- Use the prototype values above for event-list headings and supporting venue/area text, at the site's existing phone/desktop breakpoint.
- Scope the font changes to event rows; do not replace the site's global body font or brand typography.
- Retain full event titles and useful metadata; allow wrapping and preserve link hover/focus behavior.
- Use the site's theme tokens for foreground and secondary text. Verify the smaller metadata is readable in both themes at phone and desktop widths.
- Check the shared event row wherever List and Month day results render it.

The existing selected-design screenshots and prototype already use this typography. This note records the comparison and implementation choice; it does not indicate a production deployment.

Design source: [selected prototype at the original design revision](https://github.com/srijan-kapoor/doon.today/blob/8e0fcdff71e81f1941b139ddad4fbab9109a3d4a/issue-88/source.html).
