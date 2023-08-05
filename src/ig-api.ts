import { CookieJar } from 'tough-cookie'
import FormData from 'form-data'
import { FetchOptions, texts, type User } from '@textshq/platform-sdk'
import { desc, eq, type InferModel } from 'drizzle-orm'
import { ServerEventType } from '@textshq/platform-sdk'
import fs from 'fs/promises'
import { queryMessages, queryThreads } from './store/helpers'

// import { ServerEventType } from '@textshq/platform-sdk'
import * as schema from './store/schema'
import { parseRawPayload } from './parsers'
import { getLogger } from './logger'
import { RequestResolverResolver, RequestResolverType } from './ig-socket'
import { APP_ID } from './constants'
import type Instagram from './api'
import type { SerializedSession } from './types'

const INSTAGRAM_BASE_URL = 'https://www.instagram.com/' as const

const fixUrl = (url: string) =>
  url && decodeURIComponent(url.replace(/\\u0026/g, '&'))

interface InstagramParsedViewerConfig {
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

const commonHeaders = {
  authority: 'www.instagram.com',
  'accept-language': 'en',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-ch-ua-platform-version': '"13.2.1"',
  'sec-ch-ua':
    '"Not.A/Brand";v="8", "Chromium";v="114", "Google Chrome";v="114"',
  'sec-fetch-site': 'same-origin',
  'sec-ch-ua-full-version-list':
    '"Not.A/Brand";v="8.0.0.0", "Chromium";v="114.0.5735.133", "Google Chrome";v="114.0.5735.133"',
} as const

export default class InstagramAPI {
  viewerConfig: InstagramParsedViewerConfig

  private logger = getLogger('ig-api')

  constructor(private readonly papi: Instagram) {}

  authMethod: 'login-window' | 'extension' = 'login-window'

  jar: CookieJar

  ua: SerializedSession['ua'] = texts.constants.USER_AGENT

  clientId: SerializedSession['clientId']

  dtsg: SerializedSession['dtsg']

  fbid: SerializedSession['fbid']

  lsd: SerializedSession['lsd']

  cursor: string

  lastThreadReference: {
    reference_thread_key: string
    reference_activity_timestamp: number
    hasMoreBefore: boolean
  }

  private readonly http = texts.createHttpClient()

  private httpRequest(url: string, opts: FetchOptions) {
    return this.http.requestAsString(url, {
      cookieJar: this.jar,
      ...opts,
      headers: {
        'user-agent': this.ua,
        ...commonHeaders,
        ...opts.headers,
      },
    })
  }

  async init() {
    const { clientId, dtsg, lsd, fbid, config } = await this.getClientId()
    this.clientId = clientId
    this.dtsg = dtsg
    this.fbid = fbid
    this.lsd = lsd

    this.papi.currentUser = {
      id: config.id,
      fullName: config.full_name,
      imgURL: fixUrl(config.profile_pic_url_hd),
      username: config.username,
    }
    await this.getInitialPayload()
  }

  private async getClientId() {
    const { body } = await this.httpRequest(INSTAGRAM_BASE_URL + 'direct/', {
      // todo: refactor headers
      headers: {
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'cache-control': 'max-age=0',
        'sec-ch-ua':
          '"Not.A/Brand";v="8", "Chromium";v="114", "Google Chrome";v="114"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'viewport-width': '1280',
      },
    })
    const clientId = body.slice(body.indexOf('{"clientID":')).split('"')[3]
    const dtsg = body.slice(body.indexOf('DTSGInitialData')).split('"')[4]
    const fbid = body.match(/"IG_USER_EIMU":"([^"]+)"/)?.[1]
    const lsd = body.match(/"LSD",\[\],\{"token":"([^"]+)"\}/)?.[1]
    const sharedData = body.match(/"XIGSharedData",\[\],({.*?})/s)[1]
    // @TODO: this is disgusting
    const config: InstagramParsedViewerConfig = JSON.parse(
      `${
        sharedData.split('"viewer\\":')[1].split(',\\"badge_count')[0]
      // eslint-disable-next-line no-useless-escape
      }}`.replace(/\\\"/g, '"'),
    )
    return { clientId, lsd, dtsg, fbid, config }
  }

  getCookies() {
    return this.jar.getCookieStringSync(INSTAGRAM_BASE_URL)
  }

