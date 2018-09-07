import { IDatabase } from "pg-promise"
import { Migration } from "./Migration"

export class MigrationRunner {
  constructor(
    protected pgp: IDatabase<{}>,
    protected migrations: Migration[],
    protected schemaName: string = "public",
  ) {
    const migrationNames = migrations.map((f) => f.name)
    const nameDups = this.findDups(migrationNames)
    if (nameDups.length > 0) {
      throw Error(`Migrations named ${nameDups.join(", ")} are non-unique.`)
    }
  }

  public async setup() {
    await this.checkOrCreateSchema()
    await this.checkOrCreateTables()
    await this.installCyanAudit()
  }

  public async migrate(pgp: IDatabase<{}> = this.pgp) {
    const unapplied = await this.getUnappliedMigrations()
    for (const migration of unapplied) {
      await this.applyMigration(pgp, migration)
    }
  }

  protected async applyMigration(pgp: IDatabase<{}>, migration: Migration) {
    await migration.up(pgp)
    await this.refreshCyanAudit()
    await this.registerMigration(pgp, migration.name)
  }

  // public async revertTo(migrationName) {} // Down migrations

  protected async checkOrCreateTables() {
    await this.pgp.none(`
      CREATE TABLE IF NOT EXISTS $1:raw._migrations(
        id serial PRIMARY KEY,
        name TEXT
      );
    `, [this.schemaName])

    await this.pgp.none(`
      CREATE TABLE IF NOT EXISTS $1:raw._index_state (
        id serial PRIMARY KEY,
        block_number integer NOT NULL,
        block_hash text NOT NULL,
        is_replay boolean NOT NULL
      );
    `, [this.schemaName])

    await this.pgp.none(`
      CREATE TABLE IF NOT EXISTS $1:raw._block_number_txid (
        block_number integer PRIMARY KEY,
        txid bigint NOT NULL
      );
    `, [this.schemaName])
  }

  protected async checkOrCreateSchema() {
    await this.pgp.none(`
      CREATE SCHEMA IF NOT EXISTS $1:raw;
    `, [this.schemaName])
  }

  protected async installCyanAudit() {
    const cyanaudit = new Migration("", "", "cyanaudit/cyanaudit--2.2.0.sql")
    await cyanaudit.up(this.pgp)
    await this.refreshCyanAudit()
  }

  protected async refreshCyanAudit(pgp: IDatabase<{}> = this.pgp) {
    await pgp.many(
      "SELECT cyanaudit.fn_update_audit_fields($1)",
      [this.schemaName],
    )
  }

  protected async registerMigration(pgp: IDatabase<{}>, migrationName: string) {
    await pgp.none(`
      INSERT INTO $1:raw._migrations (name) VALUES ($2);
    `, [this.schemaName, migrationName])
  }

  protected async getUnappliedMigrations(): Promise<Migration[]> {
    const migrationHistory = await this.getMigrationHistory()
    await this.validateMigrationHistory(migrationHistory)
    return this.migrations.slice(migrationHistory.length)
  }

  private async getMigrationHistory(): Promise<string[]> {
    const migrationRows = await this.pgp.manyOrNone(`
      SELECT name FROM $1:raw._migrations;
    `, [this.schemaName])
    return migrationRows.map((row) => row.name)
  }

  private validateMigrationHistory(migrationHistory: string[]) {
    // Make sure that the migrations in this.migrations match to the migration history
    for (let i = 0; i < migrationHistory.length; i++) {
      if (i === migrationHistory.length) {
        // tslint:disable-next-line
        throw new Error(
          "There are more migrations applied to the database than there are present on this " +
          "system. Make sure you have not deleted any migrations and are running up-to-date code.")
      }
      if (migrationHistory[i] !== this.migrations[i].name) {
        // tslint:disable-next-line
        throw new Error(
          "Mismatched migrations. Make sure migrations are in the same order that they have " +
          "been previously run.")
      }
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
