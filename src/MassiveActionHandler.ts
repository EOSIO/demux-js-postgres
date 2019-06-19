import { Database } from 'massive'
import { IDatabase } from 'pg-promise'
import {
  AbstractActionHandler,
  HandlerVersion,
  IndexState,
  NextBlock,
  NotInitializedError
} from 'demux'
import {
  CyanAuditError,
  MismatchedMigrationsError,
  NonExistentMigrationError,
  NonUniqueMigrationSequenceError,
} from './errors'
import { MassiveActionHandlerOptions, MigrationSequence } from './interfaces'
import { Migration } from './Migration'
import { MigrationRunner } from './MigrationRunner'

/**
 * Connects to a Postgres database using [MassiveJS](https://github.com/dmfay/massive-js). Make sure to call
 * `setupDatabase` to create the needed internally-used tables `_migration`, `_index_state`, and `_block_number_txid`.
 * This will also automatically migrate the database with the provided MigrationSequence if named `init`.
 *
 * @param handlerVersions     See `HandlerVersion` parameter from demux-js
 *
 * @param massiveInstance     An instance of of a `massive` object provided by MassiveJS, connected to the database
 *                            you want this instance to interface with
 *
 * @param dbSchema            The name of the schema you would like to use. If it doesn't exist, it will be created when
 *                            `setupDatabase` is called.
 *
 * @param migrationSequences  An array of `MigrationSequence`s available to call via
 *                            `state.migrate(<name of sequence>)`, commonly from `Updater`'s `apply` functions that also
 *                            change the `HandlerVersion`.
 */
export class MassiveActionHandler extends AbstractActionHandler {
  protected allMigrations: Migration[] = []
  protected migrationSequenceByName: { [key: string]: MigrationSequence } = {}
  protected cyanauditEnabled: boolean = false
  protected dbSchema: string

  constructor(
    protected handlerVersions: HandlerVersion[],
    protected massiveInstance: Database,
    protected migrationSequences: MigrationSequence[] = [],
    options: MassiveActionHandlerOptions,
  ) {
    super(handlerVersions, options)
    this.dbSchema = options.dbSchema ? options.dbSchema : 'public'
    for (const migrationSequence of migrationSequences) {
      if (this.migrationSequenceByName.hasOwnProperty(migrationSequence.sequenceName)) {
        throw new NonUniqueMigrationSequenceError()
      }
      this.migrationSequenceByName[migrationSequence.sequenceName] = migrationSequence
      for (const migration of migrationSequence.migrations) {
        this.allMigrations.push(migration)
      }
    }
  }

  /**
   * Migrates the database by the given sequenceName. There must be a `MigrationSequence` with this name, or this will
   * throw an error.
   *
   * @param sequenceName  The name of the MigrationSequence to be run.
   * @param pgp           pg-promise instance
   * @param initial       True if this is the first migration
   */
  public async migrate(
    sequenceName: string,
    pgp: IDatabase<{}> = this.massiveInstance.instance,
    initial: boolean = false,
  ): Promise<void> {
    this.log.info(`Migrating database with Migration Sequence '${sequenceName}'...`)
    const migrateStart = Date.now()
    const migrationSequence = this.migrationSequenceByName[sequenceName]
    if (!migrationSequence) {
      throw new NonExistentMigrationError(sequenceName)
    }
    let ranMigrations: Migration[] = []
    if (!initial) {
      ranMigrations = await this.loadAppliedMigrations()
    }
    const extendedMigrations = ranMigrations.concat(migrationSequence.migrations)
    const migrationRunner = new MigrationRunner(
      this.massiveInstance.instance,
      extendedMigrations,
      this.dbSchema,
      this.log,
      true
    )
    await migrationRunner.migrate(
      migrationSequence.sequenceName,
      this.lastProcessedBlockNumber + 1,
      pgp,
      initial,
    )
    await this.massiveInstance.reload()
    const migrateTime = Date.now() - migrateStart
    this.log.info(`Migrated database with Migration Sequence ${sequenceName} (${migrateTime}ms)`)
  }

  /**
   * Sets up the database by idempotently creating the schema, installing CyanAudit, creates internally used tables, and
   * runs any initial migration sequences provided.
   *
   * @param initSequenceName  The name of the MigrationSequence to be used to migrate the database initially
   */
  protected async setup(initSequenceName: string = 'init'): Promise<void> {
    if (this.initialized) {
      return
    }

    if (!this.migrationSequenceByName[initSequenceName]) {
      if (initSequenceName === 'init') {
        this.log.warn(`No 'init' Migration sequence was provided, nor was a different initSequenceName. ` +
                      'No initial migrations have been run.')
      } else {
        throw new NonExistentMigrationError(initSequenceName)
      }
    }

    try {
      const migrationRunner = new MigrationRunner(this.massiveInstance.instance, [], this.dbSchema, this.log)
      await migrationRunner.setup()
      await this.massiveInstance.reload()
      await this.migrate(initSequenceName, this.massiveInstance.instance, true)
    } catch (err) {
      throw new NotInitializedError('Failed to migrate the postgres database.', err)
    }
  }

  protected get schemaInstance(): any {
    if (this.dbSchema === 'public') {
      return this.massiveInstance
    } else {
      return this.massiveInstance[this.dbSchema]
    }
  }

  protected async handleWithState(handle: (state: any, context?: any) => void): Promise<void> {
    if (this.lastProcessedBlockNumber < this.lastIrreversibleBlockNumber) {
      await this.turnOffCyanAudit()
    } else {
      await this.turnOnCyanAudit()
    }
    await this.handleBlockWithTransactionId(handle)
  }

