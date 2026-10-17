# Activity category icons

`centres.png` remains the existing category sprite. The activity plaza overrides
only the presidium and life categories with the two SVG masks below.

- `presidium.svg`: adapted from [Tabler users-group](https://github.com/tabler/tabler-icons/blob/main/icons/outline/users-group.svg). Arranges a taller foreground member between two side members and adds a filled star to match the supplied reference.
- `life.svg`: adapted from [Tabler first-aid-kit](https://github.com/tabler/tabler-icons/blob/main/icons/outline/first-aid-kit.svg). Keeps the handle and rounded case, with a filled medical cross and no heartbeat trace.

Both use the existing category colours, dimensions, and outline-thickening
filter. Their base strokes account for scaling and that shared filter.
Tabler's MIT license is retained in `Tabler-LICENSE.txt`.
