import * as path from "path"
import { IDatabase, QueryFile } from "pg-promise"

export class Migration {
  protected upQueryFile: QueryFile
  protected downQueryFile: QueryFile | null = null
  constructor(
    public name: string,
    protected schema: string,
    protected upSqlPath: string,
    protected downSqlPath: string | null = null,
  ) {
    this.upQueryFile = this.loadQueryFile(upSqlPath)
    if (downSqlPath) {
      this.downQueryFile = this.loadQueryFile(downSqlPath)
    }
  }

  public async up(pgp: IDatabase<{}>) {
    await pgp.none(this.upQueryFile)
  }

  public async down(pgp: IDatabase<{}>) {
    if (!this.downQueryFile) {
      throw Error("This migration has no down query!")
    }
    await pgp.none(this.downQueryFile)
  }

  private loadQueryFile(filepath: string) {
    const options = {
      minify: true,
      noWarnings: true,
      params: {
        schema: this.schema,
      },
    }
    const qf = new QueryFile(filepath, options)
    if (qf.error) {
      throw qf.error
    }
    return qf
  }
}
