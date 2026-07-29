/**
 * A minimal in-memory stand-in for the Supabase query builder.
 *
 * The alternative — asserting that specific mock functions were called — would
 * pass even if the route wrote the wrong value to the wrong row, because a
 * call-count assertion cannot tell the difference. This keeps real rows in real
 * tables and lets the route's actual logic mutate them, so the tests can check
 * what the book of business looks like afterwards, which is the thing that
 * matters.
 *
 * It implements only the operations the Medicare routes use. Anything else
 * throws loudly rather than silently returning empty, so an untested query
 * shape surfaces as a failure instead of a false pass.
 */

export type Row = Record<string, unknown>;
export type Store = Record<string, Row[]>;

type Filter = { kind: 'eq' | 'in'; column: string; value: unknown };

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) =>
    filter.kind === 'eq'
      ? row[filter.column] === filter.value
      : Array.isArray(filter.value) && filter.value.includes(row[filter.column]),
  );
}

class QueryBuilder implements PromiseLike<{ data: Row[] | null; error: unknown }> {
  private filters: Filter[] = [];
  private operation: 'select' | 'update' | 'insert' = 'select';
  private payload: Row | Row[] | null = null;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private rowLimit: number | null = null;

  constructor(
    private store: Store,
    private table: string,
    /** Tables that should behave as if the migration has not run. */
    private missingTables: Set<string>,
  ) {}

  private get rows(): Row[] {
    return (this.store[this.table] ??= []);
  }

  select(_columns?: string) {
    if (this.operation !== 'update' && this.operation !== 'insert') this.operation = 'select';
    return this;
  }

  insert(payload: Row | Row[]) {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: 'eq', column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ kind: 'in', column, value });
    return this;
  }

  not(_column: string, _op: string, _value: unknown) {
    // The Today route excludes terminal statuses. Filtering is not what these
    // tests are about, so this is a documented no-op rather than a silent one.
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(count: number) {
    this.rowLimit = count;
    return this;
  }

  private run(): { data: Row[] | null; error: unknown } {
    if (this.missingTables.has(this.table)) {
      return { data: null, error: { message: `relation "${this.table}" does not exist`, code: '42P01' } };
    }

    if (this.operation === 'insert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const created = incoming.map((row) => ({ id: `generated-${this.rows.length + 1}`, ...row }));
      this.rows.push(...created);
      return { data: created, error: null };
    }

    if (this.operation === 'update') {
      const touched: Row[] = [];
      for (const row of this.rows) {
        if (!matches(row, this.filters)) continue;
        Object.assign(row, this.payload as Row);
        touched.push(row);
      }
      return { data: touched, error: null };
    }

    let result = this.rows.filter((row) => matches(row, this.filters));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      result = [...result].sort((a, b) => {
        const left = String(a[column] ?? '');
        const right = String(b[column] ?? '');
        return ascending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    if (this.rowLimit !== null) result = result.slice(0, this.rowLimit);
    // Copies, so a caller mutating a result cannot reach into the store.
    return { data: result.map((row) => ({ ...row })), error: null };
  }

  async maybeSingle() {
    const { data, error } = this.run();
    if (error) return { data: null, error };
    return { data: data && data.length > 0 ? data[0] : null, error: null };
  }

  async single() {
    const { data, error } = this.run();
    if (error) return { data: null, error };
    if (!data || data.length === 0) {
      return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
    }
    return { data: data[0], error: null };
  }

  then<TResult1 = { data: Row[] | null; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export function createFakeSupabase(store: Store, missingTables: string[] = []) {
  const missing = new Set(missingTables);
  return {
    from: (table: string) => new QueryBuilder(store, table, missing),
  };
}
