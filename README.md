# Calendar Notes

A calendar in your sidebar. Click a day to open or create its note.

## Why this exists

The plugin most people use for this has **3.1 million downloads** and has not
had a commit since **June 2024**. It has **188 open issues**, including requests
that have gone unanswered for years:

- Click the month or year to open that periodic note ([#313](https://github.com/liamcain/obsidian-calendar-plugin/issues/313), [#145](https://github.com/liamcain/obsidian-calendar-plugin/issues/145))
- A command-palette action to open the calendar ([#347](https://github.com/liamcain/obsidian-calendar-plugin/issues/347))
- Open notes in a stacked tab instead of taking over the pane ([#272](https://github.com/liamcain/obsidian-calendar-plugin/issues/272))

This is a fresh implementation — not a fork — that ships those.

## Free

- Month calendar in the sidebar
- Click a day to open it, or create it if it does not exist
- Today is highlighted; days that already have a note get a dot
- ISO week numbers
- Week start: automatic, Sunday, Monday or Saturday
- Command palette: open calendar, go to today, previous/next month
- Ctrl/Cmd-click to open in a new tab
- Reads your existing Daily Notes or Periodic Notes settings — nothing to set up twice

## Pro — A$12, one payment

- Click the **month** to open the monthly note
- Click the **year** to open the yearly note
- Click a **week number** to open the weekly note

No subscription. No account. No telemetry.

**[Get Pro — A$12](https://thesundrykit.gumroad.com/l/ccole)** · your key arrives
by email, and you paste it into the plugin's settings once.

**Activation is one-time and then fully offline.** After you enter your key once,
the plugin verifies it locally on your own machine. If our licence server
disappeared tomorrow, your copy would keep working.

## Network use, in full

The free plugin makes **no network requests at all**.

Pro makes exactly **one**, and only when you press Activate: it sends your
licence key and the product name to `https://licence.sundrykit.dev/activate`,
which returns a signed token. Nothing else is sent, and nothing about your
vault, your notes or you is included.

After that the plugin verifies that token on your own machine and never
contacts the server again — not on startup, not on a schedule, not ever.

## What it does not do

- It does not read your notes' contents — only their filenames, to draw the dots.
- It does not create weekly, monthly or yearly notes unless you have configured
  those formats yourself.

## Development

```bash
npm install
npm test        # pure date logic — 23 tests
npm run build   # typecheck + bundle
```

The calendar maths in `src/core/` has no Obsidian imports, so it is tested in
plain Node. ISO week numbers at year boundaries, leap years and week-start
offsets are all covered — those are where calendar bugs live.

## Releasing

```bash
git tag 1.0.1 && git push origin 1.0.1
```

CI runs the tests, checks the manifest version matches the tag, builds, and
publishes the release. No manual step.

## Licence

Code: MIT. The Pro features require a licence key.
