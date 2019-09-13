declare function require(name:string):any;
const massive = require('massive');
export { massive }
export { MassiveActionHandler } from './MassiveActionHandler'
export { Migration } from './Migration'
export { MigrationRunner } from './MigrationRunner'
export { MigrationSequence, MassiveActionHandlerOptions } from './interfaces'
