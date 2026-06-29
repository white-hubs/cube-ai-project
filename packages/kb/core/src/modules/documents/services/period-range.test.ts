import { BadRequestException } from "@dangao/bun-server";
import { describe, expect, test } from "bun:test";

import { parsePeriodRange } from "./period-range";

describe("parsePeriodRange", () => {
  test("returns undefined when period is missing", () => {
    expect(parsePeriodRange(undefined)).toBeUndefined();
  });

  test("parses yyyy-MM-dd HH:mm:ss to Date range", () => {
    const range = parsePeriodRange({
      endTime: "2024-01-02 23:59:59",
      startTime: "2024-01-01 00:00:00",
    });
    expect(range?.start).toBeInstanceOf(Date);
    expect(range?.end).toBeInstanceOf(Date);
    expect(range?.start.getTime()).toBeLessThanOrEqual(range?.end.getTime() ?? 0);
  });

  test("throws on startTime > endTime", () => {
    expect(() =>
      parsePeriodRange({
        endTime: "2024-01-02 23:59:59",
        startTime: "2024-01-03 00:00:00",
      }),
    ).toThrow(BadRequestException);
  });

  test("throws on invalid datetime string", () => {
    expect(() =>
      parsePeriodRange({
        endTime: "2024-01-02 23:59:59",
        startTime: "invalid",
      }),
    ).toThrow(BadRequestException);
  });
});
