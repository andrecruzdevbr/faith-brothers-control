export const PAGED_QUERY_PAGE_SIZE = 1000;
export const PAGED_QUERY_MAX_PAGES = 50;
export const PAGED_QUERY_TRUNCATED_MESSAGE =
  "Consulta excedeu o limite de paginação. Totais incompletos foram bloqueados.";

export async function fetchAllRows<T>(
  load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  options?: { pageSize?: number; maxPages?: number },
): Promise<T[]> {
  const pageSize = options?.pageSize ?? PAGED_QUERY_PAGE_SIZE;
  const maxPages = options?.maxPages ?? PAGED_QUERY_MAX_PAGES;
  if (pageSize <= 0 || maxPages <= 0) {
    throw new Error("Parâmetros de paginação inválidos.");
  }

  const rows: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const { data, error } = await load(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }

  throw new Error(PAGED_QUERY_TRUNCATED_MESSAGE);
}
