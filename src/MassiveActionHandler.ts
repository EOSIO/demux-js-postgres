import { AbstractActionHandler, Block, HandlerVersion, IndexState } from "demux"
import { IDatabase } from "pg-promise"
import { MigrationSequence } from "./interfaces"
import { Migration } from "./Migration"
import { MigrationRunner } from "./MigrationRunner"

/**
 * Connects to a Postgres database using [MassiveJS](https://github.com/dmfay/massive-js). This expects that
 * the database has cyanaudit installed, and has `_index_state` and `_block_number_txid` tables. Use a
 * MigrationRunner instance's `setup` method to bootstrap this process.
 */
export class MassiveActionHandler extends AbstractActionHandler {
  protected allMigrations: Migration[] = []
  protected migrationSequenceByName: { [key: string]: MigrationSequence } = {}

  constructor(
    protected handlerVersions: HandlerVersion[],
    protected massiveInstance: any,
    protected dbSchema: string = "public",
    protected migrationSequences: MigrationSequence[] = [],
  ) {
    super(handlerVersions)
    for (const migrationSequence of migrationSequences) {
      if (this.migrationSequenceByName.hasOwnProperty(migrationSequence.sequenceName)) {
        throw new Error("Migration sequences must have unique names.")
      }
      this.migrationSequenceByName[migrationSequence.sequenceName] = migrationSequence
      for (const migration of migrationSequence.migrations) {
        this.allMigrations.push(migration)
      }
    }
  }

  public async setupDatabase(initSequenceName: string = "init") {
    const migrationRunner = new MigrationRunner(this.massiveInstance.instance, [], this.dbSchema)
    await migrationRunner.setup()
    await this.massiveInstance.reload()
    if (this.migrationSequenceByName[initSequenceName]) {
      await this.migrate(initSequenceName, this.massiveInstance.instance, true)
    } else if (initSequenceName === "init") {
      console.warn("No 'init' Migration sequence was provided, nor was a different initSequenceName. " +
                   "No initial migrations have been run.")
    } else {
      throw new Error(`Migration sequence '${initSequenceName}' does not exist.`)
    }
  }

  /**
   * Migrates the database by the given sequenceName. There must be a `MigrationSequence` with this name, or this will
   * throw an error.
   *
   * @param sequenceName  The name of the MigrationSequence to be run.
   */
  public async migrate(
    sequenceName: string,
    pgp: IDatabase<{}> = this.massiveInstance.instance,
    initial: boolean = false,
  ) {
    const migrationSequence = this.migrationSequenceByName[sequenceName]
    if (!migrationSequence) {
      throw new Error(`Migration sequence '${sequenceName}' does not exist.`)
    }
    let ranMigrations: Migration[] = []
    if (!initial) {
      ranMigrations = await this.loadRanMigrations()
    }
    const extendedMigrations = ranMigrations.concat(migrationSequence.migrations)
    const migrationRunner = new MigrationRunner(this.massiveInstance.instance, extendedMigrations, this.dbSchema, true)
    await migrationRunner.migrate(
      migrationSequence.sequenceName,
      this.lastProcessedBlockNumber + 1,
      pgp,
      initial,
    )
    await this.massiveInstance.reload()
  }

  protected get schemaInstance(): any {
    if (this.dbSchema === "public") {
      return this.massiveInstance
    } else {
      return this.massiveInstance[this.dbSchema]
    }
  }

  protected async handleWithState(handle: (state: any, context?: any) => void): Promise<void> {
    await this.massiveInstance.withTransaction(async (tx: any) => {
      let db
      if (this.dbSchema === "public") {
        db = tx
      } else {
        db = tx[this.dbSchema]
      }
      this.warnOverwrite(db, "migrate")
      db.migrate = async (sequenceName: string) => await this.migrate(sequenceName, tx.instance)
      this.warnOverwrite(db, "txid")
      db.txid = (await tx.instance.one("select txid_current()")).txid_current
      try {
        await handle(db)
      } catch (err) {
        throw err // Throw error to trigger ROLLBACK
      }
    }, {
      mode: new this.massiveInstance.pgp.txMode.TransactionMode({
        tiLevel: this.massiveInstance.pgp.txMode.isolationLevel.serializable,
      }),
    })
  }

  protected async updateIndexState(
    state: any,
    block: Block,
    isReplay: boolean,
    handlerVersionName: string,
  ) {
    const { blockInfo } = block
    const fromDb = (await state._index_state.findOne({ id: 1 })) || {}
    const toSave = {
      ...fromDb,
      block_number: blockInfo.blockNumber,
      block_hash: blockInfo.blockHash,
      is_replay: isReplay,
      handler_version_name: handlerVersionName,
    }
    await state._index_state.save(toSave)

    await state._block_number_txid.insert({
      block_number: blockInfo.blockNumber,
      txid: state.txid,
    })
  }

  protected async loadIndexState(): Promise<IndexState> {
    const defaultIndexState = {
      block_number: 0,
      block_hash: "",
      handler_version_name: "v1",
      is_replay: false,
    }
    const indexState = await this.schemaInstance._index_state.findOne({ id: 1 }) || defaultIndexState
    return {
      blockNumber: indexState.block_number,
      blockHash: indexState.block_hash,
      handlerVersionName: indexState.handler_version_name,
      isReplay: indexState.is_replay,
    }
  }

  protected async loadRanMigrations(): Promise<Migration[]> {
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
      if (this.allMigrations[index].name !== processedMigration.name) {
        throw new Error(`Migration '${this.allMigrations[index].name}' at index ${index} does not match ` +
                        `corresponding migration in database; found '${processedMigration.name}' instead.`)
      }
      ranMigrations.push(this.allMigrations[index])
    }
    return ranMigrations
  }

  protected async rollbackTo(blockNumber: number) {
    const blockNumberTxIds = await this.schemaInstance._block_number_txid.where(
      "block_number > $1",
      [blockNumber],
      {
        order: [{
          field: "block_number",
          direction: "desc",
        }],
      },
    )
    for (const { block_number: rollbackNumber, txid } of blockNumberTxIds) {
      console.info(`ROLLING BACK BLOCK ${rollbackNumber}`)
      await this.massiveInstance.cyanaudit.fn_undo_transaction(txid)
    }
    console.info(`Rollback complete!`)
  }

  private warnOverwrite(db: any, toOverwrite: string): void {
    if (db.hasOwnProperty(toOverwrite)) {
      console.warn(`Assignment of '${toOverwrite}' on Massive object instance is overwriting property of the same ` +
                            "name. Please use a different table or schema name.")
    }
  }
}
