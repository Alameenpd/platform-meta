import { relations } from 'drizzle-orm'
import { sqliteTable, integer, text, primaryKey } from 'drizzle-orm/sqlite-core'
import type { InferModel } from 'drizzle-orm'
import type { IGAttachment, IGMessage, IGThread } from '../ig-types'

export type IGThreadInDB = Omit<IGThread, 'raw' | 'threadKey'>

export const threads = sqliteTable('threads', {
  threadKey: text('threadKey').notNull().primaryKey(),
  // thread: blob('thread', { mode: 'json' }).$type<IGThreadInDB>(), //SqliteError: JSON cannot hold BLOB values
  thread: text('thread'),
  raw: text('raw'),
})

export type DBThreadSelect = InferModel<typeof threads, 'select'>
export type DBThreadInsert = InferModel<typeof threads, 'insert'>
export type DBThreadSelectWithMessagesAndAttachments = Pick<DBThreadSelect, 'threadKey' | 'thread'> & {
  attachments: AttachmentInJoin[]
  messages: DBMessageSelectDefault[]
  // participants: Pick<DBParticipantSelect, 'id' | 'name' | 'username' | 'profilePictureUrl'>
}
export type IGMessageInDB = Omit<IGMessage, 'raw' | 'messageId' | 'threadKey' | 'offlineThreadingId' | 'timestampMs' | 'senderId'>

export const messages = sqliteTable('messages', {
  raw: text('raw'),
  // message: blob('message', { mode: 'json' }).$type<RawMessage>(),
  message: text('message'),
  threadKey: text('threadKey').notNull().references(() => threads.threadKey),
  messageId: text('messageId').primaryKey(),
  offlineThreadingId: text('offlineThreadingId'),
  timestampMs: integer('timestampMs', { mode: 'timestamp' }),
  senderId: text('senderId').notNull(),
})

type AttachmentInJoin = {
  attachmentFbid: string
  attachment: string
}

export type DBMessageSelect = InferModel<typeof messages, 'select'>
export type DBMessageSelectDefault = Pick<DBMessageSelect, 'threadKey' | 'messageId' | 'message' | 'timestampMs' | 'senderId'>
export type DBMessageSelectWithAttachments = DBMessageSelectDefault & {
  attachments: AttachmentInJoin[]
  reactions: DBReaction[]
}

export type DBMessageInsert = InferModel<typeof messages, 'insert'>

export const typingIndicators = sqliteTable('typing_indicators', {
  // original: blob('_original', { mode: 'json' }).$type<unknown>(),
  raw: text('raw'),
  threadKey: text('threadKey').notNull(),
  minTimestampMs: integer('minTimestampMs', { mode: 'timestamp' }),
  minMessageId: text('minMessageId'),
  maxTimestampMs: integer('maxTimestampMs', { mode: 'timestamp' }),
  maxMessageId: text('maxMessageId'),
  isLoadingBefore: integer('isLoadingBefore', { mode: 'boolean' }),
  isLoadingAfter: integer('isLoadingAfter', { mode: 'boolean' }),
  hasMoreBefore: integer('hasMoreBefore', { mode: 'boolean' }),
  hasMoreAfter: integer('hasMoreAfter', { mode: 'boolean' }),
})

export type RawAttachment = Omit<IGAttachment, 'raw' | 'threadKey' | 'messageId' | 'attachmentFbid' | 'timestampMs' | 'offlineAttachmentId'>

export const attachments = sqliteTable('attachments', {
  raw: text('raw'),
  attachment: text('attachment'),
  // attachment: blob('attachment', { mode: 'json' }).$type<RawAttachment>(),
  threadKey: text('threadKey').notNull().references(() => threads.threadKey),
  messageId: text('messageId').notNull().references(() => messages.messageId),
  attachmentFbid: text('attachmentFbid'),
  timestampMs: integer('timestampMs', { mode: 'timestamp' }),
  offlineAttachmentId: text('offlineAttachmentId'),
}, table => ({
  pk: primaryKey(table.threadKey, table.messageId, table.attachmentFbid),
}))

export const attachmentRelations = relations(attachments, ({ one }) => ({
  message: one(messages, { fields: [attachments.messageId], references: [messages.messageId] }),
}))

export type DBAttachmentSelect = InferModel<typeof attachments, 'select'>
export type DBAttachmentInsert = InferModel<typeof attachments, 'insert'>

export const users = sqliteTable('users', {
  // original: blob('_original', { mode: 'json' }).$type<unknown>(),
  raw: text('raw'),
  id: text('id').notNull().primaryKey(),
  profilePictureUrl: text('profilePictureUrl'),
  name: text('name'),
  username: text('username'),
})

export type IGUser = InferModel<typeof users, 'select'>

export const participants = sqliteTable('participants', {
  // original: blob('_original', { mode: 'json' }).$type<unknown>(),
  raw: text('raw'),
  threadKey: text('threadKey').notNull().references(() => threads.threadKey),
  userId: text('userId').notNull().references(() => users.id),
  readWatermarkTimestampMs: integer('readWatermarkTimestampMs', { mode: 'timestamp' }),
  readActionTimestampMs: integer('readActionTimestampMs', { mode: 'timestamp' }),
  deliveredWatermarkTimestampMs: integer('deliveredWatermarkTimestampMs', { mode: 'timestamp' }),
  lastDeliveredActionTimestampMs: integer('lastDeliveredActionTimestampMs', { mode: 'timestamp' }),
  // lastDeliveredWatermarkTimestampMs: integer('lastDeliveredWatermarkTimestampMs', { mode: 'timestamp' }),
  isAdmin: integer('isAdmin', { mode: 'boolean' }),
}, table => ({
  pk: primaryKey(table.threadKey, table.userId),
}))

export const participantRelations = relations(participants, ({ one }) => ({
  thread: one(threads, { fields: [participants.threadKey], references: [threads.threadKey] }),
  users: one(users, { fields: [participants.userId], references: [users.id] }),
}))

export const userRelations = relations(users, ({ many }) => ({
  participants: many(participants),
}))

export const threadsRelation = relations(threads, ({ many }) => ({
  messages: many(messages),
  participants: many(participants),
}))

export type DBParticipantSelect = InferModel<typeof participants, 'select'>
export type DBParticipantInsert = InferModel<typeof participants, 'insert'>

export const reactions = sqliteTable('reactions', {
  raw: text('raw'),
  // original: blob('_original', { mode: 'json' }).$type<unknown>(),
  // threadKey: text('threadKey').references(() => threads.threadKey),
  threadKey: text('threadKey'),
  timestampMs: integer('timestampMs', { mode: 'timestamp' }),
  messageId: text('messageId'),
  // messageId: text('messageId').notNull().references(() => messages.messageId),
  // actorId: text('actorId').notNull().references(() => users.id),
  actorId: text('actorId'),
  reaction: text('reaction'),
}, table => ({
  pk: primaryKey(table.threadKey, table.messageId, table.actorId),
}))

export const reactionRelations = relations(reactions, ({ one }) => ({
  message: one(messages, { fields: [reactions.messageId], references: [messages.messageId] }),
}))
export const messageRelations = relations(messages, ({ one, many }) => ({
  thread: one(threads, { fields: [messages.threadKey], references: [threads.threadKey] }),
  reactions: many(reactions),
  attachments: many(attachments),

}))
export type DBReaction = InferModel<typeof reactions, 'select'>
