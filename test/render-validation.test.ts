import { afterEach, describe, expect, test, vi } from "vitest";
import {
  assertRenderInspection,
  type DashboardViewName,
  type RenderInspection,
  validateRenderedPage
} from "../src/render-validation";

const VIEWS: DashboardViewName[] = [
  "Daily Brief",
  "Calendar View",
  "Lunch View",
  "Notices View"
];

afterEach(() => {
  vi.unstubAllGlobals();
});

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

async function validateDescendant(
  elementValues: Record<string, unknown> = {},
  documentValues: { scrollWidth?: number; scrollHeight?: number } = {},
  styleValues: Record<string, string> = {}
): Promise<void> {
  const bounds = {
    left: 0,
    top: 0,
    right: 100,
    bottom: 20,
    width: 100,
    height: 20
  };
  const textElement = {
    childElementCount: 0,
    innerText: "Daily Brief",
    textContent: "Daily Brief",
    scrollWidth: 100,
    clientWidth: 100,
    scrollHeight: 24,
    clientHeight: 20,
    getBoundingClientRect: () => bounds,
    ...elementValues
  };
  const svgElement = {
    childElementCount: 0,
    textContent: "",
    scrollWidth: 20,
    clientWidth: 20,
    scrollHeight: 20,
    clientHeight: 20,
    getBoundingClientRect: () => ({ ...bounds, right: 20, width: 20 })
  };
  const descendants = [textElement, svgElement];
  const body = {
    innerText: "Daily Brief",
    querySelectorAll: () => descendants
  };

  vi.stubGlobal("innerWidth", 800);
  vi.stubGlobal("innerHeight", 480);
  vi.stubGlobal("document", {
    documentElement: {
      scrollWidth: 800,
      scrollHeight: 480,
      ...documentValues
    },
    body,
    querySelectorAll: (selector: string) => {
      if (selector === "*") return descendants;
      if (selector === '[role="img"]') return [svgElement];
      return [];
    }
  });
  vi.stubGlobal("getComputedStyle", () => ({
    color: "rgb(0, 0, 0)",
    backgroundColor: "rgb(255, 255, 255)",
    borderTopColor: "rgb(0, 0, 0)",
    borderRightColor: "rgb(0, 0, 0)",
    borderBottomColor: "rgb(0, 0, 0)",
    borderLeftColor: "rgb(0, 0, 0)",
    fill: "rgb(0, 0, 0)",
    stroke: "none",
    display: "block",
    visibility: "visible",
    fontSize: "16px",
    overflowX: "visible",
    overflowY: "visible",
    ...styleValues
  }));

  await validateRenderedPage(
    {
      evaluate: async <Result>(callback: () => Result) => callback()
    },
    "Daily Brief"
  );
}

test("accepts an in-bounds text element with 4px vertical font-metric overflow", async () => {
  await expect(validateDescendant()).resolves.toBeUndefined();
});

test("accepts intentionally clipped text overflow", async () => {
  await expect(
    validateDescendant(
      { scrollWidth: 180, scrollHeight: 80 },
      {},
      { overflowX: "hidden", overflowY: "hidden" }
    )
  ).resolves.toBeUndefined();
});

test.each([
  [
    "outside viewport bounds",
    { getBoundingClientRect: () => ({ left: 0, top: 0, right: 801, bottom: 20 }) },
    {}
  ],
  ["outside document bounds", {}, { scrollHeight: 481 }],
  ["horizontal scroll overflow", { scrollWidth: 101 }, {}],
  ["5px vertical scroll overflow", { scrollHeight: 25 }, {}]
])("rejects a descendant with %s", async (_label, elementValues, documentValues) => {
  await expect(
    validateDescendant(elementValues, documentValues)
  ).rejects.toThrow("Daily Brief renderer content overflows 800x480");
});

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
