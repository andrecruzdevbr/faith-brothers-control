import { describe, expect, it } from "vitest";
import {
  fetchAllRows,
  PAGED_QUERY_TRUNCATED_MESSAGE,
} from "@/lib/paged-query";

function pagesOf<T>(pages: T[][]) {
  return async (from: number, to: number) => {
    const pageSize = to - from + 1;
    const index = Math.floor(from / pageSize);
    return { data: pages[index] ?? [], error: null };
  };
}

describe("fetchAllRows", () => {
  it("returns an empty list when the first page is empty", async () => {
    await expect(fetchAllRows(pagesOf<number>([[]]), { pageSize: 2, maxPages: 3 })).resolves.toEqual([]);
  });

  it("concatenates pages until a short batch", async () => {
    await expect(
      fetchAllRows(pagesOf([[1, 2], [3]]), { pageSize: 2, maxPages: 5 }),
    ).resolves.toEqual([1, 2, 3]);
  });

  it("throws when a query error occurs", async () => {
    await expect(
      fetchAllRows(async () => ({ data: null, error: { message: "permission denied" } }), {
        pageSize: 2,
        maxPages: 3,
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("throws instead of returning a truncated total when the max page is full", async () => {
    await expect(
      fetchAllRows(pagesOf([[1, 2], [3, 4], [5, 6]]), { pageSize: 2, maxPages: 2 }),
    ).rejects.toThrow(PAGED_QUERY_TRUNCATED_MESSAGE);
  });

  it("returns the full set when the last allowed page is short", async () => {
    await expect(
      fetchAllRows(pagesOf([[1, 2], [3]]), { pageSize: 2, maxPages: 2 }),
    ).resolves.toEqual([1, 2, 3]);
  });
});
