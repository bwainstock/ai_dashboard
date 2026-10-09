# Ticket #7: Lunch View acceptance

Lunch View is generated with Daily Brief and Calendar View at every due local
slot. All three 800×480 PNGs are written under one immutable generation
timestamp before the D1 batch publishes the complete view set.

Automated coverage verifies:

- Lunch View selects the current Monday-through-Friday school week on weekdays
  and the upcoming school week on Saturday and Sunday.
- A weekend without upcoming menu data says `Next week's menu not posted`;
  it does not imply that school is closed.
- Menu days show only normalized entree names and bundled monochrome icons.
  Explicit closures and missing posted menus remain distinct.
- Short button wakes cycle Daily Brief → Calendar View → Lunch View → Daily
  Brief. Timer wakes reset the cursor to Daily Brief.
- Every view uses a distinct immutable filename prefix:
  `daily-brief-`, `calendar-view-`, or `lunch-view-`.
- The Browser Rendering seam checks every view for an exact 800×480 viewport,
  clipped or overflowing elements, icon and text presence, black-and-white
  styling, and visible missing-data text of at least 14px before taking the
  screenshot.
- Publication still rejects PNGs with incorrect dimensions or files above the
  configured byte limit, preserving the previous complete generation.

Migration `0006_lunch_view.sql` expands the device cursor and immutable
generation view type from two values to three without exposing images outside
the authenticated device routes.
