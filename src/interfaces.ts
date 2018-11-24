import { Migration } from "./Migration"

export interface MigrationSequence {
  migrations: Migration[]
  sequenceName: string
  ranAtBlockNumber: number | null
}
