import { AbstractActionHandler, Block, Effect, IndexState, Updater } from "demux"

/**
 * Connects to a Postgres database using [MassiveJS](https://github.com/dmfay/massive-js). This expects that
 * the database is already migrated, including an `_index_state` table. Refer to the tests for more information.
 */
export class MassiveActionHandler extends AbstractActionHandler {
  protected schemaInstance: any

  constructor(
    protected updaters: Updater[],
    protected effects: Effect[],
    protected massiveInstance: any,
    protected dbSchema: string = "public",
  ) {
    super(updaters, effects)
    if (this.dbSchema === "public") {
      this.schemaInstance = this.massiveInstance
    } else {
      this.schemaInstance = this.massiveInstance[this.dbSchema]
    }
  }

  protected async handleWithState(handle: (state: any, context?: any) => void): Promise<void> {
    await this.massiveInstance.withTransaction(async (tx: any) => {
      const txid = (await tx.instance.one("select txid_current()")).txid_current
      const context = { txid }
      let db
      if (this.dbSchema === "public") {
        db = tx
      } else {
        db = tx[this.dbSchema]
      }
      try {
        await handle(db, context)
      } catch (err) {
        throw err // Throw error to trigger ROLLBACK
      }
    }, {
      mode: new this.massiveInstance.pgp.txMode.TransactionMode({
        tiLevel: this.massiveInstance.pgp.txMode.isolationLevel.serializable,
      }),
    })
  }

  protected async updateIndexState(state: any, block: Block, isReplay: boolean, context: any) {
    const { blockInfo } = block
    const fromDb = (await state._index_state.findOne({ id: 1 })) || {}
    const toSave = {
      ...fromDb,
      block_number: blockInfo.blockNumber,
      block_hash: blockInfo.blockHash,
      is_replay: isReplay,
    }
    await state._index_state.save(toSave)

    await state._block_number_txid.insert({
      block_number: blockInfo.blockNumber,
      txid: context.txid,
    })
  }

  protected async loadIndexState(): Promise<IndexState> {
    const indexState = await this.schemaInstance._index_state.findOne({ id: 1 })
    if (indexState) {
      return {
        blockNumber: indexState.block_number,
        blockHash: indexState.block_hash,
      }
    } else {
      return { blockNumber: 0, blockHash: "" }
    }
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
}
