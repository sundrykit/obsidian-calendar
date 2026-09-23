import { ItemView, WorkspaceLeaf, TFile, Notice, moment, normalizePath } from "obsidian";
import {
  buildMonthGrid, shiftMonth, weekdayLabels, MONTH_NAMES, toISO, utc,
  type WeekStart, type DayCell,
} from "./core/grid";
import { notePath, type Granularity } from "./core/periodic";
import type CalendarPlugin from "./main";

/**
 * Obsidian re-exports moment without types, so every call through it is an
 * `any` and every value taken off the result is unchecked. The review flagged
 * nine of those, all from these two call sites.
 *
 * One narrow adapter contains it: these are the only two moment behaviours
 * this plugin uses, and naming them means a future misuse is a build error
 * rather than another untyped hole.
 */
interface MomentLike {
  isValid(): boolean;
  format(fmt: string): string;
}
type MomentFn = (input: string, format: string, strict?: boolean) => MomentLike;
const parseDate = moment as unknown as MomentFn;

export const VIEW_TYPE_CALENDAR = "sundry-calendar-view";

export class CalendarView extends ItemView {
  private plugin: CalendarPlugin;
  private year: number;
  private month: number;
  private existing = new Set<string>();

  constructor(leaf: WorkspaceLeaf, plugin: CalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth() + 1;
  }

  getViewType() { return VIEW_TYPE_CALENDAR; }
  getDisplayText() { return "Calendar"; }
  getIcon() { return "calendar-days"; }

  async onOpen() { this.render(); }

  /** Jump the grid to whatever month contains today. */
  goToToday() {
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth() + 1;
    this.render();
  }

  step(n: number) {
    const s = shiftMonth(this.year, this.month, n);
    this.year = s.year; this.month = s.month;
    this.render();
  }

  private effectiveWeekStart(): WeekStart {
    const s = this.plugin.settings.weekStart;
    if (s !== "locale") return s;
    const fd = moment.localeData().firstDayOfWeek();
    return (fd as WeekStart) ?? 1;
  }

