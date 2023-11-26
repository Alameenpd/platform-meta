import path from 'path'
import { texts } from '@textshq/platform-sdk'
import { DatabaseQueryMetadata, SyncChannel } from './types'

export const NEVER_SYNC_TIMESTAMP = 9999999999999

const PLATFORM_DIR_NAME = 'platform-meta'
const isiOS = process.platform as string === 'ios'

const getBinaryPath = (binaryName: string) => (texts.IS_DEV && !isiOS
  ? path.join(__dirname, '../binaries', binaryName)
  : path.join(texts.constants.BUILD_DIR_PATH, PLATFORM_DIR_NAME, binaryName))

export const STICKERS_DIR_PATH = getBinaryPath('stickers')

export const DRIZZLE_DIR_PATH = getBinaryPath('drizzle')

export const DefaultDatabaseQueries: [number, DatabaseQueryMetadata][] = [
  [
    1,
    { databaseId: 1, sendSyncParams: false, lastAppliedCursor: null, syncChannel: SyncChannel.MAILBOX },
  ],
  [
    2,
    { databaseId: 2, sendSyncParams: false, lastAppliedCursor: null, syncChannel: SyncChannel.CONTACT },
  ],
  [
    95,
    { databaseId: 95, sendSyncParams: false, lastAppliedCursor: null, syncChannel: SyncChannel.CONTACT },
  ],
]
