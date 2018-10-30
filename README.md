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

const massive = require("massive")

// See https://eosio.github.io/demux-js/ for info on Updaters and Effects
const effects = require("./effects") // Import the effects you have written
const updaters = require("./updaters") // Import the updaters you have written

const dbConfig = ... // see https://dmfay.github.io/massive-js/connecting.html for info on massive configuration

massive(dbConfig).then(async (db) => {
    const actionReader = ... // see https://github.com/EOSIO/demux-js-eos for a supported ActionReader
    const actionHandler = new MassiveActionHandler(
        updaters,
        effects,
        db,
        dbConfig.schema
    )
    const actionWatcher = new BaseActionWatcher(actionReader, actionHander, 500)

    actionWatcher.watch()
})

```

