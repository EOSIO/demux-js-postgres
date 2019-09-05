# demux-js-postgres [![Build Status](https://travis-ci.org/EOSIO/demux-js-postgres.svg?branch=develop)](https://travis-ci.org/EOSIO/demux-js-postgres)

## Installation

```bash
# Using yarn
yarn add demux-postgres
yarn add massive

# Using npm
npm install demux-postgres --save
npm install massive --save
```

## Usage

### MassiveActionHandler

The `MassiveActionHandler` uses [massive-js](https://gitlab.com/dmfay/massive-js) to interact with a Postgres database for storing internal demux state and state calculated by Updaters. Rollback of state due to forks is supported by committing all database writes to per-block databases transactions, and utilizing [Cyan Audit](https://bitbucket.org/neadwerx/cyanaudit/overview) to reverse those transactions in reverse order when needed.

#### Setup

In order to instantiate a `MassiveActionHandler`, four arguments are needed:

- `handlerVersions`: This is an array of `HandlerVersion`s. For more information, [see the `demux-js` documentation](https://eosio.github.io/demux-js/classes/abstractactionhandler.html#applyupdaters). 

- `massiveInstance`: A connected massive database connection object. demux-js-postgress requires that you have a Postgres server running version 9.6 or greater. **It is highly recommended that you use the `massive` object exported from this library. See below for more information.** For more information on how to configure and instantiate this object, see the [massivejs documentation](https://massivejs.org/docs/connecting).

- `dbSchema`: The name of the schema we will operate in.

- `migrationSequences`: *(See next section below)*

#### Note About Using Massive.js

[Massive.js](https://gitlab.com/dmfay/massive-js) depends on [`pg-promise`](https://github.com/vitaly-t/pg-promise), and this package is very sensitive to any version changes of this dependency (even patch releases!). To help make it easier to align versions, it is recommended that you **do not** depend on Massive.js directly, and instead use the `massive` object exported from this package:

```typescript
import { massive } from 'demux-postgres'

// or

const { massive } = require('demux-postgres')
```

You can then use this object as if you had imported from Massive.js itself.

If you are getting a `TypeError: Invalid query format.` error, you may have misaligned `pg-promise` versions!


#### Migrations

The `MassiveActionHandler` will manage all of the Postgres migrations relevant to demux operations. In addition to setting up all internal requirements (idempotently creating the specified `dbSchema` and required internal tables, installing/activating Cyan Audit), you may create additional migrations that run either at initial setup, or are triggered by an action at some point in the future. This is done by writing your migrations as SQL files, loading them via the `Migration` constructor, and collecting them into an array of `MigrationSequence`s:

*create_todo_table.sql*
```sql
CREATE TABLE ${schema~}.todo (
  id int PRIMARY KEY,
  name text NOT NULL
);
```

*migrationSequences.js*
```javascript
import { Migration } from "demux-postgres"

const createTodoTable = new Migration(
  "createTodoTable", // name
  "myschema", // schema
  "create_todo_table.sql", // SQL file
)

// MigrationSequence[]
// See: https://github.com/EOSIO/demux-js-postgres/blob/develop/src/interfaces.ts
module.exports = [{
  migrations: [createTodoTable],
  sequenceName: "init"
}]
```

You can then use this object for the `migrationSequences` argument of the `MassiveActionHandler` constructor.

Once you have instantiated the `MassiveActionHandler`, you can set up your database via the `setupDatabase()` method. If you have a `MigrationSequence` with the name `"init"`, then this migration sequence will run after all other internal database setup is finished.

It can be useful to trigger migrations from actions (for example, when a contract updates), much in the same way it is useful to [update HandlerVersions](https://eosio.github.io/demux-js/classes/abstractactionhandler.html#applyupdaters). You may do this from an Updater's `apply` function via `db.migrate(<MigrationSequence.sequenceName>)`:

```javascript
async function migrateDatabase(db, payload) {
  await db.migrate(payload.sequenceName) // Blockchain will determine when and what migrations will run
}
```

This is also important for maintaining determinism of data (e.g. during replays) if schema changes are needed.

### Example

```javascript
const { BaseActionWatcher } = require("demux")
const { MassiveActionHandler } = require("demux-postgres")
const { NodeosActionReader } = require("demux-eos") // Or any other compatible Action Reader

const massive = require("massive")

// See https://eosio.github.io/demux-js/ for info on Handler Versions, Updaters, and Effects
const handlerVersions = require("./handlerVersions") // Import your handler versions

// See "Migrations" section above
const migrationSequences = require("./migrationSequences")

// See https://massivejs.org/docs/connecting for info on massive configuration
const dbConfig = { ... }

massive(dbConfig).then((db) => {
  const actionReader = new NodeosActionReader("http://my-node-endpoint", 0)
  const actionHandler = new MassiveActionHandler(
    handlerVersions,
    db,
    dbConfig.schema,
    migrationSequences
  )
  const actionWatcher = new BaseActionWatcher(actionReader, actionHander, 500)
  actionWatcher.watch()
})
```

## Contributing

[Contributing Guide](./CONTRIBUTING.md)

[Code of Conduct](./CONTRIBUTING.md#conduct)

## License

[MIT](./LICENSE)

## Important

See LICENSE for copyright and license terms.  Block.one makes its contribution on a voluntary basis as a member of the EOSIO community and is not responsible for ensuring the overall performance of the software or any related applications.  We make no representation, warranty, guarantee or undertaking in respect of the software or any related documentation, whether expressed or implied, including but not limited to the warranties or merchantability, fitness for a particular purpose and noninfringement. In no event shall we be liable for any claim, damages or other liability, whether in an action of contract, tort or otherwise, arising from, out of or in connection with the software or documentation or the use or other dealings in the software or documentation.  Any test results or performance figures are indicative and will not reflect performance under all conditions.  Any reference to any third party or third-party product, service or other resource is not an endorsement or recommendation by Block.one.  We are not responsible, and disclaim any and all responsibility and liability, for your use of or reliance on any of these resources. Third-party resources may be updated, changed or terminated at any time, so the information here may be out of date or inaccurate.
