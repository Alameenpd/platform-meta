import type { PlatformAPI, Message } from '@textshq/platform-sdk'
import type { CookieJar } from 'tough-cookie'

export type MethodReturnType<T, K extends keyof T> = T[K] extends (...args: any[]) => infer R ? R : never

export type PAPIReturn<K extends keyof PlatformAPI> = Promise<Awaited<MethodReturnType<PlatformAPI, K>>>

export interface SerializedSession {
  jar: CookieJar.Serialized
  ua?: string
  authMethod?: 'login-window' | 'extension'
  _v: 'v3'
  // clientId: string
  // dtsg: string
  // fbid: string
  // igUserId: string
  // lsd: string
  // wwwClaim: string
  // lastCursor: string
}

export enum SyncGroup {
  MAIN = 1,
  UNKNOWN = 95,
}

export enum ThreadFilter {
  GENERAL = 4,
  PRIMARY = 3,
}

export enum ParentThreadKey {
  PRIMARY = 0,
  GENERAL = -1,
  SPAM = -3,
}

export type IGThread = {
  raw: string
  threadKey: string
  lastReadWatermarkTimestampMs: number
  threadType: string
  folderName: string
  parentThreadKey: ParentThreadKey
  lastActivityTimestampMs: number
  snippet: string
  threadName: string
  threadPictureUrl: string
  needsAdminApprovalForNewParticipant: boolean
  threadPictureUrlFallback: string
  threadPictureUrlExpirationTimestampMs: number
  removeWatermarkTimestampMs: number
  muteExpireTimeMs: number
  groupNotificationSettings: string // potentially a different type if it's a complex object
  isAdminSnippet: boolean
  snippetSenderContactId: string
  snippetStringHash: string
  snippetStringArgument1: string
  snippetAttribution: string
  mailboxType: string
  draftMessage: string
  snippetAttributionStringHash: string
  disappearingSettingTtl: number
  disappearingSettingUpdatedTs: number
  disappearingSettingUpdatedBy: string
  cannotReplyReason: string
  customEmoji: string
  customEmojiImageUrl: string
  outgoingBubbleColor: string
  themeFbid: string
  authorityLevel: number
  muteMentionExpireTimeMs: number
  muteCallsExpireTimeMs: number
  ongoingCallState: string
  cannotUnsendReason: string
  snippetHasEmoji: boolean
  hasPersistentMenu: boolean
  disableComposerInput: boolean
  shouldRoundThreadPicture: boolean
  proactiveWarningDismissTime: number
  isCustomThreadPicture: boolean
  otidOfFirstMessage: string
  normalizedSearchTerms: string
  additionalThreadContext: string
  disappearingThreadKey: string
  isDisappearingMode: boolean
  disappearingModeInitiator: string
  unreadDisappearingMessageCount: number
  lastMessageCtaId: string
  lastMessageCtaType: string
  lastMessageCtaTimestampMs: number
  consistentThreadFbid: string
  threadDescription: string
  unsendLimitMs: number
  capabilities2: string
  capabilities3: string
  syncGroup: string
  threadInvitesEnabled: boolean
  threadInviteLink: string
  isAllUnreadMessageMissedCallXma: boolean
  lastNonMissedCallXmaMessageTimestampMs: number
  threadInvitesEnabledV2: boolean
  hasPendingInvitation: boolean
  eventStartTimestampMs: number
  eventEndTimestampMs: number
  takedownState: string
  secondaryParentThreadKey: string
  igFolder: string
  inviterId: string
  threadTags: string
  threadStatus: string
  threadSubtype: string
  pauseThreadTimestamp: number
  nullstateDescriptionText1: string
  nullstateDescriptionText2: string
  nullstateDescriptionText3: string
  nullstateDescriptionType1: string
  nullstateDescriptionType2: string
  nullstateDescriptionType3: string
  viewedPluginKey: string
  viewedPluginContext: string
  clientThreadKey: string
  capabilities: string
}

export type IGMessage = {
  raw?: string
  threadKey: string
  offlineThreadingId: string
  authorityLevel: number
  timestampMs: number
  messageId: string
  senderId: string
  isAdminMessage: boolean
  sendStatus: string
  sendStatusV2: string
  text: string
  subscriptErrorMessage: string
  stickerId: string
  messageRenderingType: string
  isUnsent: boolean
  unsentTimestampMs: number
  mentionOffsets: string
  mentionLengths: string
  mentionIds: string
  mentionTypes: string
  replySourceId: string
  replySourceType: string
  primarySortKey: string
  secondarySortKey: string
  replyMediaExpirationTimestampMs: number
  replySourceTypeV2: string
  replyStatus: string
  replySnippet: string
  replyMessageText: string
  replyToUserId: string
  replyMediaUrl: string
  replyMediaPreviewWidth: string
  replyMediaPreviewHeight: string
  replyMediaUrlMimeType: string
  replyMediaUrlFallback: string
  replyCtaId: string
  replyCtaTitle: string
  replyAttachmentType: string
  replyAttachmentId: string
  replyAttachmentExtra: string
  replyType?: string
  isForwarded: boolean
  forwardScore: string
  hasQuickReplies: boolean
  adminMsgCtaId: string
  adminMsgCtaTitle: string
  adminMsgCtaType: string
  cannotUnsendReason: string
  textHasLinks: number
  viewFlags: string
  displayedContentTypes: string
  viewedPluginKey: string
  viewedPluginContext: string
  quickReplyType: string
  hotEmojiSize: string
  replySourceTimestampMs: number
  ephemeralDurationInSec: string
  msUntilExpirationTs: number
  ephemeralExpirationTs: number
  takedownState: string
  isCollapsed: boolean
  subthreadKey: string
  links?: Message['links']
  extra?: {
    mediaLink?: string
    assetURL?: string
  }
  textHeading?: string
}

