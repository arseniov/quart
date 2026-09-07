import type { ColumnType, Generated } from 'kysely';

export interface CitiesTable {
  id: Generated<string>;
  slug: string;
  name: string;
  country_code: string;
  locale_default: string;
  timezone: string;
  bounds: ColumnType<unknown | null, unknown | null | undefined, unknown | null>;
  status: 'active' | 'inactive';
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

// ponytail: stub interfaces for tables that exist after migrations land.
// They live here so the PII helper can be fully typed without `any`.
export interface PiiKeyVersionsTable {
  id: Generated<string>;
  city_id: string;
  status: 'active' | 'rotating' | 'retired';
  dek_bytes: Buffer;
}

export interface PiiColumnsTable {
  id: Generated<string>;
  key_version_id: string;
  table_name: string;
  column_name: string;
}

export interface DB {
  cities: CitiesTable;
  pii_key_versions: PiiKeyVersionsTable;
  pii_columns: PiiColumnsTable;
}
