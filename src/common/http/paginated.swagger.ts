import type { Type } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

/** OpenAPI shapes for `paginationEnvelope()` (ch. 3 §3.2). */
export class PaginationLinks {
  @ApiProperty()
  first!: string;

  @ApiProperty()
  last!: string;

  @ApiProperty({ type: String, nullable: true })
  prev!: string | null;

  @ApiProperty({ type: String, nullable: true })
  next!: string | null;
}

export class PaginationMetaLink {
  @ApiProperty({ type: String, nullable: true })
  url!: string | null;

  @ApiProperty()
  label!: string;

  @ApiProperty({ type: Number, nullable: true, required: false })
  page?: number | null;

  @ApiProperty()
  active!: boolean;
}

export class PaginationMeta {
  @ApiProperty()
  current_page!: number;

  @ApiProperty({ type: Number, nullable: true })
  from!: number | null;

  @ApiProperty()
  last_page!: number;

  @ApiProperty({ type: [PaginationMetaLink] })
  links!: PaginationMetaLink[];

  @ApiProperty()
  path!: string;

  @ApiProperty()
  per_page!: number;

  @ApiProperty({ type: Number, nullable: true })
  to!: number | null;

  @ApiProperty()
  total!: number;
}

/** A named collection schema: `{ data: T[], links, meta }`. */
export function PaginatedResponse<T>(
  item: Type<T>,
  name: string,
): Type<{ data: T[]; links: PaginationLinks; meta: PaginationMeta }> {
  class Collection {
    @ApiProperty({ type: [item] })
    data!: T[];

    @ApiProperty({ type: PaginationLinks })
    links!: PaginationLinks;

    @ApiProperty({ type: PaginationMeta })
    meta!: PaginationMeta;
  }
  Object.defineProperty(Collection, 'name', { value: name });
  return Collection;
}
