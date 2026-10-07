# Ticket 6: Lunch on the Daily Brief

## MealViewer boundary

`src/lunch.ts` is the replaceable boundary around the undocumented MealViewer
`/api/v4` integration. The URL is deployment configuration in
`MEALVIEWER_MENU_URL`; callers and renderers do not depend on the upstream
payload.

The adapter requires the observed `menuSchedules` contract, validates every
school date, closure flag, menu block, category, and item name, then returns
only:

- normalized `YYYY-MM-DD` school dates;
- normalized entree names from Lunch blocks; and
- the reliable boolean closure state.

Breakfast, sides, beverages, source images, closure reasons, nutrition, and
allergen fields are discarded before persistence. A valid response without a
menu becomes `No menu posted`. A changed schema is not treated as an empty
menu.

Migration `0003_lunch_daily_brief.sql` adds normalized lunch snapshots and the
accepted AI icon cache. No raw MealViewer response is stored.

## Closed icon classification

The application-owned monochrome icon set is closed to `pizza`, `taco`,
`sandwich`, `chicken`, `pasta`, `salad`, and `generic`. Exact and keyword
rules run first, followed by a cached accepted decision. Only a previously
unknown entree can invoke the optional Workers AI binding.

`LUNCH_AI_MODEL` selects the fallback model. The request supplies the exact
allowed tokens and asks for one token only. The application independently
accepts only an exact enum value; malformed, uncertain, unavailable, or
throwing model output becomes `generic`. Only accepted enum decisions are
cached.

## Visible states

The Daily Brief always pairs each icon with its normalized entree name and
uses distinct display copy:

- available menu: icon and entree text;
- missing menu: `No menu posted`;
- explicit closure: `School closed`;
- changed response schema: `Lunch source changed`;
- HTTP, network, or adapter failure: `Lunch unavailable`.

Schema and adapter failures may retain the last normalized entrees, but label
them `Last menu` so stale data cannot look current.

## Verification

Contract tests cover representative source normalization, forbidden-field
omission, missing menus, closures, and schema drift. Classification tests
cover all deterministic icon classes, valid cached AI fallback, and malformed
or uncertain output. Generation and renderer tests cover every visible state,
stale normalized fallback, and icon-plus-text output.