  protected async updateIndexState(
    state: any,
    nextBlock: NextBlock,
    isReplay: boolean,
    handlerVersionName: string,
  ): Promise<void> {
    const { block: { blockInfo } } = nextBlock
    const fromDb = (await state._index_state.findOne({ id: 1 })) || {}
    const toSave = {
      ...fromDb,
      block_number: blockInfo.blockNumber,
      block_hash: blockInfo.blockHash,
      last_irreversible_block_number: nextBlock.lastIrreversibleBlockNumber,
      is_replay: isReplay,
      handler_version_name: handlerVersionName,
    }
    await state._index_state.save(toSave)

    if (this.cyanauditEnabled) {
      await state._block_number_txid.insert({
        block_number: blockInfo.blockNumber,
        txid: state.txid,
      })
    }
  }

  protected async loadIndexState(): Promise<IndexState> {
    const defaultIndexState = {
      block_number: 0,
      last_irreversible_block_number: 0,
      block_hash: '',
      handler_version_name: 'v1',
      is_replay: false,
    }
    const indexState = await this.schemaInstance._index_state.findOne({ id: 1 }) || defaultIndexState
    return {
      blockNumber: indexState.block_number,
      lastIrreversibleBlockNumber: indexState.last_irreversible_block_number,
      blockHash: indexState.block_hash,
      handlerVersionName: indexState.handler_version_name,
      isReplay: indexState.is_replay,
    }
  }

  protected async loadAppliedMigrations(): Promise<Migration[]> {
    this.log.debug('Loading applied run migrations...')
    const loadStart = Date.now()
    const processedMigrationRows = await this.massiveInstance._migration.find()
    const processedMigrations = processedMigrationRows.map((row: any) => {
      return {
        name: row.name,
        sequenceName: row.sequence,
        blockNumber: row.block_number,
      }
    })
    const ranMigrations = []
    for (const [index, processedMigration] of processedMigrations.entries()) {
      const expectedName = this.allMigrations[index].name
      const actualName = processedMigration.name
      if (expectedName !== actualName) {
        throw new MismatchedMigrationsError(expectedName, actualName, index)
      }
      this.log.debug(`Previously applied migration name and index matches expected: ${index} -- ${expectedName}`)
      ranMigrations.push(this.allMigrations[index])
    }
    const loadTime = Date.now() - loadStart
    this.log.debug(`Loaded ${ranMigrations.length} previously applied migrations (${loadTime}ms)`)
    return ranMigrations
  }

  protected async rollbackTo(blockNumber: number): Promise<void> {
    const blockNumberTxIds = await this.schemaInstance._block_number_txid.where(
      'block_number > $1',
      [blockNumber],
      {
        order: [{
          field: 'block_number',
          direction: 'desc',
        }],
      },
    )
    for (const { block_number: rollbackNumber, txid } of blockNumberTxIds) {
      this.log.debug(`Rolling back block ${rollbackNumber} (undoing database transaction ${txid})...`)
      await this.massiveInstance.cyanaudit.fn_undo_transaction(txid)
    }
  }

  private warnOverwrite(db: any, toOverwrite: string): void {
    if (db.hasOwnProperty(toOverwrite)) {
      this.log.warn(`Assignment of '${toOverwrite}' on Massive object instance is overwriting property of the same ` +
                   'name. Please use a different table or schema name.')
    }
  }

  private async turnOnCyanAudit(): Promise<void> {
    if (!this.cyanauditEnabled) {
      try {
        this.log.debug('Turning on CyanAudit...')
        const turnOnStart = Date.now()
        await this.massiveInstance.query('SET cyanaudit.enabled = 1;')
        this.cyanauditEnabled = true
        const turnOnTime  = Date.now() - turnOnStart
        this.log.info(`Turned on CyanAudit (${turnOnTime}ms)`)
      } catch (err) {
        this.log.error(err)
        throw new CyanAuditError(true)
      }
    }
  }

  private async turnOffCyanAudit(): Promise<void> {
    if (this.cyanauditEnabled) {
      try {
        this.log.debug('Turning off CyanAudit...')
        const turnOffStart = Date.now()
        await this.massiveInstance.query('SET cyanaudit.enabled = 0;')
        this.cyanauditEnabled = false
        this.log.info('Turned off CyanAudit')
        const turnOffTime  = Date.now() - turnOffStart
        this.log.info(`Turned off CyanAudit (${turnOffTime}ms)`)
      } catch (e) {
        this.log.error('Error: ', e)
        throw new CyanAuditError(false)
      }
    }
  }

  private handleBlockWithTransactionId(handle: (state: any, context?: any) => void): Promise<void> {
    return this.massiveInstance.withTransaction(async (tx: any) => {
      let db
      if (this.dbSchema === 'public') {
        db = tx
      } else {
        db = tx[this.dbSchema]
      }
      this.warnOverwrite(db, 'migrate')
      db.migrate = async (sequenceName: string) => await this.migrate(sequenceName, tx.instance)
      this.warnOverwrite(db, 'txid')
      db.txid = (await tx.instance.one('select txid_current()')).txid_current
      try {
        await handle(db)
      } catch (err) {
        this.log.debug('Error thrown in updater, triggering rollback')
        throw err
      }
    }, {
      mode: new this.massiveInstance.pgp.txMode.TransactionMode({
        tiLevel: this.massiveInstance.pgp.txMode.isolationLevel.serializable,
      }),
    })
  }
}
