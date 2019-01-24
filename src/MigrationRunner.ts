import * as path from 'path'
import { IDatabase } from 'pg-promise'
import { Migration } from './Migration'

export class MigrationRunner {
  private isSetUp: boolean = false
  constructor(
    protected pgp: IDatabase<{}>,
    protected migrations: Migration[],
    protected schemaName: string = 'public',
    skipSetup = false,
  ) {
    const migrationNames = migrations.map((f) => f.name)
    const nameDups = this.findDups(migrationNames)
    if (nameDups.length > 0) {
      throw Error(`Migrations named ${nameDups.join(', ')} are non-unique.`)
    }
    if (skipSetup) {
      this.isSetUp = true
    }
  }

  public async setup() {
    await this.checkOrCreateSchema()
    await this.checkOrCreateTables()
    await this.installCyanAudit()
    this.isSetUp = true
  }

  public async migrate(
    sequenceName: string = 'default',
    blockNumber: number = 0,
    pgp: IDatabase<{}> = this.pgp,
    initial: boolean = false,
  ) {
    await this.throwIfNotSetup()
    const unapplied = await this.getUnappliedMigrations(initial)
    for (const migration of unapplied) {
      await this.applyMigration(pgp, migration, sequenceName, blockNumber)
    }
  }

  protected async applyMigration(pgp: IDatabase<{}>, migration: Migration, sequenceName: string, blockNumber: number) {
    await migration.up(pgp)
    await this.refreshCyanAudit()
    await this.registerMigration(pgp, migration.name, sequenceName, blockNumber)
  }

  // public async revertTo(migrationName) {} // Down migrations

  protected async checkOrCreateTables() {
    await this.pgp.none(`
      CREATE TABLE IF NOT EXISTS $1:raw._migration(
        id           serial  PRIMARY KEY,
        name         text,
        sequence     text,
        block_number integer
      );
    `, [this.schemaName])

    await this.pgp.none(`
      CREATE TABLE IF NOT EXISTS $1:raw._index_state (
        id                   serial  PRIMARY KEY,
        block_number         integer NOT NULL,
        block_hash           text    NOT NULL,
        is_replay            boolean NOT NULL,
        handler_version_name text    DEFAULT 'v1'
      );
    `, [this.schemaName])

    await this.pgp.none(`
      CREATE TABLE IF NOT EXISTS $1:raw._block_number_txid (
        block_number integer PRIMARY KEY,
        txid         bigint  NOT NULL
      );
    `, [this.schemaName])
  }

  protected async checkOrCreateSchema() {
    await this.pgp.none(`
      CREATE SCHEMA IF NOT EXISTS $1:raw;
    `, [this.schemaName])
  }

  protected async installCyanAudit() {
    const cyanaudit = new Migration('', '', path.join(__dirname, 'cyanaudit/cyanaudit--2.2.0.sql'))
    await cyanaudit.up(this.pgp)
    await this.refreshCyanAudit()
  }

  protected async refreshCyanAudit(pgp: IDatabase<{}> = this.pgp) {
    await pgp.many(
      'SELECT cyanaudit.fn_update_audit_fields($1)',
      [this.schemaName],
    )
  }

  protected async registerMigration(
    pgp: IDatabase<{}>,
    migrationName: string,
    sequenceName: string,
    blockNumber: number,
  ) {
    await pgp.none(`
      INSERT INTO $1:raw._migration (name, sequence, block_number) VALUES ($2, $3, $4);
    `, [this.schemaName, migrationName, sequenceName, blockNumber])
  }

  protected async getUnappliedMigrations(initial: boolean = false): Promise<Migration[]> {
    const migrationHistory = await this.getMigrationHistory()
    await this.validateMigrationHistory(migrationHistory, initial)
    return this.migrations.slice(migrationHistory.length)
  }

  private async getMigrationHistory(): Promise<string[]> {
    const migrationRows = await this.pgp.manyOrNone(`
      SELECT name FROM $1:raw._migration;
    `, [this.schemaName])
    return migrationRows.map((row) => row.name)
  }

  private validateMigrationHistory(migrationHistory: string[], initial: boolean = false) {
    // Make sure that the migrations in this.migrations match to the migration history
    for (let i = 0; i < migrationHistory.length; i++) {
      if (i === migrationHistory.length && initial) {
        break
      } else if (i === migrationHistory.length) {
        // tslint:disable-next-line
        throw new Error(
          'There are more migrations applied to the database than there are present on this ' +
          'system. Make sure you have not deleted any migrations and are running up-to-date code.')
      }
      if (migrationHistory[i] !== this.migrations[i].name) {
        // tslint:disable-next-line
        throw new Error(
          'Mismatched migrations. Make sure migrations are in the same order that they have ' +
          'been previously run.')
      }
    }
  }

  private async throwIfNotSetup() {
    if (!this.isSetUp) {
      await this.checkSchema(this.schemaName)
      await this.checkTable('_migration')
      await this.checkTable('_index_state')
      await this.checkTable('_block_number_txid')
      await this.checkSchema('cyanaudit')
      this.isSetUp = true
    }
  }

  private async checkSchema(schema: string) {
    const { exists } = await this.pgp.one(`
      SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = $1);
      `,
      [schema],
    )
    if (!exists) {
      throw Error(`Schema '${schema}' does not exist. Make sure you have run \`setup()\` before migrating`)
    }
  }

  private async checkTable(table: string) {
    const { exists } = await this.pgp.one(`
      SELECT EXISTS (
        SELECT 1
        FROM   information_schema.tables
        WHERE  table_schema = $1
        AND    table_name = $2
      );
      `,
      [this.schemaName, table],
    )
    if (!exists) {
      throw Error(`Table '${table}' does not exist. Make sure you have run \`setup()\` before migrating`)
    }
  }

  private findDups(arr: any[]) {
    return arr.reduce((acc: any, el: any, i: number) => {
      if (arr.indexOf(el) !== i && acc.indexOf(el) < 0) {
        acc.push(el)
      }
      return acc
    }, [])
  }
}
