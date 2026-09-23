/**
 * Periodic-note settings resolution. Pure — no Obsidian imports.
 *
 * Obsidian's core Daily Notes plugin and the community Periodic Notes plugin
 * store their settings differently. We read whichever is present and normalise,
 * so the user never has to configure the same thing twice.
 */

export type Granularity = "day" | "week" | "month" | "year";

export interface PeriodicConfig {
  format: string;
  folder: string;
  template: string;
  enabled: boolean;
}

export const DEFAULT_FORMATS: Record<Granularity, string> = {
  day: "YYYY-MM-DD",
  week: "gggg-[W]ww",
  month: "YYYY-MM",
  year: "YYYY",
};

/** Raw settings blobs as they appear on disk. Deliberately loose. */
export interface RawSources {
  dailyNotes?: { format?: string; folder?: string; template?: string } | null;
  periodicNotes?: Record<string, { enabled?: boolean; format?: string; folder?: string; template?: string }> | null;
}

/**
 * Work out the config for one granularity.
 *
 * Precedence: the Periodic Notes plugin wins where it is enabled, because a
 * user who installed it expects it to be authoritative. Core Daily Notes is the
 * fallback for `day`. Anything missing falls back to a sane default.
 */
export function resolveConfig(g: Granularity, src: RawSources): PeriodicConfig {
  const pn = src.periodicNotes?.[g];
  if (pn?.enabled) {
    return {
      format: nonEmpty(pn.format) ?? DEFAULT_FORMATS[g],
      folder: normaliseFolder(pn.folder),
      template: nonEmpty(pn.template) ?? "",
      enabled: true,
    };
  }

  if (g === "day" && src.dailyNotes) {
    return {
      format: nonEmpty(src.dailyNotes.format) ?? DEFAULT_FORMATS.day,
      folder: normaliseFolder(src.dailyNotes.folder),
      template: nonEmpty(src.dailyNotes.template) ?? "",
      enabled: true,
    };
  }

  // Not configured. Day still works on defaults; the others are opt-in, because
  // silently creating monthly notes a user never asked for is worse than not.
  return {
    format: DEFAULT_FORMATS[g],
    folder: "",
    template: "",
    enabled: g === "day",
  };
}

function nonEmpty(s: string | undefined): string | undefined {
  const t = (s ?? "").trim();
  return t.length ? t : undefined;
}

/** Strip leading/trailing slashes and collapse doubles. "" means vault root. */
export function normaliseFolder(folder: string | undefined): string {
  const f = (folder ?? "").trim().split(String.fromCharCode(92)).join("/");
  return f.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

/**
 * Build the note path from an already-formatted date string.
 *
 * Formatting is done by the caller with moment, because format tokens are
 * moment's job. This function is only responsible for path assembly — which is
 * where the slash bugs live.
 */
export function notePath(folder: string, formatted: string): string {
  const f = normaliseFolder(folder);
  const name = formatted.replace(/^\/+/, "");
  return (f ? f + "/" : "") + name + ".md";
}
