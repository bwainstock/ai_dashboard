import { describe, expect, test, vi } from "vitest";
import {
  classifyLunchEntree,
  fetchMealViewerMenu,
  LUNCH_ICONS,
  LunchAdapterError
} from "../src/lunch";

describe("MealViewer lunch adapter", () => {
  test("retains only normalized school dates, entree names, and reliable closures", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({
        menuSchedules: [
          {
            date: "2026-10-07T00:00:00",
            isClosed: false,
            menuBlocks: [
              {
                type: "Lunch",
                menuItems: [
                  { name: "  Cheese   Pizza  ", category: "Entree" },
                  { name: "Garden Salad", category: "Side" },
                  {
                    name: "Chocolate Milk",
                    category: "Beverage",
                    nutrition: { calories: 120 },
                    allergens: ["milk"]
                  }
                ]
              },
              {
                type: "Breakfast",
                menuItems: [{ name: "Waffles", category: "Entree" }]
              }
            ]
          },
          {
            date: "2026-10-08",
            isClosed: true,
            closureReason: "Staff learning day",
            menuBlocks: []
          }
        ]
      })
    );

    const snapshot = await fetchMealViewerMenu(
      "https://example.test/api/v4/menu",
      request
    );

    expect(snapshot).toEqual({
      days: [
        {
          date: "2026-10-07",
          status: "menu",
          entrees: ["Cheese Pizza"]
        },
        { date: "2026-10-08", status: "closed", entrees: [] }
      ]
    });

    expect(JSON.stringify(snapshot)).not.toMatch(
      /breakfast|side|nutrition|allergen|milk|reason/i
    );
  });

  test("a valid source response without today's menu remains an explicit missing menu", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({ menuSchedules: [] })
    );

    await expect(
      fetchMealViewerMenu("https://example.test/api/v4/menu", request)
    ).resolves.toEqual({ days: [] });
  });

  test("schema drift is an explicit adapter failure rather than an empty menu", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({ schedules: [{ servingDate: "2026-10-07" }] })
    );

    await expect(
      fetchMealViewerMenu("https://example.test/api/v4/menu", request)
    ).rejects.toEqual(
      new LunchAdapterError(
        "LUNCH_INVALID_RESPONSE",
        "MealViewer response is missing menuSchedules"
      )
    );
  });
});

describe("lunch icon classification", () => {
  test.each([
    ["Cheese Pizza", "pizza"],
    ["Beef Street Tacos", "taco"],
    ["Turkey & Cheese Sandwich", "sandwich"],
    ["Crispy Chicken Drumstick", "chicken"],
    ["Penne with Marinara", "pasta"],
    ["Southwest Salad", "salad"]
  ])("%s has a deterministic closed-set icon", async (entree, icon) => {
    const classifyWithAi = vi.fn();

    await expect(
      classifyLunchEntree(entree, {
        loadCached: vi.fn().mockResolvedValue(null),
        saveCached: vi.fn(),
        classifyWithAi
      })
    ).resolves.toBe(icon);
    expect(classifyWithAi).not.toHaveBeenCalled();
  });

  test("a valid AI decision for an unknown entree is constrained and cached", async () => {
    const saveCached = vi.fn();
    const classifyWithAi = vi.fn().mockResolvedValue("pasta");

    await expect(
      classifyLunchEntree("Vegetable Yakisoba", {
        loadCached: vi.fn().mockResolvedValue(null),
        saveCached,
        classifyWithAi
      })
    ).resolves.toBe("pasta");
    expect(classifyWithAi).toHaveBeenCalledWith({
      entree: "Vegetable Yakisoba",
      allowedIcons: LUNCH_ICONS
    });
    expect(saveCached).toHaveBeenCalledWith("vegetable yakisoba", "pasta");
  });

  test("a cached accepted mapping is used before AI", async () => {
    const classifyWithAi = vi.fn();

    await expect(
      classifyLunchEntree("Vegetable Yakisoba", {
        loadCached: vi.fn().mockResolvedValue("pasta"),
        saveCached: vi.fn(),
        classifyWithAi
      })
    ).resolves.toBe("pasta");
    expect(classifyWithAi).not.toHaveBeenCalled();
  });

  test.each(["maybe chicken", '{"icon":"taco"}', "", "burger", null])(
    "invalid or uncertain AI output %j fails closed to generic",
    async (output) => {
      const saveCached = vi.fn();

      await expect(
        classifyLunchEntree("Chef Surprise", {
          loadCached: vi.fn().mockResolvedValue(null),
          saveCached,
          classifyWithAi: vi.fn().mockResolvedValue(output)
        })
      ).resolves.toBe("generic");
      expect(saveCached).not.toHaveBeenCalled();
    }
  );
});
