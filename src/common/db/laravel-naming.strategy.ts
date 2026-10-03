import { DefaultNamingStrategy, Table, View } from 'typeorm';

/**
 * Laravel's names: snake_case columns, and the constraint and index names
 * Laravel's schema builder gives on Postgres (`users_pkey`,
 * `users_email_unique`, `forms_user_id_foreign`,
 * `form_entry_exports_expires_at_index`, `form_notifications_type_check`).
 */
export class LaravelNamingStrategy extends DefaultNamingStrategy {
  override columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    return snakeCase(
      [...embeddedPrefixes, customName ?? propertyName].join('_'),
    );
  }

  override joinColumnName(
    relationName: string,
    referencedColumnName: string,
  ): string {
    return snakeCase(`${relationName}_${referencedColumnName}`);
  }

  override primaryKeyName(tableOrName: Table | string): string {
    return `${tableName(tableOrName)}_pkey`;
  }

  override uniqueConstraintName(
    tableOrName: Table | string,
    columnNames: string[],
  ): string {
    return `${tableName(tableOrName)}_${columnNames.join('_')}_unique`;
  }

  override foreignKeyName(
    tableOrName: Table | string,
    columnNames: string[],
  ): string {
    return `${tableName(tableOrName)}_${columnNames.join('_')}_foreign`;
  }

  override indexName(
    tableOrName: Table | View | string,
    columns: string[],
  ): string {
    return `${tableName(tableOrName)}_${columns.join('_')}_index`;
  }

  /** Laravel names an enum's check after its column: `{table}_{column}_check`. */
  override checkConstraintName(
    tableOrName: Table | string,
    expression: string,
    isEnum?: boolean,
  ): string {
    const column = /^\s*"?([a-z_][a-z0-9_]*)"?/i.exec(expression)?.[1];
    return column === undefined
      ? super.checkConstraintName(tableOrName, expression, isEnum)
      : `${tableName(tableOrName)}_${column}_check`;
  }
}

function tableName(tableOrName: Table | View | string): string {
  const name = typeof tableOrName === 'string' ? tableOrName : tableOrName.name;
  return name.split('.').pop() ?? name;
}

function snakeCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
