import Docker from "dockerode"
import massive from "massive"
import { TestMassiveActionHandler } from "./testHelpers/TestMassiveActionHandler"
import blockchains from "./testHelpers/blockchains"
import * as dockerUtils from "./testHelpers/docker"
import { JsonActionReader } from "./testHelpers/JsonActionReader"
import * as migrate from "./testHelpers/migrate"
import updaters from "./testHelpers/updaters"

const docker = new Docker()
const postgresImageName = "postgres:10.4"
const postgresContainerName = "massive-action-handler-test"
const dbName = "demuxmassivetest"
const dbUser = "docker"
const dbPass = "docker"

jest.setTimeout(30000)

describe("TestMassiveActionHandler", () => {
  let actionReader: JsonActionReader
  let actionHandler: TestMassiveActionHandler
  let massiveInstance: any
  let db: any
  let schema = ""

  beforeAll(async (done) => {
    await dockerUtils.pullImage(docker, postgresImageName)
    await dockerUtils.removePostgresContainer(docker, postgresContainerName)
    await dockerUtils.startPostgresContainer(docker, postgresImageName, postgresContainerName, dbName, dbUser, dbPass)
    massiveInstance = await massive({
      database: dbName,
      user: dbUser,
      password: dbPass,
    })
    await migrate.cyanaudit(massiveInstance.instance)
    await massiveInstance.reload()
    done()
  })

  afterAll(async (done) => {
    await dockerUtils.removePostgresContainer(docker, postgresContainerName)
    done()
  })

  beforeEach(async () => {
    schema = Math.random().toString(36).substring(7)
    await migrate.up(massiveInstance.instance, schema)
    await massiveInstance.reload()
    await massiveInstance.cyanaudit.fn_update_audit_fields(schema)
    db = massiveInstance[schema]
    actionReader = new JsonActionReader(blockchains.blockchain)
    actionHandler = new TestMassiveActionHandler(updaters, [], massiveInstance, schema)
  })

  afterEach(async () => {
    await migrate.dropSchema(massiveInstance.instance, schema)
  })

  it("populates database correctly", async () => {
    const [block1, isRollback] = await actionReader.nextBlock()
    await actionHandler.handleBlock(block1, isRollback, actionReader.isFirstBlock)

    const groceries = await db.todo.findOne({ id: 1 })
    expect(groceries).toEqual({
      id: 1,
      name: "Groceries",
    })
    const placesToVisit = await db.todo.findOne({ id: 2 })
    expect(placesToVisit).toEqual({
      id: 2,
      name: "Places to Visit",
    })

    const [block2, isNotRollback] = await actionReader.nextBlock()
    await actionHandler.handleBlock(block2, isNotRollback, actionReader.isFirstBlock)

    const cookies = await db.task.findOne({ name: "cookies" })
    expect(cookies).toEqual({
      id: 5,
      name: "cookies",
      completed: false,
      todo_id: 1,
    })

    const sanFrancisco = await db.task.findOne({ name: "San Francisco" })
    expect(sanFrancisco).toEqual({
      id: 9,
      name: "San Francisco",
      completed: false,
      todo_id: 2,
    })

    const [block3, alsoNotRollback] = await actionReader.nextBlock()
    await actionHandler.handleBlock(block3, alsoNotRollback, actionReader.isFirstBlock)

    const milk = await db.task.findOne({ name: "milk" })
    const dippedCookies = await db.task.findOne({ name: "cookies" })
    expect(milk).toEqual({
      id: 4,
      name: "milk",
      completed: true,
      todo_id: 1,
    })
    expect(dippedCookies).toEqual({
      id: 5,
      name: "cookies",
      completed: true,
      todo_id: 1,
    })

    const hongKong = await db.task.findOne({ completed: true, todo_id: 2 })
    expect(hongKong).toEqual({
      id: 6,
      name: "Hong Kong",
      completed: true,
      todo_id: 2,
    })
  })

  it("returns a needToSeek block number if state already exists", async () => {
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

  it("rolls back when blockchain forks", async () => {
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
    const forkedTask = db.task.findOne({ name: "Forked blockchain" })
    expect(forkedTask).toBeTruthy()

    const [forkBlock3, forkIsRollback3] = await actionReader.nextBlock()
    await actionHandler.handleBlock(forkBlock3, forkIsRollback3, actionReader.isFirstBlock)
    const hongKong = await db.task.findOne({ name: "Hong Kong" })
    expect(hongKong.completed).toBe(false)

    const [forkBlock4, forkIsRollback4] = await actionReader.nextBlock()
    await actionHandler.handleBlock(forkBlock4, forkIsRollback4, actionReader.isFirstBlock)
    const forkedTaskComplete = await db.task.findOne({ name: "Forked blockchain" })
    expect(forkedTaskComplete.completed).toBe(true)
  })
})