  // they have different gql endpoints will merge these later
  async getUserByUsername(username: string) {
    const response = await this.httpRequest(INSTAGRAM_BASE_URL + 'api/v1/users/web_profile_info/?' + new URLSearchParams({ username }).toString(), {
      // todo: refactor headers
      headers: {
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'sec-ch-ua': '"Not.A/Brand";v="8", "Chromium";v="114"',
        'sec-ch-ua-full-version-list':
            '"Not.A/Brand";v="8.0.0.0", "Chromium";v="114.0.5735.198"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua-platform-version': '"13.5.0"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'viewport-width': '1280',
        'x-asbd-id': '129477',
        'x-csrftoken': this.getCSRFToken(),
        'x-ig-app-id': APP_ID,
        'x-ig-www-claim':
            'hmac.AR2iCvyZhuDG-oJQ0b4-4DlKN9a9bGK2Ovat6h04VbnVxuUU',
        'x-requested-with': 'XMLHttpRequest',
        Referer: `${INSTAGRAM_BASE_URL}${username}/`,
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
    })
    const json = JSON.parse(response.body)
    const data = await json.data
    const userInfo = data?.data?.user
    const user: User = {
      id: userInfo?.id,
      fullName: userInfo?.full_name,
      username: userInfo?.username,
    }
    this.logger.info(
      `getUserByUsername ${username} response: ${JSON.stringify(user, null, 2)}`,
    )
    return user
  }

  async graphqlCall<T extends {}>(doc_id: string, variables: T) {
    const response = await this.httpRequest(INSTAGRAM_BASE_URL + 'api/graphql/', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      // todo: maybe use FormData instead:
      body: new URLSearchParams({ fb_dtsg: this.dtsg, variables: JSON.stringify(variables), doc_id }).toString(),
    })
    const json = JSON.parse(response.body)
    // texts.log(`graphqlCall ${doc_id} response: ${JSON.stringify(json, null, 2)}`)
    return { data: json }
  }

  // get username from here
  async getUserById(userID: string) {
    this.logger.info(`getUser ${userID}`)
    const response = await this.graphqlCall('6083412141754133', { userID })
    this.logger.info(`getUser ${userID} response: ${JSON.stringify(response.data)}`)
    const data = response.data as {
      data: {
        userInfo: {
          user: {
            username: string
            show_ig_app_switcher_badge: boolean
            id: string
          }
        }
      }
      extensions: {
        is_final: boolean
      }
    }
    return {
      id: data?.data?.userInfo?.user?.id,
      username: data?.data?.userInfo?.user?.username,
      fullName: data?.data?.userInfo?.user?.username, // @TODO
    }
  }

  async getMe() {
    if (!this.viewerConfig) return
    const data = await this.getUserById(this.viewerConfig.id)
    const { username } = data
    if (!username) return
    const user = await this.getUserByUsername(username)
    return user
  }

  getCSRFToken() {
    return this.jar
      .getCookiesSync(INSTAGRAM_BASE_URL)
      .find(c => c.key === 'csrftoken')?.value
  }

  async getInitialPayload() {
    const response = await this.graphqlCall('6195354443842040', {
      deviceId: this.clientId,
      requestId: 0,
      requestPayload: JSON.stringify({
        database: 1,
        epoch_id: 0,
        last_applied_cursor: this.cursor,
        sync_params: JSON.stringify({}),
        version: 9477666248971112,
      }),
      requestType: 1,
    })
    return this.handlePayload(response.data.data.lightspeed_web_request_for_igd.payload)
  }

