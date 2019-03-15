import Docker from 'dockerode'
import massive from 'massive'
import * as path from 'path'
import { Migration } from './Migration'
import blockchains from './testHelpers/blockchains'
import * as dockerUtils from './testHelpers/docker'
import { JsonActionReader } from './testHelpers/JsonActionReader'
import { TestMassiveActionHandler } from './testHelpers/TestMassiveActionHandler'
import updaters from './testHelpers/updaters'

const docker = new Docker()
const postgresImageName = 'postgres:10.4'
const postgresContainerName = 'massive-action-handler-test'
const dbName = 'demuxmassivetest'
const dbUser = 'docker'
const dbPass = 'docker'

jest.setTimeout(30000)

const baseDir = path.join(path.resolve('./'), 'src')

describe('TestMassiveActionHandler', () => {
  let migrations: Migration[]
  let actionReader: JsonActionReader
  let actionHandler: TestMassiveActionHandler
  let massiveInstance: any
  let db: any
  let schemaName = ''

  beforeAll(async (done) => {
    await dockerUtils.pullImage(docker, postgresImageName)
    await dockerUtils.removePostgresContainer(docker, postgresContainerName)
    await dockerUtils.startPostgresContainer(
      docker,
      postgresImageName,
      postgresContainerName,
      dbName,
      dbUser,
      dbPass,
      6457,
    )
    massiveInstance = await massive({
      database: dbName,
      user: dbUser,
      password: dbPass,
      port: 6457,
    })
    done()
  })

  beforeEach(async () => {
    schemaName = 's' + Math.random().toString(36).substring(7)
    migrations = [
      new Migration('createTodoTable', schemaName, path.join(baseDir, 'testHelpers/migration1.sql')),
      new Migration('createTaskTable', schemaName, path.join(baseDir, 'testHelpers/migration2.sql')),
    ]
    const migrationSequence = {
      migrations,
      sequenceName: 'init',
    }
    actionReader = new JsonActionReader(blockchains.blockchain)
    actionHandler = new TestMassiveActionHandler(
      [{
        versionName: 'v1',
        updaters,
        effects: [],
      }],
      massiveInstance,
      schemaName,
      [migrationSequence],
    )
    await actionHandler.initialize()
    await massiveInstance.reload()
    db = massiveInstance[schemaName]
  })

  afterEach(async () => {
    await massiveInstance.instance.none(
      'DROP SCHEMA $1:raw CASCADE;',
      [schemaName],
    )
  })

  afterAll(async (done) => {
    await dockerUtils.removePostgresContainer(docker, postgresContainerName)
    done()
  })

  it('populates database correctly', async () => {
    const nextBlock = await actionReader.getNextBlock()
    await actionHandler.handleBlock(nextBlock, false)

    const groceries = await db.todo.findOne({ id: 1 })
    expect(groceries).toEqual({
      id: 1,
      name: 'Groceries',
    })
    const placesToVisit = await db.todo.findOne({ id: 2 })
    expect(placesToVisit).toEqual({
      id: 2,
      name: 'Places to Visit',
    })

    const nextBlock2 = await actionReader.getNextBlock()
    await actionHandler.handleBlock(nextBlock2, false)

    const cookies = await db.task.findOne({ name: 'cookies' })
    expect(cookies).toEqual({
      id: 5,
      name: 'cookies',
      completed: false,
      todo_id: 1,
    })

    const sanFrancisco = await db.task.findOne({ name: 'San Francisco' })
    expect(sanFrancisco).toEqual({
      id: 9,
      name: 'San Francisco',
      completed: false,
      todo_id: 2,
    })

    const nextBlock3  = await actionReader.getNextBlock()
    await actionHandler.handleBlock(nextBlock3, false)

    const milk = await db.task.findOne({ name: 'milk' })
    const dippedCookies = await db.task.findOne({ name: 'cookies' })
    expect(milk).toEqual({
      id: 4,
      name: 'milk',
      completed: true,
      todo_id: 1,
    })
    expect(dippedCookies).toEqual({
      id: 5,
      name: 'cookies',
      completed: true,
      todo_id: 1,
    })

    const hongKong = await db.task.findOne({ completed: true, todo_id: 2 })
    expect(hongKong).toEqual({
      id: 6,
      name: 'Hong Kong',
      completed: true,
      todo_id: 2,
    })
  })

  it('returns a needToSeek block number if state already exists', async () => {
    const nextBlock = await actionReader.getNextBlock()
    await actionHandler.handleBlock(nextBlock, false)
    expect(actionReader.currentBlockNumber).toBe(1)

    const nextBlock2 = await actionReader.getNextBlock()
    await actionHandler.handleBlock(nextBlock2, false)
    expect(actionReader.currentBlockNumber).not.toBe(1)

    actionHandler.reset()
    const nextBlockNeeded = await actionHandler.handleBlock(nextBlock, false)
    expect(nextBlockNeeded).toBe(3)
  })

  it('rolls back when blockchain forks', async () => {
    const nextBlock = await actionReader.getNextBlock()
    await actionHandler.handleBlock(nextBlock, false)
    const nextBlock2 = await actionReader.getNextBlock()
    await actionHandler.handleBlock(nextBlock2, false)
    const nextBlock3 = await actionReader.getNextBlock()
    await actionHandler.handleBlock(nextBlock3, false)

    actionReader.blockchain = blockchains.forked
    const forkBlock2 = await actionReader.getNextBlock()
    expect(forkBlock2.block.blockInfo.blockNumber).toBe(2)
    expect(forkBlock2.blockMeta.isRollback).toBe(true)

    await actionHandler.handleBlock(forkBlock2, false)
    const forkedTask = db.task.findOne({ name: 'Forked blockchain' })
    expect(forkedTask).toBeTruthy()

    const forkBlock3 = await actionReader.getNextBlock()
    await actionHandler.handleBlock(forkBlock3, false)
    const hongKong = await db.task.findOne({ name: 'Hong Kong' })
    expect(hongKong.completed).toBe(false)

    const forkBlock4 = await actionReader.getNextBlock()
    await actionHandler.handleBlock(forkBlock4, false)
    const forkedTaskComplete = await db.task.findOne({ name: 'Forked blockchain' })
    expect(forkedTaskComplete.completed).toBe(true)
  })

  it('with Cyan Audit off if behind lastIrreversibleBlock', async () => {
    actionReader.getLastIrreversibleBlockNumber = jest.fn().mockReturnValue(1)
    const nextBlock = await actionReader.getNextBlock()
    expect(nextBlock.lastIrreversibleBlockNumber).toEqual(1)
    await actionHandler.handleBlock(nextBlock, true)
    const nextBlock2 = await actionReader.getNextBlock()
    await actionHandler.handleBlock(nextBlock2, true)
    expect(actionHandler._getCyanAuditStatus()).toEqual(false)
  })

  it('with Cyan Audit on if isReplay is false', async () => {
    actionReader.getLastIrreversibleBlockNumber = jest.fn().mockReturnValue(1)
    const nextBlock = await actionReader.getNextBlock()
    await actionHandler.handleBlock(nextBlock, false)
    const nextBlock2 = await actionReader.getNextBlock()
    await actionHandler.handleBlock(nextBlock2, false)
    const nextBlock3 = await actionReader.getNextBlock()
    await actionHandler.handleBlock(nextBlock3, false)
    expect(actionHandler._getCyanAuditStatus()).toEqual(true)
  })

  it('with Cyan Audit on if new block comes after lastIrreversibleBlock', async () => {
    actionReader.getLastIrreversibleBlockNumber = jest.fn().mockReturnValue(1)
    const nextBlock = await actionReader.getNextBlock()
    expect(nextBlock.lastIrreversibleBlockNumber).toEqual(1)
    await actionHandler.handleBlock(nextBlock, true)
    const nextBlock2 = await actionReader.getNextBlock()
    await actionHandler.handleBlock(nextBlock2, true)
    const nextBlock3 = await actionReader.getNextBlock()
    await actionHandler.handleBlock(nextBlock3, true)
    expect(actionHandler._getCyanAuditStatus()).toEqual(true)
  })

})
