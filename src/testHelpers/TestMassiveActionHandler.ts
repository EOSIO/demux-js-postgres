import { MassiveActionHandler } from '../MassiveActionHandler'

export class TestMassiveActionHandler extends MassiveActionHandler {
  public reset() {
    this.lastProcessedBlockNumber = 0
    this.lastProcessedBlockHash = ''
    this.handlerVersionName = 'v1'
  }
  public async _loadIndexState() {
    return await this.loadIndexState()
  }
}
