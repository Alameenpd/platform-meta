import { type PlatformInfo, MessageDeletionMode } from '@textshq/platform-sdk'
import icon from './icon'
import { genClientContext } from './util'

const info: PlatformInfo = {
  name: 'instagram',
  version: '3.0.0',
  displayName: 'Instagram',
  icon,
  loginMode: ['browser-extension', 'browser'],
  browserLogin: {
    url: 'https://instagram.com',
    authCookieName: 'sessionid',
  },
  deletionMode: MessageDeletionMode.UNSUPPORTED,
  attributes: new Set([
  ]),
  reactions: {
    supported: {
      '❤️': { title: '❤️', render: '❤️' },
      '😂': { title: '😂', render: '😂' },
      '😮': { title: '😮', render: '😮' },
      '😢': { title: '😢', render: '😢' },
      '😡': { title: '😡', render: '😡' },
      '👍': { title: '👍', render: '👍' },
    },
    canReactWithAllEmojis: true,
    allowsMultipleReactionsToSingleMessage: false,
  },
  typingDurationMs: 10_000,
  generateUniqueMessageID: () => genClientContext().toString(),
  getUserProfileLink: ({ username }) =>
    `https://www.instagram.com/${username}/`,
}

export default info
