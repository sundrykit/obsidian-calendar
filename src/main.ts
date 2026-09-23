import { Plugin, PluginSettingTab, Setting, App, Notice, WorkspaceLeaf, requestUrl } from "obsidian";
import { CalendarView, VIEW_TYPE_CALENDAR } from "./view";
import { DEFAULT_SETTINGS, type CalendarSettings } from "./settings";
import { resolveConfig, type Granularity, type PeriodicConfig } from "./core/periodic";
import { activate, verifyToken, STORE_URL } from "./licence";
import type { ActivationResponse } from "./licence";

/**
 * Obsidian's own HTTP, not `fetch`. Its review rejects `fetch`, and requestUrl
 * routes around CORS and works on mobile, which the activation call has to.
 *
 * `throw: false` matters: by default requestUrl throws on a non-2xx, which
 * would turn "that key was not recognised" into the generic network-failure
 * message and tell a paying customer the wrong thing.
 */
const postJson = async (url: string, body: unknown): Promise<ActivationResponse> => {
  const res = await requestUrl({
    url,
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify(body),
    throw: false,
  });
  let parsed: { token?: string; error?: string } = {};
  try {
    parsed = JSON.parse(res.text) as { token?: string; error?: string };
  } catch {
    /* a non-JSON body is a server fault; an empty object reads as one */
  }
  return { status: res.status, body: parsed };
};

export default class CalendarPlugin extends Plugin {
  settings: CalendarSettings = DEFAULT_SETTINGS;
  isPro = false;

  async onload() {
    await this.loadSettings();
    this.isPro = await verifyToken(this.settings.licenceToken);

    this.registerView(VIEW_TYPE_CALENDAR, (leaf) => new CalendarView(leaf, this));

    this.addRibbonIcon("calendar-days", "Open calendar", () => this.activateView());

    // ISSUE #347 — a command-palette action to open the calendar. Requested and
    // never shipped by the incumbent. Costs nothing and people ask for it.
    this.addCommand({
      id: "open-calendar",
      name: "Open calendar",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "calendar-today",
      name: "Go to today",
      callback: async () => {
        const view = await this.activateView();
        view?.goToToday();
      },
    });

    this.addCommand({
      id: "calendar-prev-month",
      name: "Previous month",
      callback: async () => { (await this.activateView())?.step(-1); },
    });

    this.addCommand({
      id: "calendar-next-month",
      name: "Next month",
      callback: async () => { (await this.activateView())?.step(1); },
    });

    this.addSettingTab(new CalendarSettingTab(this.app, this));

    // Keep the dots honest when notes appear or disappear.
    this.registerEvent(this.app.vault.on("create", () => this.refresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.refresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.refresh()));
  }

  /** Reveal the calendar, creating the leaf if needed. */
  async activateView(): Promise<CalendarView | null> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)[0] ?? null;

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: VIEW_TYPE_CALENDAR, active: true });
    }

    // Not awaited: revealLeaf only returns a Promise on Obsidian 1.7.2+, and
    // awaiting it is what tripped the review's no-unsupported-api rule against
    // our declared minAppVersion. Nothing here depends on its completion.
    void workspace.revealLeaf(leaf);
    return leaf.view instanceof CalendarView ? leaf.view : null;
  }

  refresh() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)) {
      if (leaf.view instanceof CalendarView) leaf.view.render();
    }
  }

  /**
   * Read whatever periodic-note settings exist. We deliberately tolerate both
   * the core Daily Notes plugin and the community Periodic Notes plugin, so the
   * user never configures the same thing twice.
   */
  configFor(g: Granularity): PeriodicConfig {
    const anyApp = this.app as any;
    const daily = anyApp.internalPlugins?.getPluginById?.("daily-notes")?.instance?.options ?? null;
    const periodic = anyApp.plugins?.plugins?.["periodic-notes"]?.settings ?? null;
    return resolveConfig(g, { dailyNotes: daily, periodicNotes: periodic });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refresh();
  }
}

class CalendarSettingTab extends PluginSettingTab {
  plugin: CalendarPlugin;

  constructor(app: App, plugin: CalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Start week on")
      .setDesc("Defaults to whatever your Obsidian language setting uses.")
      .addDropdown((d) => d
        .addOption("locale", "Automatic")
        .addOption("0", "Sunday")
        .addOption("1", "Monday")
        .addOption("6", "Saturday")
        .setValue(String(this.plugin.settings.weekStart))
        .onChange(async (v) => {
          this.plugin.settings.weekStart = v === "locale" ? "locale" : (Number(v) as any);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Show week numbers")
      .addToggle((t) => t
        .setValue(this.plugin.settings.showWeekNumbers)
        .onChange(async (v) => { this.plugin.settings.showWeekNumbers = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Mark days that have a note")
      .setDesc("Adds a dot under any date with an existing daily note.")
      .addToggle((t) => t
        .setValue(this.plugin.settings.showDots)
        .onChange(async (v) => { this.plugin.settings.showDots = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName("Open notes in a new tab")
      .setDesc("You can also hold Ctrl or Cmd while clicking.")
      .addToggle((t) => t
        .setValue(this.plugin.settings.openInNewTab)
        .onChange(async (v) => { this.plugin.settings.openInNewTab = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Pro").setHeading();

    if (this.plugin.isPro) {
      new Setting(containerEl)
        .setName("Pro is active")
        .setDesc("Thank you. Weekly, monthly and yearly notes are unlocked.")
        .addButton((b) => b.setButtonText("Remove licence").onClick(async () => {
          this.plugin.settings.licenceToken = "";
          this.plugin.isPro = false;
          await this.plugin.saveSettings();
          this.display();
        }));
      return;
    }

    const desc = containerEl.createEl("p", { cls: "setting-item-description" });
    desc.setText("Pro adds clickable month, week and year headings that open the matching periodic note. One payment, no subscription, no account.");

    // Without this the free tier is a dead end: the settings tab asked for a
    // licence key and never said where one comes from.
    new Setting(containerEl)
      .setName("Get Pro")
      .setDesc("A$12, once. Your key arrives by email straight away.")
      .addButton((b) => b
        .setButtonText("Open store")
        .onClick(() => window.open(STORE_URL, "_blank")));

    let entered = "";
    new Setting(containerEl)
      .setName("Licence key")
      .setDesc("From your Gumroad receipt email.")
      .addText((t) => t.setPlaceholder("XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX")
        .onChange((v) => { entered = v; }))
      .addButton((b) => b.setButtonText("Activate").setCta().onClick(async () => {
        b.setButtonText("Checking...").setDisabled(true);
        const res = await activate(entered, postJson);
        b.setButtonText("Activate").setDisabled(false);

        if (!res.ok) { new Notice(res.message ?? "Activation failed."); return; }

        this.plugin.settings.licenceToken = res.token ?? "";
        this.plugin.isPro = await verifyToken(this.plugin.settings.licenceToken);
        await this.plugin.saveSettings();
        new Notice(res.message ?? "Pro activated.");
        this.display();
      }));
  }
}