  async handlePayload(payload: any, requestId?: number, requestType?: RequestResolverType, requestResolver?: RequestResolverResolver) {
    let rawd: ReturnType<typeof parseRawPayload>
    try {
      rawd = parseRawPayload(payload)
    } catch (err) {
      this.logger.info('ig-api handlePayload error', err)
      return
    }
    this.logger.info('ig-api handlePayload', rawd)

    if (requestId && requestType) {
      this.logger.debug(`[${requestId}] resolved request for ${requestType}`, rawd, payload)
      requestResolver(rawd)
    }

    // add all parsed fields to the ig-api store
    if (rawd.deleteThenInsertThread) {
      const threads = rawd.deleteThenInsertThread.map(t => ({
        ...t,
        threadKey: t.threadKey!,
      }))
      const lastThread: schema.IGThread = threads?.length > 0 ? threads[threads.length - 1] : null
      if (lastThread) {
        this.lastThreadReference = {
          reference_activity_timestamp: lastThread.lastActivityTimestampMs?.getTime(),
          reference_thread_key: lastThread.threadKey,
          hasMoreBefore: rawd.upsertSyncGroupThreadsRange[0].hasMoreBefore!,
        }
      }

      await this.addThreads(threads)
    }

    if (rawd.verifyContactRowExists) this.addUsers(rawd.verifyContactRowExists)

    if (rawd.addParticipantIdToGroupThread) {
      const participants = rawd.addParticipantIdToGroupThread.map(p => ({
        ...p,
        threadKey: p.threadKey!,
        userId: p.userId!,
      }))
      await this.addParticipants(participants)
    }

    if (rawd.upsertMessage) {
      const messages = rawd.upsertMessage.map(m => ({
        ...m,
        threadKey: m.threadKey!,
        messageId: m.messageId!,
        senderId: m.senderId!,
      }))
      await this.addMessages(messages)
    }

    if (rawd.upsertReaction) {
      await this.addReactions(rawd.upsertReaction)
    }

    if (rawd.insertBlobAttachment) {
      await this.addAttachments(rawd.insertBlobAttachment)
    }

    if (rawd.cursor) {
      this.cursor = rawd.cursor
    }

    // todo:
    // once all payloads are handled, we can emit server events and get data from the store

    if (rawd.deleteThenInsertThread) { // can also check for deleteThenInsertThread
      // there are new threads to send to the platform
      this.logger.info('new threads to send to the platform')
      const newThreadIds = rawd.deleteThenInsertThread.map(t => t.threadKey)
      const threads = await queryThreads(this.papi.db, newThreadIds, this.fbid)

      this.papi.onEvent?.([{
        type: ServerEventType.STATE_SYNC,
        objectName: 'thread',
        objectIDs: {},
        mutationType: 'upsert',
        entries: threads,
      }])
      if (this.papi.sendPromiseMap.has('threads')) {
        const [resolve] = this.papi.sendPromiseMap.get('threads')
        this.logger.info('resolve threads')
        this.papi.sendPromiseMap.delete('threads')
        resolve({ threads, hasMoreBefore: rawd.upsertSyncGroupThreadsRange[0].hasMoreBefore })
      }
    } else if (rawd.insertNewMessageRange) {
      // new messages to send to the platform
      const newMessageIds = rawd.upsertMessage.map(m => m.messageId)
      const messages = await queryMessages(this.papi.db, newMessageIds, this.fbid)

      this.logger.info('new messages are', messages)
      this.logger.info('rawd.insertNewMessageRange', rawd.insertNewMessageRange)
      const threadID = rawd.insertNewMessageRange[0].threadKey
      this.logger.info('thread id in ig-papi is', threadID)

      this.papi.onEvent?.([{
        type: ServerEventType.STATE_SYNC,
        objectName: 'message',
        objectIDs: { threadID: threadID! },
        mutationType: 'upsert',
        entries: messages,
      }])

      if (this.papi.sendPromiseMap.has(`messages-${threadID}`)) {
        const [resolve] = this.papi.sendPromiseMap.get(`messages-${threadID}`)
        this.logger.info(`resolving messages-${threadID}`)
        this.papi.sendPromiseMap.delete(`messages-${threadID}`)
        resolve({ messages, hasMoreBefore: rawd.insertNewMessageRange[0].hasMoreBefore })
      }
    } else if (rawd.insertMessage) {
      // new message to send to the platform
      const rawm = rawd.insertMessage.map(m => ({
        ...m,
        threadKey: m.threadKey!,
        messageId: m.messageId!,
        senderId: m.senderId!,
      }))
      await this.addMessages(rawm)
      const messages = await queryMessages(this.papi.db, [rawm[0].messageId], this.fbid)
      this.logger.info('insertMessage: queryMessages', messages)
      this.papi.onEvent?.([{
        type: ServerEventType.STATE_SYNC,
        objectName: 'message',
        objectIDs: { threadID: rawm[0].threadKey! },
        mutationType: 'upsert',
        entries: messages,
      }])
    }
  }

  addThreads(threads: InferModel<typeof schema['threads'], 'insert'>[]) {
    this.logger.info('addThreads', threads)

    const threadsWithNoBool = threads.map(thread => {
      const newThread = { ...thread }
      for (const key in newThread) {
        if (typeof newThread[key] === 'boolean') {
          newThread[key] = newThread[key] ? 1 : 0
        }
      }
      return newThread
    })
    this.logger.info('addThreads (threadsWithNoBool)', threadsWithNoBool)

    return this.papi.db.insert(schema.threads).values(threadsWithNoBool).onConflictDoNothing().run()
  }

  addUsers(users: InferModel<typeof schema['users'], 'insert'>[]) {
    this.logger.info('addUsers', users)
    return this.papi.db.insert(schema.users).values(users).onConflictDoNothing().run()
  }

