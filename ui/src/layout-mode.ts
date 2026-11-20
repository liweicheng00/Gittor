// The layout modes for the width of the window. The module is pure, so the unit tests can load it.

/** "wide": three columns. "medium": the left pane and the log, with the commit details under the log.
 * "narrow": one column with tabs, for a side panel of another app. */
export type LayoutMode = "wide" | "medium" | "narrow";

/** Below this width (CSS px), the layout has one column. */
export const NARROW_BELOW = 640;
/** Below this width, the right column goes away. The wide layout needs 280 + 4 + 300 + 4 + 360 px. */
export const MEDIUM_BELOW = 948;

export function layoutModeFor(width: number): LayoutMode {
  if (width < NARROW_BELOW) return "narrow";
  if (width < MEDIUM_BELOW) return "medium";
  return "wide";
}

/** The grid of the top part (left pane, center, right column) for a layout mode. Each visible part
 * gets its place, so a hidden part does not move the others into its cells. */
export interface TopGrid {
  columns: string;
  rows: string;
  /** The place of each part: [column, row], with "1 / -1" for all rows. Null hides the part. */
  places: Record<"left" | "sideGrip" | "center" | "rightGrip" | "right" | "detailsGrip", [string, string] | null>;
}

export interface TopGridInput {
  mode: LayoutMode;
  showSidebar: boolean;
  sidebarWidth: number;
  rightWidth: number;
  /** The height of the commit details under the log (medium and narrow). */
  detailsHeight: number;
  /** Narrow only: the Log tab shows (else the active left tab). */
  logTab: boolean;
}

export function topGrid(i: TopGridInput): TopGrid {
  const none = { left: null, sideGrip: null, center: null, rightGrip: null, right: null, detailsGrip: null };
  const logRows = `minmax(0, 1fr) 5px ${i.detailsHeight}px`;
  if (i.mode === "wide") {
    const cols = i.showSidebar ? [`${i.sidebarWidth}px`, "4px"] : [];
    const c = cols.length;
    return {
      columns: [...cols, "minmax(300px, 1fr)", "4px", `${i.rightWidth}px`].join(" "),
      rows: "minmax(0, 1fr)",
      places: {
        ...none,
        left: i.showSidebar ? ["1", "1"] : null,
        sideGrip: i.showSidebar ? ["2", "1"] : null,
        center: [String(c + 1), "1"],
        rightGrip: [String(c + 2), "1"],
        right: [String(c + 3), "1"],
      },
    };
  }
  if (i.mode === "medium") {
    const cols = i.showSidebar ? [`${i.sidebarWidth}px`, "4px"] : [];
    const c = String(cols.length + 1);
    return {
      columns: [...cols, "minmax(0, 1fr)"].join(" "),
      rows: logRows,
      places: {
        ...none,
        left: i.showSidebar ? ["1", "1 / -1"] : null,
        sideGrip: i.showSidebar ? ["2", "1 / -1"] : null,
        center: [c, "1"],
        detailsGrip: [c, "2"],
        right: [c, "3"],
      },
    };
  }
  if (i.logTab) return { columns: "minmax(0, 1fr)", rows: logRows, places: { ...none, center: ["1", "1"], detailsGrip: ["1", "2"], right: ["1", "3"] } };
  return { columns: "minmax(0, 1fr)", rows: "minmax(0, 1fr)", places: { ...none, left: ["1", "1"] } };
}
