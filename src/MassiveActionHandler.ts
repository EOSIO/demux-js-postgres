import { Block, Effect, handlers, IndexState, Updater } from "demux-js"

export const { AbstractActionHandler } = handlers

/**
 * Connects to a Postgres database using [MassiveJS](https://github.com/dmfay/massive-js). This expects that
 * the database is already migrated, including an `_index_state` table. Refer to the tests for more information.
 */
export class MassiveActionHandler extends AbstractActionHandler {
  constructor(
    protected updaters: Updater[],
    protected effects: Effect[],
    protected massiveInstance: any,
  ) {
    super(updaters, effects)
  }

  protected async handleWithState(handle: (state: any, context?: any) => void): Promise<void> {
    await new Promise((resolve, reject) => {
      this.massiveInstance.withTransaction(async (tx: any) => {
        try {
          await handle(tx)
          resolve(tx)
        } catch (err) {
          reject()
        }
      }, {
        mode: new this.massiveInstance.pgp.txMode.TransactionMode({
          tiLevel: this.massiveInstance.pgp.txMode.isolationLevel.serializable,
        }),
      })
    })
  }

  protected async updateIndexState(state: any, block: Block, isReplay: boolean) {
    const { actions, ...blockInfo } = block
    state._index_state.save({
      id: 0,
      block_number: blockInfo.blockNumber,
      block_hash: blockInfo.blockHash,
      is_replay: isReplay,
    })
  }

  protected async loadIndexState(): Promise<IndexState> {
    const indexState = await this.massiveInstance._index_state.findOne({ id: 0 })
    if (indexState) {
      return indexState
    } else {
      return { blockNumber: 0, blockHash: "" }
    }
  }

  protected async rollbackTo(blockNumber: number) {
    throw Error(`Cannot roll back to ${blockNumber}; \`rollbackTo\` not implemented.`)
  }
}
