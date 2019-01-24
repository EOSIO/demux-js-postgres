// tslint:disable:max-classes-per-file
// Disabling tslint's max classes rule here because it would add a lot of unnecessary separation for simple classes.
export class NonUniqueMigrationNameError extends Error {
  constructor(nameDups: string[]) {
    super(`Migrations named ${nameDups.join(', ')} are non-unique.`)
    Object.setPrototypeOf(this, NonUniqueMigrationNameError.prototype)
  }
}

export class NonUniqueMigrationSequenceError extends Error {
  constructor() {
    super('Migration sequences must have unique names.')
    Object.setPrototypeOf(this, NonUniqueMigrationSequenceError.prototype)
  }
}

export class NonExistentMigrationError extends Error {
  constructor(initSequenceName: string) {
    super(`Migration sequence '${initSequenceName}' does not exist.`)
    Object.setPrototypeOf(this, NonExistentMigrationError.prototype)
  }
}

export class MismatchedMigrationsError extends Error {
  constructor(expectedName: string, actualName: string, index: number) {
    super(`Migration '${expectedName}' at index ${index} does not match ` +
          `corresponding migration in database; found '${actualName}' instead.`)
    Object.setPrototypeOf(this, MismatchedMigrationsError.prototype)
  }
}

export class MismatchedMigrationsHistoryError extends Error {
  constructor() {
    super(
      'Mismatched migrations. Make sure migrations are in the same order that they have ' +
      'been previously run.'
    )
    Object.setPrototypeOf(this, MismatchedMigrationsHistoryError.prototype)
  }
}

export class ExtraMigrationHistoryError extends Error {
  constructor() {
    super(
      'There are more migrations applied to the database than there are present on this ' +
      'system. Make sure you have not deleted any migrations and are running up-to-date code.'
    )
    Object.setPrototypeOf(this, MismatchedMigrationsHistoryError.prototype)
  }
}

export class MissingDownQueryError extends Error {
  constructor() {
    super('This migration has no down query!')
    Object.setPrototypeOf(this, MissingDownQueryError.prototype)
  }
}

export class MissingSchemaError extends Error {
  constructor(schema: string) {
    super(`Schema '${schema}' does not exist. Make sure you have run \`setup()\` before migrating`)
    Object.setPrototypeOf(this, MissingSchemaError.prototype)
  }
}

export class MissingTableError extends Error {
  constructor(table: string) {
    super(`Table '${table}' does not exist. Make sure you have run \`setup()\` before migrating`)
    Object.setPrototypeOf(this, MissingTableError.prototype)
  }
}
