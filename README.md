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

The MassiveActionHandler uses [massive-js](https://github.com/dmfay/massive-js) to interact with a Postgres database for storing internal demux state as well as the state calculated by updaters.

```javascript
const { BaseActionWatcher } = require("demux")
const { MassiveActionHandler } = require("demux-postgres")
const { NodeosActionReader } = require("demux-eos") // Or any other compatible Action Reader

const massive = require("massive")

// See https://eosio.github.io/demux-js/ for info on Handler Versions, Updaters, and Effects
const handlerVersions = require("./handlerVersions") // Import your handler versions

// See https://dmfay.github.io/massive-js/connecting.html for info on massive configuration
const dbConfig = { ... }

massive(dbConfig).then((db) => {
  const actionReader = new NodeosActionReader("http://my-node-endpoint", 0)
  const actionHandler = new MassiveActionHandler(
    handlerVersions,
    db,
    dbConfig.schema
  )
  const actionWatcher = new BaseActionWatcher(actionReader, actionHander, 500)
  actionWatcher.watch()
})
```
