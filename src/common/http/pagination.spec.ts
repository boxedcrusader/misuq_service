import { BadRequestException } from "@nestjs/common";
import { MAX_PAGE_SIZE, parsePagination } from "./pagination";

describe("parsePagination", () => {
  it("defaults when absent", () => {
    expect(parsePagination(undefined, undefined)).toEqual({ page: 1, limit: 20 });
    expect(parsePagination(undefined, undefined, 50)).toEqual({ page: 1, limit: 50 });
  });

  it("accepts plain positive integers", () => {
    expect(parsePagination("3", "10")).toEqual({ page: 3, limit: 10 });
  });

  it.each(["abc", "0", "-1", "1.5", "1e3", " 2", "0x10"])("400s on page=%s (pentest: these used to 500)", (page) => {
    expect(() => parsePagination(page, undefined)).toThrow(BadRequestException);
  });

  it("caps limit at MAX_PAGE_SIZE (pentest: limit=1000000 was honored)", () => {
    expect(parsePagination(undefined, String(MAX_PAGE_SIZE)).limit).toBe(MAX_PAGE_SIZE);
    expect(() => parsePagination(undefined, String(MAX_PAGE_SIZE + 1))).toThrow(BadRequestException);
    expect(() => parsePagination(undefined, "1000000")).toThrow(BadRequestException);
  });
});
