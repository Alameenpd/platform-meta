import { Message } from '@textshq/platform-sdk'

export type IGThread = {
  raw: string
  threadKey: string
  lastReadWatermarkTimestampMs: number
  threadType: string
  folderName: string
  parentThreadKey: string
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
  raw: string
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
  links: Message['links']
  extra?: {
    mediaLink?: string
  }
  textHeading?: string
}

export type IGAttachment = {
  raw: string
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
  dashManifest: string
  previewUrl: string
  previewUrlFallback: string
  previewUrlExpirationTimestampMs: number
  previewUrlMimeType: string
  miniPreview: string
  previewWidth: number
  previewHeight: number
  attributionAppId: string
  attributionAppName: string
  attributionAppIcon: string
  attributionAppIconFallback: string
  attributionAppIconUrlExpirationTimestampMs: number
  localPlayableUrl: string
  playableDurationMs: number
  attachmentIndex: string
  accessibilitySummaryText: string
  isPreviewImage: boolean
  originalFileHash: string
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
  samplingFrequencyHz: number
  waveformData: string
  authorityLevel: string
}

export type IGParsedViewerConfig = {
  biography: string
  business_address_json: null
  business_contact_method: string
  business_email: null
  business_phone_number: null
  can_see_organic_insights: boolean
  category_name: null
  external_url: null
  fbid: string
  full_name: string
  has_phone_number: boolean
  has_profile_pic: boolean
  has_tabbed_inbox: boolean
  hide_like_and_view_counts: boolean
  id: string
  is_business_account: boolean
  is_joined_recently: boolean
  is_supervised_user: boolean
  guardian_id: null
  is_private: boolean
  is_professional_account: boolean
  is_supervision_enabled: boolean
  profile_pic_url: string
  profile_pic_url_hd: string
  should_show_category: boolean
  should_show_public_contacts: boolean
  username: string
}

export type IGReadReceipt = {
  raw: string
  threadKey: string
  readWatermarkTimestampMs: number
  readActionTimestampMs: number
  contactId: string
}
