import Docker from "dockerode"
import { Migration } from "./Migration"
import { MigrationRunner } from "./MigrationRunner"
import * as dockerUtils from "./testHelpers/docker"
import massive from "massive"
import {IDatabase} from "pg-promise"

const docker = new Docker()
const postgresImageName = "postgres:10.4"
const dbName = "migrationrunnertest"
const dbUser = "docker"
const dbPass = "docker"

class TestMigrationRunner extends MigrationRunner {
  public async _checkOrCreateSchema() { await this.checkOrCreateSchema() }
  public async _checkOrCreateTables() { await this.checkOrCreateTables() }
  public async _registerMigration(pgp: IDatabase<{}>, migrationName: string) {
    await this.registerMigration(pgp, migrationName)
  }
  public async _applyMigration(pgp: IDatabase<{}>, migration: Migration) { await this.applyMigration(pgp, migration) }
  public async _getUnappliedMigrations() { return await this.getUnappliedMigrations() }
}

jest.setTimeout(30000)

function randomSchemaName() { return "s" + Math.random().toString(36).substring(7) }

/*
 Since we need to use this functionality in the next test suites beforeAll/beforeEach,
 we test them separately here.
 */
describe("Database setup", () => {
  let massiveInstance: any
  const containerName = "database-setup-test"

  beforeAll(async (done) => {
    await dockerUtils.pullImage(docker, postgresImageName)
    await dockerUtils.removePostgresContainer(docker, containerName)
    await dockerUtils.startPostgresContainer(
      docker,
      postgresImageName,
      containerName,
      dbName,
      dbUser,
      dbPass,
      5433,
    )
    massiveInstance = await massive({
      database: dbName,
      user: dbUser,
      password: dbPass,
      port: 5433,
    })
    done()
  })

  afterAll(async (done) => {
    await dockerUtils.removePostgresContainer(docker, containerName)
    done()
  })

  it("creates the schema", async () => {
    expect(massiveInstance.newSchema).toBeFalsy()
    const runner = new TestMigrationRunner(
      massiveInstance.instance,
      [],
      "newschema",
    )
    await runner._checkOrCreateSchema()
    await runner._checkOrCreateTables() // Schema needs something inside to be seen by Massive
    await massiveInstance.reload()
    expect(massiveInstance.newschema).toBeTruthy()
  })

  it("creates tables and installs cyanaudit", async () => {
    const runner = new TestMigrationRunner(
      massiveInstance.instance,
      [],
    )
    await runner.setup()
    await massiveInstance.reload()
    expect(massiveInstance._migration).toBeTruthy()
    expect(massiveInstance._index_state).toBeTruthy()
    expect(massiveInstance._block_number_txid).toBeTruthy()
    expect(massiveInstance.cyanaudit).toBeTruthy()
  })

  it("throws when trying to migrate and not set up", async () => {
    const runner = new TestMigrationRunner(
      massiveInstance.instance,
      [],
      "doesntexist",
    )
    const schemaError = Error(
      `Schema 'doesntexist' does not exist. Make sure you have run \`setup()\` before migrating`,
    )
    await expect(runner.migrate()).rejects.toEqual(schemaError)

    await runner._checkOrCreateSchema()
    const tableError = Error(
      `Table '_migration' does not exist. Make sure you have run \`setup()\` before migrating`,
    )
    await expect(runner.migrate()).rejects.toEqual(tableError)
  })
})

describe("MigrationRunner", () => {
  const containerName = "runner-test"
  let massiveInstance: any
  let db: any
  let pgp: IDatabase<{}>
  let schemaName = ""
  let runner: TestMigrationRunner
  let migrations: Migration[]

  beforeAll(async (done) => {
    await dockerUtils.pullImage(docker, postgresImageName)
    await dockerUtils.removePostgresContainer(docker, containerName)
    await dockerUtils.startPostgresContainer(
      docker,
      postgresImageName,
      containerName,
      dbName,
      dbUser,
      dbPass,
      5434,
    )
    massiveInstance = await massive({
      database: dbName,
      user: dbUser,
      password: dbPass,
      port: 5434,
    })
    done()
  })

  beforeEach(async (done) => {
    schemaName = randomSchemaName()
    migrations = [
      new Migration("createTodoTable", schemaName, "testHelpers/migration1.sql"),
      new Migration("createTaskTable", schemaName, "testHelpers/migration2.sql"),
      new Migration("createAssigneeTable", schemaName, "testHelpers/migration3.sql"),
    ]
    runner = new TestMigrationRunner(
      massiveInstance.instance,
      migrations,
      schemaName,
    )
    await runner.setup()
    await massiveInstance.reload()
    db = massiveInstance[schemaName]
    pgp = massiveInstance.instance
    done()
  })

  afterEach(async () => {
    await massiveInstance.instance.none(
      "DROP SCHEMA $1:raw CASCADE;",
      [schemaName],
    )
  })

  afterAll(async (done) => {
    await dockerUtils.removePostgresContainer(docker, containerName)
    done()
  })

  it("writes row to migration table", async () => {
    await runner._registerMigration(pgp, "mymigration")
    const row = await db._migration.findOne({ name: "mymigration" })
    expect(row).toHaveProperty("name")
    expect(row.name).toEqual("mymigration")
  })

  it("gets unapplied migrations", async () => {
    const unappliedBefore = await runner._getUnappliedMigrations()
    expect(unappliedBefore).toEqual(migrations)

    await runner._applyMigration(pgp, migrations[0])
    const unappliedMiddle = await runner._getUnappliedMigrations()
    expect(unappliedMiddle).toEqual([migrations[1], migrations[2]])

    await runner._applyMigration(pgp, migrations[1])
    await runner._applyMigration(pgp, migrations[2])
    const unappliedAfter = await runner._getUnappliedMigrations()
    expect(unappliedAfter).toEqual([])
  })

  it("migrates all migrations", async () => {
    await runner.migrate()
    await massiveInstance.reload()
    expect(massiveInstance[schemaName].todo).toBeTruthy()
    expect(massiveInstance[schemaName].task).toBeTruthy()
    expect(massiveInstance[schemaName].assignee).toBeTruthy()
  })

  it("migrates all outstanding migrations", async () => {
    await runner._applyMigration(pgp, migrations[0])
    await massiveInstance.reload()
    expect(massiveInstance[schemaName].todo).toBeTruthy()
    expect(massiveInstance[schemaName].task).toBeFalsy()
    expect(massiveInstance[schemaName].assignee).toBeFalsy()

    await runner.migrate()
    await massiveInstance.reload()
    expect(massiveInstance[schemaName].todo).toBeTruthy()
    expect(massiveInstance[schemaName].task).toBeTruthy()
    expect(massiveInstance[schemaName].assignee).toBeTruthy()
  })

  it("throws error from mismatched migration", async () => {
    await runner._applyMigration(
      pgp,
      new Migration(
        "mymigration",
        schemaName,
        "testHelpers/migration1.sql",
      ),
    )
    const error = new Error(
      "Mismatched migrations. Make sure migrations are in the same order that they have " +
      "been previously run.",
    )
    await expect(runner.migrate(pgp)).rejects.toEqual(error)
  })
})