  addParticipants(participants: InferModel<typeof schema['participants'], 'insert'>[]) {
    this.logger.info('addParticipants', participants)
    return this.papi.db.insert(schema.participants).values(participants).onConflictDoNothing().run()
  }

  addMessages(messages: InferModel<typeof schema['messages'], 'insert'>[]) {
    this.logger.info('addMessages', messages)

    const messagesWithNoBool = messages.filter(m => m?.threadKey !== null).map(message => {
      const newMessage = { ...message }
      for (const key in newMessage) {
        if (typeof newMessage[key] === 'boolean') {
          newMessage[key] = newMessage[key] ? 1 : 0
        }
      }
      return newMessage
    })

    this.logger.info('addMessages (messagesWithNoBool)', messagesWithNoBool)

    return this.papi.db
      .insert(schema.messages)
      .values(messagesWithNoBool)
      .onConflictDoNothing()
      .run()
  }

  addReactions(reactions: InferModel<typeof schema['reactions'], 'insert'>[]) {
    this.logger.info('addReactions', reactions)
    return this.papi.db
      .insert(schema.reactions)
      .values(reactions)
      .onConflictDoNothing()
      .run()
  }

  addAttachments(attachments: InferModel<typeof schema['attachments'], 'insert'>[]) {
    this.logger.info('addAttachments', attachments)
    const attachmentsWithNoBool = attachments.map(attachment => {
      const newAttachments = { ...attachment }
      for (const key in newAttachments) {
        if (typeof newAttachments[key] === 'boolean') {
          newAttachments[key] = newAttachments[key] ? 1 : 0
        }
      }
      return newAttachments
    })
    this.logger.info('addAttachments (attachmentsWithNoBool)', attachmentsWithNoBool)

    return this.papi.db
      .insert(schema.attachments)
      .values(attachmentsWithNoBool)
      .onConflictDoNothing()
      .run()
  }

  getMessage(threadKey: string, messageId: string) {
    return this.papi.db
      .select({
        threadKey: schema.messages.threadKey,
        messageId: schema.messages.messageId,
        timestampMs: schema.messages.timestampMs,
      })
      .from(schema.messages)
      .limit(1)
      .where(eq(schema.messages.threadKey, threadKey))
      .where(eq(schema.messages.messageId, messageId))
      .get()
  }

  getNewestMessage(threadKey: string) {
    return this.papi.db
      .select({
        threadKey: schema.messages.threadKey,
        messageId: schema.messages.messageId,
        timestampMs: schema.messages.timestampMs,
      })
      .from(schema.messages)
      .limit(1)
      .where(eq(schema.messages.threadKey, threadKey))
      .orderBy(desc(schema.messages.timestampMs))
      .get()
  }

  private async uploadPhoto(threadID: string, filePath: string, fileName?: string) {
    const file = await fs.readFile(filePath)
    const formData = new FormData()
    formData.append('farr', file, { filename: fileName })
    const res = await this.httpRequest(INSTAGRAM_BASE_URL + 'ajax/mercury/upload.php?' + new URLSearchParams({
      __a: '1',
      fb_dtsg: this.dtsg,
    }).toString(), {
      method: 'POST',
      body: formData,
      // todo: refactor headers
      headers: {
        authority: 'www.instagram.com',
        accept: '*/*',
        'accept-language': 'en',
        origin: 'https://www.instagram.com',
        referer: `${INSTAGRAM_BASE_URL}direct/t/${threadID}/`,
        'sec-ch-ua': '"Not.A/Brand";v="8", "Chromium";v="114", "Google Chrome";v="114"',
        'sec-ch-ua-full-version-list': '"Not.A/Brand";v="8.0.0.0", "Chromium";v="114.0.5735.198", "Google Chrome";v="114.0.5735.198"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua-platform-version': '"13.4.1"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': this.ua,
        'viewport-width': '1280',
        'x-asbd-id': '129477',
        'x-fb-lsd': this.lsd,
      },
    })

    const response = res.body
    const jsonStartIndex = response.indexOf('{')
    const jsonResponse = response.substring(jsonStartIndex)
    const parsedData = JSON.parse(jsonResponse)
    return parsedData
  }

  async sendImage(threadID: string, { filePath, fileName }: { filePath: string, fileName: string }) {
    this.logger.info('sendImage about to call uploadPhoto')
    const res = await this.uploadPhoto(threadID, filePath, fileName)
    this.logger.info('sendImage', res)
    const imageId = res.payload.metadata[0].image_id
    return this.papi.socket.sendImage(threadID, imageId)
  }
}