  /** Which dates already have a note — drives the dots. */
  private indexExisting() {
    this.existing.clear();
    if (!this.plugin.settings.showDots) return;

    const cfg = this.plugin.configFor("day");
    for (const f of this.app.vault.getMarkdownFiles()) {
      const folderOk = !cfg.folder || f.path.startsWith(cfg.folder + "/");
      if (!folderOk) continue;
      const parsed = parseDate(f.basename, cfg.format, true);
      if (parsed.isValid()) this.existing.add(parsed.format("YYYY-MM-DD"));
    }
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("sundry-cal");
    this.indexExisting();

    const isPro = this.plugin.isPro;
    const ws = this.effectiveWeekStart();
    const grid = buildMonthGrid(this.year, this.month, ws, toISO(new Date(
      Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
    )));

    // ---- header -----------------------------------------------------------
    const head = root.createDiv({ cls: "sundry-cal-head" });
    const prev = head.createEl("button", { cls: "sundry-cal-nav", text: "\u2039" });
    prev.setAttribute("aria-label", "Previous month");
    prev.onclick = () => this.step(-1);

    const title = head.createDiv({ cls: "sundry-cal-title" });

    // ISSUE #313 / #145 — clicking the month or year opens that periodic note.
    // Two years requested, never shipped by the incumbent.
    const mEl = title.createSpan({ cls: "sundry-cal-month", text: MONTH_NAMES[this.month - 1] });
    const yEl = title.createSpan({ cls: "sundry-cal-year", text: String(this.year) });

    if (isPro) {
      mEl.addClass("is-clickable");
      yEl.addClass("is-clickable");
      mEl.setAttribute("aria-label", "Open monthly note");
      yEl.setAttribute("aria-label", "Open yearly note");
      mEl.onclick = (e) => this.openPeriodic("month", utc(this.year, this.month, 1), e);
      yEl.onclick = (e) => this.openPeriodic("year", utc(this.year, 1, 1), e);
    } else {
      const hint = "Opening monthly and yearly notes is a Pro feature";
      mEl.setAttribute("aria-label", hint);
      yEl.setAttribute("aria-label", hint);
    }

    const next = head.createEl("button", { cls: "sundry-cal-nav", text: "\u203A" });
    next.setAttribute("aria-label", "Next month");
    next.onclick = () => this.step(1);

    const todayBtn = head.createEl("button", { cls: "sundry-cal-today", text: "Today" });
    todayBtn.onclick = () => this.goToToday();

    // ---- grid -------------------------------------------------------------
    const table = root.createEl("table", { cls: "sundry-cal-grid" });
    const thead = table.createEl("thead").createEl("tr");
    if (this.plugin.settings.showWeekNumbers) thead.createEl("th", { cls: "sundry-cal-wk", text: "" });
    for (const label of weekdayLabels(ws)) thead.createEl("th", { text: label });

    const tbody = table.createEl("tbody");
    for (const week of grid.weeks) {
      const tr = tbody.createEl("tr");

      if (this.plugin.settings.showWeekNumbers) {
        const th = tr.createEl("th", { cls: "sundry-cal-wk", text: String(week.weekNumber) });
        if (isPro) {
          th.addClass("is-clickable");
          th.setAttribute("aria-label", "Open weekly note");
          const monday = week.days.find((d) => d.weekday === 1) ?? week.days[0];
          th.onclick = (e) => this.openPeriodic("week", utc(monday.year, monday.month, monday.day), e);
        }
      }

      for (const day of week.days) {
        const td = tr.createEl("td");
        const cell = td.createDiv({ cls: "sundry-cal-day", text: String(day.day) });
        if (!day.inMonth) cell.addClass("is-outside");
        if (day.isToday) cell.addClass("is-today");
        if (this.existing.has(day.iso)) cell.addClass("has-note");
        cell.onclick = (e) => this.openPeriodic("day", utc(day.year, day.month, day.day), e, day);
      }
    }

    if (!isPro) {
      const foot = root.createDiv({ cls: "sundry-cal-foot" });
      foot.createSpan({ text: "Monthly, weekly and yearly notes are Pro." });
    }
  }

  /** Open (or offer to create) the periodic note for a date. */
  private async openPeriodic(g: Granularity, date: Date, evt: MouseEvent, cell?: DayCell) {
    const cfg = this.plugin.configFor(g);

    if (!cfg.enabled) {
      new Notice(
        g === "day"
          ? "Daily notes are not configured. Enable the Daily Notes core plugin."
          : "No " + g + "ly note format is configured. Set one up in Periodic Notes."
      );
      return;
    }

    const formatted = parseDate(toISO(date), "YYYY-MM-DD").format(cfg.format);
    const path = normalizePath(notePath(cfg.folder, formatted));
    const existing = this.app.vault.getAbstractFileByPath(path);

    // ISSUE #272 — honour modifier keys and the new-tab setting so the note can
    // land in a split or stacked tab instead of hijacking the current pane.
    const newLeaf = evt.ctrlKey || evt.metaKey || this.plugin.settings.openInNewTab;

    if (existing instanceof TFile) {
      await this.app.workspace.getLeaf(newLeaf).openFile(existing);
      return;
    }

    if (this.plugin.settings.confirmBeforeCreate && cell && !cell.inMonth) {
      new Notice("No note for " + formatted + ".");
      return;
    }

    try {
      const file = await this.createNote(path, cfg.template);
      await this.app.workspace.getLeaf(newLeaf).openFile(file);
      this.render();
    } catch {
      new Notice("Could not create " + path + ".");
    }
  }

  private async createNote(path: string, templatePath: string): Promise<TFile> {
    const folder = path.split("/").slice(0, -1).join("/");
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => { /* raced, fine */ });
    }

    let body = "";
    if (templatePath) {
      const tpl = this.app.vault.getAbstractFileByPath(normalizePath(templatePath));
      if (tpl instanceof TFile) body = await this.app.vault.read(tpl);
    }

    return this.app.vault.create(path, body);
  }
}
