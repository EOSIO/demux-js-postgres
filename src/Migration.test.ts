import * as path from 'path'
import { QueryFile } from 'pg-promise'
import { Migration } from './Migration'

class TestMigration extends Migration {
  get _downQueryFile(): QueryFile | null { return this.downQueryFile }
}

const baseDir = path.join(path.resolve('./'), 'src')

describe('Migration', () => {
  it('instantiates a Migration instance', () => {
    const migration = new TestMigration(
      'test',
      'public',
      path.join(baseDir, 'testHelpers/migration1.sql'),
      path.join(baseDir, 'testHelpers/migration2.sql'),
    )
    expect(migration).toBeTruthy()
    expect(migration._downQueryFile).not.toBe(null)
  })
})
