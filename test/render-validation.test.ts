import { describe, expect, test } from "vitest";
import {
  assertRenderInspection,
  type DashboardViewName,
  type RenderInspection
} from "../src/render-validation";

const VIEWS: DashboardViewName[] = [
  "Daily Brief",
  "Calendar View",
  "Lunch View"
];

function inspection(
  values: Partial<RenderInspection> = {}
): RenderInspection {
  return {
    viewport: { width: 800, height: 480 },
    document: { width: 800, height: 480 },
    overflowingElements: 0,
    iconCount: 1,
    textLength: 20,
    minimumVisibleTextSize: 14,
    nonMonochromeValues: [],
    missingStates: [
      {
        text: "No menu posted",
        fontSize: 16,
        width: 120,
        height: 40
      }
    ],
    ...values
  };
}

describe.each(VIEWS)("%s renderer validation", (view) => {
  test("accepts an 800x480 monochrome render with icons, text, and readable missing states", () => {
    expect(() => assertRenderInspection(view, inspection())).not.toThrow();
  });

  test.each([
    ["overflow", { overflowingElements: 1 }],
    ["missing icon", { iconCount: 0 }],
    ["text below the tested device limit", { minimumVisibleTextSize: 11 }],
    ["color", { nonMonochromeValues: ["rgb(255, 0, 0)"] }],
    [
      "unreadable missing state",
      {
        missingStates: [
          { text: "Unavailable", fontSize: 12, width: 100, height: 20 }
        ]
      }
    ]
  ])("rejects %s", (_label, values) => {
    expect(() =>
      assertRenderInspection(view, inspection(values as Partial<RenderInspection>))
    ).toThrow();
  });
});
