import type { WeekStart } from "./core/grid";

export interface CalendarSettings {
  weekStart: WeekStart | "locale";
  showWeekNumbers: boolean;
  showDots: boolean;
  confirmBeforeCreate: boolean;
  openInNewTab: boolean;
  /** Pro. Signed offline token; empty means free tier. */
  licenceToken: string;
}

export const DEFAULT_SETTINGS: CalendarSettings = {
  weekStart: "locale",
  showWeekNumbers: true,
  showDots: true,
  confirmBeforeCreate: false,
  openInNewTab: false,
  licenceToken: "",
};