export type IGAttachment = {
  threadKey: string
  messageId: string
  attachmentFbid: string
  filename: string
  filesize: number
  hasMedia: boolean
  isSharable: boolean
  playableUrl: string
  playableUrlFallback: string
  playableUrlExpirationTimestampMs: number
  playableUrlMimeType: string
  dashManifest?: string
  previewUrl: string
  previewUrlFallback: string
  previewUrlExpirationTimestampMs: number
  previewUrlMimeType: string
  miniPreview?: string
  previewWidth: number
  previewHeight: number
  attributionAppId: string
  attributionAppName: string
  attributionAppIcon: string
  attributionAppIconFallback: string
  attributionAppIconUrlExpirationTimestampMs: number
  localPlayableUrl?: string
  playableDurationMs?: number
  attachmentIndex: string
  accessibilitySummaryText: string
  isPreviewImage?: boolean
  originalFileHash?: string
  attachmentType: string
  timestampMs: number
  offlineAttachmentId: string
  hasXma: boolean
  xmaLayoutType: string
  xmasTemplateType: string
  titleText: string
  subtitleText: string
  descriptionText: string
  sourceText: string
  faviconUrlExpirationTimestampMs: number
  isBorderless: boolean
  previewUrlLarge: string
  samplingFrequencyHz?: number
  waveformData?: string
  authorityLevel: string
  shouldRespectServerPreviewSize?: boolean
  subtitleIconUrl?: string
  shouldAutoplayVideo?: boolean
  collapsibleId?: string
  defaultCtaId?: string
  defaultCtaTitle?: string
  defaultCtaType?: string
  attachmentCta1Id?: string
  cta1IconType?: string
  cta1Type?: string
  attachmentCta2Id?: string
  cta2Title?: string
  cta2IconType?: string
  cta2Type?: string
  attachmentCta3Id?: string
  cta3Title?: string
  cta3IconType?: string
  cta3Type?: string
  imageUrl?: string
  imageUrlFallback?: string
  imageUrlExpirationTimestampMs?: number
  actionUrl?: string
  maxTitleNumOfLines?: string
  maxSubtitleNumOfLines?: string
  faviconUrl?: string
  faviconUrlFallback?: string
  listItemsId?: string
  listItemsDescriptionText?: string
  listItemsDescriptionSubtitleText?: string
  listItemsSecondaryDescriptionText?: string
  listItemId1?: string
  listItemTitleText1?: string
  listItemContactUrlList1?: string
  listItemProgressBarFilledPercentage1?: string
  listItemContactUrlExpirationTimestampList1?: string
  listItemContactUrlFallbackList1?: string
  listItemAccessibilityText1?: string
  listItemTotalCount1?: string
  listItemId2?: string
  listItemTitleText2?: string
  listItemContactUrlList2?: string
  listItemProgressBarFilledPercentage2?: string
  listItemContactUrlExpirationTimestampList2?: string
  listItemContactUrlFallbackList2?: string
  listItemAccessibilityText2?: string
  listItemTotalCount2?: string
  listItemId3?: string
  listItemTitleText3?: string
  listItemContactUrlList3?: string
  listItemProgressBarFilledPercentage3?: string
  listItemContactUrlExpirationTimestampList3?: string
  listItemContactUrlFallbackList3?: string
  listItemAccessibilityText3?: string
  listItemTotalCount3?: string
  headerImageUrlMimeType?: string
  headerTitle?: string
  headerSubtitleText?: string
  headerImageUrl?: string
  headerImageUrlFallback?: string
  headerImageUrlExpirationTimestampMs?: number
  previewImageDecorationType?: string
  shouldHighlightHeaderTitleInTitle?: string
  targetId?: string
  attachmentLoggingType?: string
  gatingType?: string
  gatingTitle?: string
  targetExpiryTimestampMs?: number
  countdownTimestampMs?: number
  shouldBlurSubattachments?: string
  verifiedType?: string
  captionBodyText?: string
  isPublicXma?: string
  cta1Title?: string
}

export type IGReadReceipt = {
  threadKey: string
  contactId: string
  readWatermarkTimestampMs?: Date
  readActionTimestampMs?: Date
}

export type IGContact = {
  raw: string
  id: string
  profilePictureUrl: string
  name: string
  username: string
  profilePictureFallbackUrl: string
  secondaryName: string
  isMemorialized: string
  blockedByViewerStatus: string
  canViewerMessage: string
  contactType: string
  authorityLevel: string
  capabilities: string
  capabilities2: string
  contactViewerRelationship: string
  gender: string
}

export type IGMessageRanges = {
  threadKey: string
  minTimestamp: string
  maxTimestamp: string
  minMessageId?: string
  maxMessageId?: string
  hasMoreBeforeFlag: boolean
  hasMoreAfterFlag: boolean
}

export type MetaThreadRanges = {
  syncGroup: SyncGroup
  parentThreadKey: ParentThreadKey
  minLastActivityTimestampMs: string
  hasMoreBefore: boolean
  isLoadingBefore: boolean
  minThreadKey: string
}
