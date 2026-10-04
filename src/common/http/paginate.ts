import type { Request } from 'express';
import { isFilterInt } from '../validation/php';
import { httpBuildQuery } from './http-build-query';
import { requestInput } from './request-input';

/**
 * Laravel's paginated resource collection (ch. 3 §3.2, _Paginated
 * collection_): `LengthAwarePaginator` + `UrlWindow` + the resource
 * response's `links`/`meta`. Golden fixtures from Laravel pin the output.
 */
export interface PaginationLink {
  url: string | null;
  label: string;
  page?: number | null;
  active: boolean;
}

export interface Paginated<T> {
  data: T[];
  links: {
    first: string;
    last: string;
    prev: string | null;
    next: string | null;
  };
  meta: {
    current_page: number;
    from: number | null;
    last_page: number;
    links: PaginationLink[];
    path: string;
    per_page: number;
    to: number | null;
    total: number;
  };
}

export interface PageContext {
  /** `$request->url()`: scheme, host and path, no query, no trailing slash. */
  path: string;
  /** `withQueryString()`: the cleaned query (without `page`), or null to drop it. */
  query: Record<string, unknown> | null;
}

/** `UrlWindow` with Laravel's default `onEachSide` of 3. */
const ON_EACH_SIDE = 3;

/**
 * The paginator's current-page resolver: `input('page')` when it passes
 * `FILTER_VALIDATE_INT` and is at least 1, else 1 (`abc`, `0`, `-2`, `2.5`
 * and `page[]=2` all give 1).
 */
export function resolvePage(value: unknown): number {
  return isFilterInt(value) && Number(String(value).trim()) >= 1
    ? Number(String(value).trim())
    : 1;
}

export function paginationEnvelope<T>(
  items: T[],
  total: number,
  perPage: number,
  page: number,
  context: PageContext,
): Paginated<T> {
  const lastPage = Math.max(Math.ceil(total / perPage), 1);
  const url = (target: number): string => {
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context.query ?? {})) {
      if (key !== 'page') params[key] = value;
    }
    params.page = Math.max(target, 1);
    return `${context.path}?${httpBuildQuery(params)}`;
  };
  const range = (start: number, end: number): [number, string][] => {
    const out: [number, string][] = [];
    for (let p = start; p <= end; p++) out.push([p, url(p)]);
    return out;
  };

  const elements = urlWindow(page, lastPage, range);
  const pageLinks = elements.flatMap((element): PaginationLink[] =>
    element === '...'
      ? [{ url: null, label: '...', active: false }]
      : element.map(([p, link]) => ({
          url: link,
          label: String(p),
          page: p,
          active: p === page,
        })),
  );

  const hasMore = page < lastPage;
  const prev = page > 1 ? url(page - 1) : null;
  const next = hasMore ? url(page + 1) : null;
  const from = items.length > 0 ? (page - 1) * perPage + 1 : null;

  return {
    data: items,
    links: { first: url(1), last: url(lastPage), prev, next },
    meta: {
      current_page: page,
      from,
      last_page: lastPage,
      links: [
        {
          url: prev,
          label: '&laquo; Previous',
          page: page > 1 ? page - 1 : null,
          active: false,
        },
        ...pageLinks,
        {
          url: next,
          label: 'Next &raquo;',
          page: hasMore ? page + 1 : null,
          active: false,
        },
      ],
      path: context.path,
      per_page: perPage,
      to: from === null ? null : from + items.length - 1,
      total,
    },
  };
}

type Range = [number, string][];

/** `UrlWindow::get()` + `AbstractPaginator::elements()`. */
function urlWindow(
  current: number,
  last: number,
  range: (start: number, end: number) => Range,
): (Range | '...')[] {
  const parts: {
    first: Range | null;
    slider: Range | null;
    last: Range | null;
  } = (() => {
    if (last < ON_EACH_SIDE * 2 + 8)
      return { first: range(1, last), slider: null, last: null };
    const window = ON_EACH_SIDE + 4;
    if (last <= 1) return { first: null, slider: null, last: null };
    if (current <= window) {
      return {
        first: range(1, window + ON_EACH_SIDE),
        slider: null,
        last: range(last - 1, last),
      };
    }
    if (current > last - window) {
      return {
        first: range(1, 2),
        slider: null,
        last: range(last - (window + (ON_EACH_SIDE - 1)), last),
      };
    }
    return {
      first: range(1, 2),
      slider: range(current - ON_EACH_SIDE, current + ON_EACH_SIDE),
      last: range(last - 1, last),
    };
  })();

  // array_filter() drops nulls and empty arrays.
  return [
    parts.first,
    parts.slider ? '...' : null,
    parts.slider,
    parts.last ? '...' : null,
    parts.last,
  ].filter(
    (part): part is Range | '...' =>
      part !== null && (part === '...' || part.length > 0),
  );
}

/** `$request->url()`: the request's own scheme and host (forwarded ones behind a trusted proxy). */
export function requestUrl(req: Request): string {
  return `${req.protocol}://${req.get('host') ?? ''}${req.path}`.replace(
    /\/+$/,
    '',
  );
}

/**
 * Paginates for a controller: `page` from the prepared input, links on the
 * request's own URL, and the query string kept (`withQueryString()`) unless
 * `keepQuery` is false (notifications drop it, ch. 3 §3.2).
 */
export function paginationContext(
  req: Request,
  keepQuery: boolean,
): { page: number; context: PageContext } {
  const input = requestInput(req);
  return {
    page: resolvePage(input.all.page),
    context: { path: requestUrl(req), query: keepQuery ? input.query : null },
  };
}
