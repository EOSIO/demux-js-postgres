import * as path from "path"
import { IDatabase, QueryFile } from "pg-promise"

function loadQueryFile(file: string, schema: string) {
  const fullPath = path.join(__dirname, file)
  const options = {
    minify: true,
    params: { schema },
  }
  const qf = new QueryFile(fullPath, options)
  if (qf.error) {
    console.error(qf.error)
  }
  return qf
}

export async function up(pgp: IDatabase<{}>, schema: string) {
  const create = loadQueryFile("create.sql", schema)
  await pgp.none(create)
}

export async function cyanaudit(pgp: IDatabase<{}>) {
  const cyanSql = await loadQueryFile("cyanaudit--2.2.0.sql", "")
  await pgp.none(cyanSql)
}

export async function dropSchema(pgp: IDatabase<{}>, schema: string) {
  const drop = loadQueryFile("drop.sql", schema)
  await pgp.none(drop)
}
