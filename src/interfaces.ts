import { ActionHandlerOptions } from 'demux'
import { Migration } from './Migration'

export interface MigrationSequence {
  migrations: Migration[]
  sequenceName: string
}

export interface MassiveActionHandlerOptions extends ActionHandlerOptions {
  dbSchema?: string
}
