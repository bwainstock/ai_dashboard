export type DashboardViewName =
  | "Daily Brief"
  | "Calendar View"
  | "Lunch View";

export interface RenderInspection {
  viewport: { width: number; height: number };
  document: { width: number; height: number };
  overflowingElements: number;
  iconCount: number;
  textLength: number;
  minimumVisibleTextSize: number;
  nonMonochromeValues: string[];
  missingStates: Array<{
    text: string;
    fontSize: number;
    width: number;
    height: number;
  }>;
}

interface InspectablePage {
  evaluate<Result>(callback: () => Result): Promise<Result>;
}

function isBinaryMonochrome(value: string): boolean {
  if (value === "none" || value === "transparent") return true;
  const channels = value.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) return true;
  if (channels.length === 4 && channels[3] === 0) return true;
  return (
    channels[0] === channels[1] &&
    channels[1] === channels[2] &&
    (channels[0] === 0 || channels[0] === 255)
  );
}

export function assertRenderInspection(
  view: DashboardViewName,
  inspection: RenderInspection
): void {
  if (
    inspection.viewport.width !== 800 ||
    inspection.viewport.height !== 480
  ) {
    throw new Error(`${view} renderer viewport must be 800x480`);
  }
  if (
    inspection.document.width > 800 ||
    inspection.document.height > 480 ||
    inspection.overflowingElements > 0
  ) {
    throw new Error(`${view} renderer content overflows 800x480`);
  }
  if (inspection.iconCount < 1 || inspection.textLength < 1) {
    throw new Error(`${view} renderer must include an icon and readable text`);
  }
  if (
    inspection.minimumVisibleTextSize < DEVICE_LIMITS.minimumVisibleTextPixels
  ) {
    throw new Error(
      `${view} renderer text must be at least ${DEVICE_LIMITS.minimumVisibleTextPixels}px`
    );
  }
  if (inspection.nonMonochromeValues.length > 0) {
    throw new Error(`${view} renderer must use only black and white`);
  }
  if (
    inspection.missingStates.some(
      ({ text, fontSize, width, height }) =>
        text.trim().length === 0 || fontSize < 14 || width <= 0 || height <= 0
    )
  ) {
    throw new Error(`${view} renderer has an unreadable missing-data state`);
  }
}

export async function validateRenderedPage(
  page: InspectablePage,
  view: DashboardViewName
): Promise<void> {
  const inspection = await page.evaluate<RenderInspection>(() => {
    const values = new Set<string>();
    const properties = [
      "color",
      "backgroundColor",
      "borderTopColor",
      "borderRightColor",
      "borderBottomColor",
      "borderLeftColor",
      "fill",
      "stroke"
    ] as const;
    for (const element of Array.from(document.querySelectorAll("*"))) {
      const style = getComputedStyle(element);
      for (const property of properties) values.add(style[property]);
    }
    const missingStates = Array.from(
      document.querySelectorAll<HTMLElement>("[data-missing-state]")
    ).map((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        text: element.innerText,
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        width: bounds.width,
        height: bounds.height
      };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight
      },
      overflowingElements: Array.from(
        document.body.querySelectorAll<HTMLElement>("*")
      ).filter((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left < 0 ||
          bounds.top < 0 ||
          bounds.right > innerWidth ||
          bounds.bottom > innerHeight ||
          element.scrollWidth > element.clientWidth ||
          element.scrollHeight > element.clientHeight
        );
      }).length,
      iconCount: document.querySelectorAll('[role="img"]').length,
      textLength: document.body.innerText.trim().length,
      minimumVisibleTextSize: Math.min(
        ...Array.from(document.body.querySelectorAll<HTMLElement>("*"))
          .filter((element) => {
            const style = getComputedStyle(element);
            return (
              element.childElementCount === 0 &&
              element.innerText.trim().length > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden"
            );
          })
          .map((element) =>
            Number.parseFloat(getComputedStyle(element).fontSize)
          )
      ),
      nonMonochromeValues: [...values].filter(
        (value) =>
          !(
            value === "none" ||
            value === "transparent" ||
            (() => {
              const channels = value.match(/[\d.]+/g)?.map(Number);
              if (!channels || channels.length < 3) return true;
              if (channels.length === 4 && channels[3] === 0) return true;
              return (
                channels[0] === channels[1] &&
                channels[1] === channels[2] &&
                (channels[0] === 0 || channels[0] === 255)
              );
            })()
          )
      ),
      missingStates
    };
  });
  inspection.nonMonochromeValues = inspection.nonMonochromeValues.filter(
    (value) => !isBinaryMonochrome(value)
  );
  assertRenderInspection(view, inspection);
}
import { DEVICE_LIMITS } from "./device-limits";
