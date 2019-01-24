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
    await actionHandler.setupDatabase()
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
    const [block1, isRollback] = await actionReader.nextBlock()
    await actionHandler.handleBlock(block1, isRollback, actionReader.isFirstBlock)

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

    const [block2, isNotRollback] = await actionReader.nextBlock()
    await actionHandler.handleBlock(block2, isNotRollback, actionReader.isFirstBlock)

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

    const [block3, alsoNotRollback] = await actionReader.nextBlock()
    await actionHandler.handleBlock(block3, alsoNotRollback, actionReader.isFirstBlock)

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
    const [block1, isRollback1] = await actionReader.nextBlock()
    await actionHandler.handleBlock(block1, isRollback1, actionReader.isFirstBlock)
    expect(actionReader.isFirstBlock).toBe(true)

    const [block2, isRollback2] = await actionReader.nextBlock()
    await actionHandler.handleBlock(block2, isRollback2, actionReader.isFirstBlock)
    expect(actionReader.isFirstBlock).toBe(false)

    actionHandler.reset()
    const [needToSeek, seekTo] = await actionHandler.handleBlock(block1, isRollback1, true)
    expect(needToSeek).toBe(true)
    expect(seekTo).toBe(3)
  })

  it('rolls back when blockchain forks', async () => {
    const [block1, isRollback1] = await actionReader.nextBlock()
    await actionHandler.handleBlock(block1, isRollback1, actionReader.isFirstBlock)
    const [block2, isRollback2] = await actionReader.nextBlock()
    await actionHandler.handleBlock(block2, isRollback2, actionReader.isFirstBlock)
    const [block3, isRollback3] = await actionReader.nextBlock()
    await actionHandler.handleBlock(block3, isRollback3, actionReader.isFirstBlock)

    actionReader.blockchain = blockchains.forked
    const [forkBlock2, forkIsRollback2] = await actionReader.nextBlock()
    expect(forkBlock2.blockInfo.blockNumber).toBe(2)
    expect(forkIsRollback2).toBe(true)

    await actionHandler.handleBlock(forkBlock2, forkIsRollback2, actionReader.isFirstBlock)
    const forkedTask = db.task.findOne({ name: 'Forked blockchain' })
    expect(forkedTask).toBeTruthy()

    const [forkBlock3, forkIsRollback3] = await actionReader.nextBlock()
    await actionHandler.handleBlock(forkBlock3, forkIsRollback3, actionReader.isFirstBlock)
    const hongKong = await db.task.findOne({ name: 'Hong Kong' })
    expect(hongKong.completed).toBe(false)

    const [forkBlock4, forkIsRollback4] = await actionReader.nextBlock()
    await actionHandler.handleBlock(forkBlock4, forkIsRollback4, actionReader.isFirstBlock)
    const forkedTaskComplete = await db.task.findOne({ name: 'Forked blockchain' })
    expect(forkedTaskComplete.completed).toBe(true)
  })
})
