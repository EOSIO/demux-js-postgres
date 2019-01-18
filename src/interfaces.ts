import { Migration } from './Migration'

export interface MigrationSequence {
  migrations: Migration[]
  sequenceName: string
}
