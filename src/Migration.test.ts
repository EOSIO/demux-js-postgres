import { Migration } from "./Migration"
import { QueryFile } from "pg-promise"

class TestMigration extends Migration {
  get _downQueryFile(): QueryFile | null { return this.downQueryFile }
}

describe("Migration", () => {
  it("instantiates a Migration instance", () => {
    const migration = new TestMigration(
      "test",
      "public",
      "testHelpers/create.sql",
      "testHelpers/drop.sql",
    )
    expect(migration).toBeTruthy()
    expect(migration._downQueryFile).toBeInstanceOf(QueryFile)
  })
})
