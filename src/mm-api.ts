import fs from 'fs/promises'
import crypto from 'crypto'
import { CookieJar } from 'tough-cookie'
import FormData from 'form-data'
import {
  type FetchOptions,
  InboxName, MessageContent,
  type MessageSendOptions,
  ReAuthError,
  texts,
  type User,
} from '@textshq/platform-sdk'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { ExpectedJSONGotHTMLError } from '@textshq/platform-sdk/dist/json'
import { type QueryMessagesArgs, QueryThreadsArgs, QueryWhereSpecial } from './store/helpers'

import * as schema from './store/schema'
import { messages as messagesSchema, threads as threadsSchema } from './store/schema'
import { getLogger, Logger } from './logger'
import type Instagram from './api'
import type { IGAttachment, IGMessage, IGMessageRanges, SerializedSession } from './types'
import { MetaThreadRanges, ParentThreadKey, SyncGroup, ThreadFilter } from './types'
import {
  createPromise,
  genClientContext,
  getTimeValues,
  INT64_MAX_AS_STRING,
  parseMessageRanges,
  parseUnicodeEscapeSequences,
} from './util'
import { mapMessages, mapThread } from './mappers'
import { queryMessages, queryThreads } from './store/queries'
import { getMessengerConfig } from './parsers/messenger-config'
import MetaMessengerPayloadHandler from './payload-handler'
import EnvOptions, { type EnvKey } from './env'
import { MetaMessengerError } from './errors'
import { RequestResolverReject, RequestResolverType, ThreadRemoveType } from './socket'

// @TODO: needs to be updated
export const SHARED_HEADERS = {
  'accept-language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Not.A/Brand";v="8", "Chromium";v="114"',
  'sec-ch-ua-full-version-list': '"Not.A/Brand";v="8.0.0.0", "Chromium";v="114.0.5735.198"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-ch-ua-platform-version': '"13.5.0"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'viewport-width': '1280',
  // te: 'trailers',
} as const

const fixUrl = (url: string) =>
  url && decodeURIComponent(url.replace(/\\u0026/g, '&'))

export default class MetaMessengerAPI {
  private _initPromise = createPromise<void>()

  initResolved = false

  get initPromise() {
    return this._initPromise.promise
  }

  private logger: Logger

  constructor(private readonly papi: Instagram, env: EnvKey) {
    this.logger = getLogger(env, 'mm-api')
    this.initPromise.then(() => {
      this.initResolved = true
    })
  }

  authMethod: 'login-window' | 'extension' = 'login-window'

  jar: CookieJar

  ua: SerializedSession['ua'] = texts.constants.USER_AGENT

  config: ReturnType<typeof getMessengerConfig>

  private readonly http = texts.createHttpClient()

  private async httpRequest(url: string, opts: FetchOptions) {
    const res = await this.http.requestAsString(url, {
      cookieJar: this.jar,
      ...opts,
      followRedirect: false,
      headers: {
        'user-agent': this.ua,
        authority: this.papi.envOpts.domain,
        'accept-language': 'en',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua-platform-version': '"13.2.1"',
        'sec-ch-ua':
          '"Not.A/Brand";v="8", "Chromium";v="114", "Google Chrome";v="114"',
        'sec-fetch-site': 'same-origin',
        'sec-ch-ua-full-version-list':
          '"Not.A/Brand";v="8.0.0.0", "Chromium";v="114.0.5735.133", "Google Chrome";v="114.0.5735.133"',
        ...opts.headers,
      },
    })
    const wwwClaim = res.headers['x-ig-set-www-claim']
    if (wwwClaim) this.papi.kv.set('wwwClaim', String(wwwClaim))
    return res
  }

  private async httpJSONRequest(url: string, opts: FetchOptions) {
    const res = await this.httpRequest(url, opts)
    if (res.body[0] === '<') {
      this.logger.warn(res.statusCode, url, res.body)
      throw new ExpectedJSONGotHTMLError(res.statusCode, res.body)
    }
    // check for redirect
    if (res.statusCode === 302 && res.headers.location) {
      this.logger.warn(res.statusCode, url, 'redirecting to', res.headers.location)
      throw new ReAuthError('Encountered a checkpoint')
      // const result = await texts.openBrowserWindow(this.papi.accountID, {
      //   url: res.headers.location,
      //   cookieJar: this.jar.toJSON(),
      //   userAgent: this.ua,
      //   runJSOnLaunch: CLOSE_ON_AUTHENTICATED_JS,
      //   runJSOnNavigate: CLOSE_ON_AUTHENTICATED_JS,
      // })
    }

    return {
      statusCode: res.statusCode,
      headers: res.headers,
      json: JSON.parse(res.body),
    }
  }

  async init(triggeredFrom: 'login' | 'init') {
    this.logger.debug(`init triggered from ${triggeredFrom}`)

    const { body } = await this.httpRequest(this.papi.envOpts.initialURL, {
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

    try {
      this.config = getMessengerConfig(body)
    } catch (err) {
      console.error(err)
      texts.Sentry.captureException(err)
      throw new Error(`No valid configuration was detected: ${err.message}`)
    }

    this.papi.kv.setMany({
      'syncParams-1': JSON.stringify(this.config.syncParams),
      _fullConfig: JSON.stringify(this.config),
      appId: String(this.config.appId),
      clientId: this.config.clientID,
      fb_dtsg: this.config.fbDTSG,
      fbid: this.config.fbid,
      lsd: this.config.lsdToken,
      mqttCapabilities: String(this.config.mqttCapabilities),
      mqttClientCapabilities: String(this.config.mqttClientCapabilities),
    })

    this.papi.currentUser = {
      id: this.config.fbid,
      fullName: this.config.name,
    }

    if (this.papi.env === 'IG') {
      if (!this.config.igViewerConfig?.id) {
        throw new MetaMessengerError('IG', 0, 'failed to fetch igViewerConfig')
      }

      this.papi.kv.setMany({
        hasTabbedInbox: this.config.igViewerConfig.has_tabbed_inbox,
        igUserId: this.config.igViewerConfig.id,
      })

      // config.id, is the instagram id but fbid is instead used for chat
      this.papi.currentUser.fullName = this.config.igViewerConfig.full_name?.length > 0 ? parseUnicodeEscapeSequences(this.config.igViewerConfig.full_name) : null
      this.papi.currentUser.imgURL = this.config.igViewerConfig?.profile_pic_url_hd ? fixUrl(this.config.igViewerConfig.profile_pic_url_hd) : null
      this.papi.currentUser.username = this.config.igViewerConfig.username
    }

    for (const payload of this.config.initialPayloads) {
      await new MetaMessengerPayloadHandler(this.papi, payload, 'initial').__handle()
    }

    await this.envSwitch(() => this.getSnapshotPayloadForIGD(), () => this.getSnapshotPayloadForFB())()

    await this.papi.socket.connect()

    this._initPromise?.resolve()
  }

  getCookies() {
    return this.jar.getCookieStringSync(`https://${this.papi.envOpts.domain}/`)
  }

  envSwitch = <T>(valueForInstagram: T, valueForFacebookOrMessenger: T, defaultValue?: T) => {
    if (this.papi.env === 'IG') return valueForInstagram
    if (this.papi.envOpts.isFacebook) return valueForFacebookOrMessenger
    if (defaultValue) return defaultValue
    throw new Error('Invalid environment')
  }

  // they have different gql endpoints will merge these later
  async getUserByUsername(username: string) {
    if (this.papi.env !== 'IG') throw new Error('getUserByUsername is only supported on IG')
    const { domain } = EnvOptions.IG
    const { json } = await this.httpJSONRequest(`https://${domain}/api/v1/users/web_profile_info/?` + new URLSearchParams({ username }).toString(), {
      // @TODO: refactor headers
      headers: {
        accept: '*/*',
        ...SHARED_HEADERS,
        'x-asbd-id': '129477',
        'x-csrftoken': this.getCSRFToken(),
        'x-ig-app-id': this.papi.kv.get('appId'),
        'x-ig-www-claim': this.papi.kv.get('wwwClaim'),
        'x-requested-with': 'XMLHttpRequest',
        Referer: `https://${domain}/${username}/`,
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
    })
    const data = await json.data
    const userInfo = data?.data?.user
    const user: User = {
      id: userInfo?.id,
      fullName: userInfo?.full_name,
      username: userInfo?.username,
    }
    this.logger.debug(
      `getUserByUsername ${username} response: ${JSON.stringify(user, null, 2)}`,
    )
    return user
  }

  async graphqlCall<T extends {}>(doc_id: string, variables: T, { headers, bodyParams }: {
    headers?: Record<string, string>
    bodyParams?: Record<string, string>
  } = {
    headers: {},
    bodyParams: {},
  }) {
    const { json } = await this.httpJSONRequest(`https://${this.papi.envOpts.domain}/api/graphql/`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/x-www-form-urlencoded',
      },
      // todo: maybe use FormData instead:
      body: new URLSearchParams({
        ...bodyParams,
        fb_dtsg: this.papi.kv.get('fb_dtsg'),
        variables: JSON.stringify(variables),
        doc_id,
      }).toString(),
    })
    // texts.log(`graphqlCall ${doc_id} response: ${JSON.stringify(json, null, 2)}`)
    return { data: json }
  }

  async logout() {
    const baseURL = `https://${this.papi.envOpts.domain}/`
    switch (this.papi.env) {
      case 'IG': {
        const { json } = await this.httpJSONRequest(`${baseURL}api/v1/web/accounts/logout/ajax/`, {
          // todo: refactor headers
          method: 'POST',
          body: `one_tap_app_login=1&user_id=${this.papi.kv.get('igUserId')}`,
          headers: {
            accept: '*/*',
            ...SHARED_HEADERS,
            'x-asbd-id': '129477',
            'x-csrftoken': this.getCSRFToken(),
            'x-ig-app-id': this.papi.kv.get('appId'),
            'x-ig-www-claim': this.papi.kv.get('wwwClaim') ?? '0',
            'x-requested-with': 'XMLHttpRequest',
            Referer: baseURL,
            'x-instagram-ajax': '1007993177',
            'content-type': 'application/x-www-form-urlencoded',
          },
        })
        if (json.status !== 'ok') {
          throw new Error(`logout ${this.papi.kv.get('igUserId')} failed: ${JSON.stringify(json, null, 2)}`)
        }
        break
      }
      case 'MESSENGER': {
        const response = await this.httpRequest(`${baseURL}logout/`, {
          method: 'POST',
          body: `fb_dtsg=${this.papi.kv.get('fb_dtsg')}&jazoest=25869`,
          headers: {
            accept: '*/*',
            ...SHARED_HEADERS,
            Referer: baseURL,
            'content-type': 'application/x-www-form-urlencoded',
          },
        })
        if (response.statusCode !== 302) {
          throw new Error(`logout ${this.papi.kv.get('fbid')} failed: ${JSON.stringify(response.body, null, 2)}`)
        }
      }
        break
      default:
        throw new Error(`logout is not supported on ${this.papi.env}`)
    }
  }

  // get username from here
  async getUserById(userID: string) {
    this.logger.debug(`getUser ${userID}`)
    const response = await this.graphqlCall('6083412141754133', { userID })
    this.logger.debug(`getUser ${userID} response: ${JSON.stringify(response.data)}`)
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

  getCSRFToken() {
    return this.jar
      .getCookiesSync(`https://${this.papi.envOpts.domain}/`)
      .find(c => c.key === 'csrftoken')?.value
  }

  async getSnapshotPayloadForIGD() {
    if (this.papi.env !== 'IG') throw new Error(`getSnapshotPayloadForIGD is only supported on IG but called on ${this.papi.env}`)
    const response = await this.graphqlCall('6195354443842040', {
      deviceId: this.papi.kv.get('clientId'),
      requestId: 0,
      requestPayload: JSON.stringify({
        database: 1,
        epoch_id: 0,
        last_applied_cursor: this.papi.kv.get('cursor-1-1'),
        sync_params: JSON.stringify({}),
        version: 9477666248971112,
      }),
      requestType: 1,
    })
    await new MetaMessengerPayloadHandler(this.papi, response.data.data.lightspeed_web_request_for_igd.payload, 'snapshot').__handle()
  }

  async getSnapshotPayloadForFB() {
    if (!(this.papi.env === 'FB' || this.papi.env === 'MESSENGER')) throw new Error(`getSnapshotPayloadForFB is only supported on FB/MESSENGER but called on ${this.papi.env}`)
    const response = await this.graphqlCall('7357432314358409', {
      deviceId: this.papi.kv.get('clientId'),
      includeChatVisibility: false,
      requestId: 2,
      requestPayload: JSON.stringify({
        database: 95,
        epoch_id: 0,
        last_applied_cursor: this.papi.kv.get('cursor-1-1'),
        sync_params: this.papi.kv.get('syncParams-1'),
        version: '6566200933472970',
      }),
      requestType: 1,
    })

    await new MetaMessengerPayloadHandler(this.papi, response.data.data.viewer.lightspeed_web_request.payload, 'snapshot').__handle()
  }

  async getIGReels(media_id: string, reel_ids: string, username: string) {
    const response = await this.httpJSONRequest(
      `https://www.instagram.com/api/v1/feed/reels_media/?media_id=${media_id}&reel_ids=${reel_ids}`,
      {
        headers: {
          'User-Agent': this.ua,
          Accept: '*/*',
          'Accept-Language': 'en-US,en;q=0.5',
          'X-CSRFToken': this.getCSRFToken(),
          'X-IG-App-ID': this.papi.kv.get('appId'),
          'X-ASBD-ID': '129477',
          'X-IG-WWW-Claim': this.papi.kv.get('wwwClaim') || '0',
          'X-Requested-With': 'XMLHttpRequest',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          Referer: `https://www.instagram.com/stories/${username}/${media_id}`,
        },
      },
    )
    const data = response.json as {
      status: 'ok'
      reels?: {
        [reel_id: string]: {
          items?: {
            pk: string
            image_versions2?: {
              candidates: {
                url: string
                width: number
                height: number
              }[]
            }
            video_versions?: {
              url: string
              width: number
              height: number
            }[]
          }[]
        }
      }
    }
    if (data.status !== 'ok') {
      throw Error(`getIGReels ${media_id} ${reel_ids} ${username} failed: ${JSON.stringify(data, null, 2)}`)
    }
    const media = data.reels?.[reel_ids].items?.find(i => i.pk === media_id)
    const video = media?.video_versions?.[0]
    // const video = media?.video_versions?.find(v => v.width === 1080)
    if (video?.url) return { type: 'video', url: video.url }
    const image = media?.image_versions2?.candidates?.find(i => i.width === 1080)
    if (image?.url) return { type: 'image', url: image.url }

    throw Error(`getIGReels ${media_id} ${reel_ids} ${username} no matching media: ${JSON.stringify(data, null, 2)}`)
  }

  async setIGReelSeen({
    reelId,
    reelMediaId,
    reelMediaOwnerId,
    reelMediaTakenAt,
    viewSeenAt,
  }: {
    reelId: string
    reelMediaId: string
    reelMediaOwnerId: string
    reelMediaTakenAt: number
    viewSeenAt: number
  }) {
    if (this.papi.env !== 'IG') throw new Error(`setReelSeen is only supported on IG but called on ${this.papi.env}`)
    try {
      await this.graphqlCall('6704432082997469', {
        reelId,
        reelMediaId,
        reelMediaOwnerId,
        reelMediaTakenAt,
        viewSeenAt,
      }, {
        bodyParams: {
          fb_api_caller_class: 'RelayModern',
          fb_api_req_friendly_name: 'PolarisAPIReelSeenMutation',
          server_timestamps: 'true',
        },
      })
    } catch (e) {
      this.logger.error(e, {}, 'setReelSeen')
    }
  }

  setSyncGroupThreadsRange(p: MetaThreadRanges) {
    this.papi.kv.set(`threadsRanges-${p.syncGroup}-${p.parentThreadKey}`, JSON.stringify(p))
  }

  getSyncGroupThreadsRange(syncGroup: SyncGroup, parentThreadKey: ParentThreadKey) {
    const value = this.papi.kv.get(`threadsRanges-${syncGroup}-${parentThreadKey}`)
    return typeof value === 'string' ? JSON.parse(value) as MetaThreadRanges : null
  }

  computeSyncGroups(inbox: InboxName) {
    const generalEnabled = (
      (this.papi.env === 'IG' && this.papi.kv.get('hasTabbedInbox'))
      || this.papi.env === 'FB'
      || this.papi.env === 'MESSENGER'
    )

    const { supportsArchive } = this.papi.envOpts
    const syncGroups: [SyncGroup, ParentThreadKey][] = []

    if (inbox === 'requests') {
      syncGroups.push(
        generalEnabled && [SyncGroup.MAIN, ParentThreadKey.GENERAL],
        generalEnabled && [SyncGroup.UNKNOWN, ParentThreadKey.GENERAL],
        [SyncGroup.MAIN, ParentThreadKey.SPAM],
        [SyncGroup.UNKNOWN, ParentThreadKey.SPAM],
      )
    } else {
      syncGroups.push(
        [SyncGroup.MAIN, ParentThreadKey.PRIMARY],
        [SyncGroup.UNKNOWN, ParentThreadKey.PRIMARY],
        supportsArchive ? [SyncGroup.MAIN, ParentThreadKey.ARCHIVE] : undefined,
        supportsArchive ? [SyncGroup.UNKNOWN, ParentThreadKey.ARCHIVE] : undefined,
      )
    }

    return syncGroups.filter(Boolean)
  }

  computeServerHasMoreThreads(inbox: InboxName) {
    const syncGroups = this.computeSyncGroups(inbox)
    return syncGroups.some(([syncGroup, parentThreadKey]) => {
      const value = this.getSyncGroupThreadsRange(syncGroup, parentThreadKey)
      return typeof value?.hasMoreBefore === 'boolean' ? value.hasMoreBefore : true
    })
  }

  // @TODO: this should be migrated to `fetchMoreThreadsV3`
  async fetchMoreThreadsForIG(isSpam: boolean, isInitial: boolean) {
    if (this.papi.env !== 'IG') throw new Error(`fetchMoreThreadsForIG is only supported on IG but called on ${this.papi.env}`)
    const canFetchMore = this.computeServerHasMoreThreads(isSpam ? InboxName.REQUESTS : InboxName.NORMAL)
    if (!canFetchMore) return { fetched: false } as const
    const publishTaskOpts = {
      timeout: 15000,
      throwOnTimeout: false,
    } as const
    const getFetcher = () => {
      if (isSpam) {
        const group1 = this.getSyncGroupThreadsRange(SyncGroup.MAIN, ParentThreadKey.SPAM)
        const group95 = this.getSyncGroupThreadsRange(SyncGroup.UNKNOWN, ParentThreadKey.SPAM)
        this.logger.debug('fetchRequestThreads', {
          group1,
          group95,
        })
        return this.papi.socket.publishTask(RequestResolverType.FETCH_INITIAL_THREADS, [
          {
            label: '145',
            payload: JSON.stringify({
              is_after: 0,
              parent_thread_key: ParentThreadKey.SPAM,
              reference_thread_key: INT64_MAX_AS_STRING,
              reference_activity_timestamp: INT64_MAX_AS_STRING,
              additional_pages_to_fetch: 0,
              cursor: this.papi.kv.get('cursor-1-1'),
              messaging_tag: null,
              sync_group: SyncGroup.MAIN,
            }),
            queue_name: 'trq',
            task_id: this.papi.socket.taskIds.gen(),
            failure_count: null,
          },
          {
            label: '145',
            payload: JSON.stringify({
              is_after: 0,
              parent_thread_key: ParentThreadKey.SPAM,
              reference_thread_key: INT64_MAX_AS_STRING,
              reference_activity_timestamp: INT64_MAX_AS_STRING,
              additional_pages_to_fetch: 0,
              cursor: this.papi.kv.get('cursor-1-95'),
              messaging_tag: null,
              sync_group: SyncGroup.UNKNOWN,
            }),
            queue_name: 'trq',
            task_id: this.papi.socket.taskIds.gen(),
            failure_count: null,
          },
        ], publishTaskOpts)
      }
      if (isInitial) {
        return this.papi.socket.publishTask(RequestResolverType.FETCH_INITIAL_THREADS, [
          {
            label: '145',
            payload: JSON.stringify({
              is_after: 0,
              parent_thread_key: ParentThreadKey.GENERAL,
              reference_thread_key: 0,
              reference_activity_timestamp: 9999999999999,
              additional_pages_to_fetch: 0,
              cursor: this.papi.kv.get('cursor-1-1'),
              messaging_tag: null,
              sync_group: SyncGroup.MAIN,
            }),
            queue_name: 'trq',
            task_id: this.papi.socket.taskIds.gen(),
            failure_count: null,
          },
          {
            label: '145',
            payload: JSON.stringify({
              is_after: 0,
              parent_thread_key: ParentThreadKey.GENERAL,
              reference_thread_key: 0,
              reference_activity_timestamp: 9999999999999,
              additional_pages_to_fetch: 0,
              cursor: this.papi.kv.get('cursor-1-95'),
              messaging_tag: null,
              sync_group: SyncGroup.UNKNOWN,
            }),
            queue_name: 'trq',
            task_id: this.papi.socket.taskIds.gen(),
            failure_count: null,
          },
          this.papi.env === 'IG' && this.papi.kv.get('hasTabbedInbox') && {
            label: '313',
            payload: JSON.stringify({
              cursor: this.papi.kv.get('cursor-1-1'),
              filter: ThreadFilter.IGD_PRO_PRIMARY,
              is_after: 0,
              parent_thread_key: ParentThreadKey.GENERAL,
              reference_activity_timestamp: INT64_MAX_AS_STRING,
              reference_thread_key: INT64_MAX_AS_STRING,
              secondary_filter: 0,
              filter_value: '',
              sync_group: SyncGroup.MAIN,
            }),
            queue_name: 'trq',
            task_id: this.papi.socket.taskIds.gen(),
            failure_count: null,
          },
        ], publishTaskOpts)
      }
      if (this.papi.kv.get('hasTabbedInbox')) {
        return Promise.all([
          ThreadFilter.IGD_PRO_PRIMARY,
          ThreadFilter.IGD_PRO_GENERAL,
        ].map(async filter => {
          const sg1Primary = this.getSyncGroupThreadsRange(SyncGroup.MAIN, ParentThreadKey.PRIMARY)

          return this.papi.socket.publishTask(RequestResolverType.FETCH_MORE_INBOX_THREADS, [
            {
              label: '313',
              payload: JSON.stringify({
                cursor: this.papi.kv.get('cursor-1-1'),
                filter,
                is_after: 0,
                parent_thread_key: 0,
                reference_activity_timestamp: sg1Primary.minLastActivityTimestampMs,
                reference_thread_key: sg1Primary.minThreadKey,
                secondary_filter: 0,
                filter_value: '',
                sync_group: SyncGroup.MAIN,
              }),
              queue_name: 'trq',
              task_id: this.papi.socket.taskIds.gen(),
              failure_count: null,
            },
          ], publishTaskOpts)
        }))
      }
      // if (
      //   (this.papi.env === 'IG' && this.papi.kv.get('hasTabbedInbox'))
      //   // || this.papi.env === 'MESSENGER'
      //   // || this.papi.env === 'FB'
      // ) {
      //   await this.fetchMoreInboxThreads(ThreadFilter.PRIMARY)
      //   await this.fetchMoreInboxThreads(ThreadFilter.GENERAL)
      //   return
      // }
      const sg1Primary = this.getSyncGroupThreadsRange(SyncGroup.MAIN, ParentThreadKey.PRIMARY)
      const sg95Primary = this.getSyncGroupThreadsRange(SyncGroup.UNKNOWN, ParentThreadKey.PRIMARY) || sg1Primary
      return this.papi.socket.publishTask(RequestResolverType.FETCH_MORE_THREADS, [
        {
          label: '145',
          payload: JSON.stringify({
            is_after: 0,
            parent_thread_key: ParentThreadKey.PRIMARY,
            reference_thread_key: sg1Primary.minThreadKey,
            reference_activity_timestamp: Number(sg1Primary.minLastActivityTimestampMs),
            additional_pages_to_fetch: 0,
            cursor: this.papi.kv.get('cursor-1-1'),
            messaging_tag: null,
            sync_group: SyncGroup.MAIN,
          }),
          queue_name: 'trq',
          task_id: this.papi.socket.taskIds.gen(),
          failure_count: null,
        },
        {
          label: '145',
          payload: JSON.stringify({
            is_after: 0,
            parent_thread_key: ParentThreadKey.PRIMARY,
            reference_thread_key: sg95Primary.minThreadKey,
            reference_activity_timestamp: Number(sg95Primary.minLastActivityTimestampMs),
            additional_pages_to_fetch: 0,
            cursor: null,
            messaging_tag: null,
            sync_group: SyncGroup.UNKNOWN,
          }),
          queue_name: 'trq',
          task_id: this.papi.socket.taskIds.gen(),
          failure_count: null,
        },
      ], publishTaskOpts)
    }

    try {
      await getFetcher()
    } catch (err) {
      this.logger.error(err)
    }
    return { fetched: true } as const
  }

  async getOrRequestContactsIfNotExist(contactIds: string[]) {
    this.logger.debug(`getOrFetchContactsIfNotExist called with ${contactIds.length} contacts`, contactIds)
    if (contactIds.length === 0) return { contacts: [], missing: [] }

    const contacts = await this.papi.db.query.contacts.findMany({
      columns: {
        id: true,
        profilePictureUrl: true,
        name: true,
        username: true,
        contact: true,
      },
      where: inArray(schema.contacts.id, contactIds),
    })

    if (contacts.length === contactIds.length) return { contacts, missing: [] }

    const loadedContactIds = new Set(contacts.map(c => c.id))
    const missing = contactIds.filter(id => !loadedContactIds.has(id))
    await this.requestContacts(missing)

    return { contacts, missing }
  }

  private async uploadFile(threadID: string, filePath: string, fileName?: string) {
    const {
      domain,
      initialURL,
    } = this.papi.envOpts
    const file = await fs.readFile(filePath)
    const formData = new FormData()
    formData.append('farr', file, { filename: fileName })
    const res = await this.httpRequest(`https://${domain}/ajax/mercury/upload.php?` + new URLSearchParams({
      __a: '1',
      fb_dtsg: this.papi.kv.get('fb_dtsg'),
    }).toString(), {
      method: 'POST',
      body: formData,
      // todo: refactor headers
      headers: {
        authority: domain,
        accept: '*/*',
        'accept-language': 'en',
        origin: `https://${domain}`,
        referer: `${initialURL}t/${threadID}/`,
        'sec-ch-ua': '"Not.A/Brand";v="8", "Chromium";v="114", "Google Chrome";v="114"',
        'sec-ch-ua-full-version-list': '"Not.A/Brand";v="8.0.0.0", "Chromium";v="114.0.5735.198", "Google Chrome";v="114.0.5735.198"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua-platform-version': '"13.4.1"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'viewport-width': '1280',
        'x-asbd-id': '129477',
        'x-fb-lsd': this.papi.kv.get('lsd'),
      },
    })

    const response = res.body
    const jsonStartIndex = response.indexOf('{')
    const jsonResponse = response.substring(jsonStartIndex)
    return JSON.parse(jsonResponse)
  }

  async sendMedia(threadID: string, opts: MessageSendOptions, {
    filePath,
    fileName,
  }: { filePath: string, fileName: string }) {
    this.logger.debug('sendMedia about to call uploadFile')
    const res = await this.uploadFile(threadID, filePath, fileName)
    const metadata = res.payload.metadata[0] as {
      image_id?: string
      video_id?: string
      gif_id?: string
    }
    this.logger.debug('sendMedia', res, metadata)
    return this.sendMessage(threadID, {}, opts, [metadata.image_id || metadata.video_id || metadata.gif_id])
  }

  async webPushRegister(endpoint: string, p256dh: string, auth: string) {
    if (this.papi.env !== 'IG') throw new Error('webPushRegister is only supported on IG')
    const { domain } = EnvOptions.IG
    const formData = new URLSearchParams()
    formData.set('device_token', endpoint)
    formData.set('device_type', 'web_vapid')
    formData.set('mid', crypto.randomUUID()) // should be something that looks like "ZNboAAAEAAGBNvdmibKpso5huLi9"
    formData.set('subscription_keys', JSON.stringify({
      auth,
      p256dh,
    }))
    const { json } = await this.httpJSONRequest(`https://${domain}/api/v1/web/push/register/`, {
      method: 'POST',
      body: formData.toString(),
      // todo: refactor headers
      headers: {
        accept: '*/*',
        ...SHARED_HEADERS,
        'content-type': 'application/x-www-form-urlencoded',
        'x-asbd-id': '129477',
        'x-csrftoken': this.getCSRFToken(),
        'x-ig-app-id': this.papi.kv.get('appId'),
        'x-ig-www-claim': this.papi.kv.get('wwwClaim') ?? '0',
        'x-requested-with': 'XMLHttpRequest',
        Referer: `https://${this.papi.envOpts.domain}/`,
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
    })
    if (json.status !== 'ok') {
      throw new Error(`webPushRegister failed: ${JSON.stringify(json, null, 2)}`)
    }
  }

  async queryThreads(threadIdsOrWhere: string[] | QueryWhereSpecial | QueryThreadsArgs['where'], extraArgs: Partial<Pick<QueryThreadsArgs, 'orderBy' | 'limit'>> = {}) {
    let orderBy: QueryThreadsArgs['orderBy']
    let limit: number
    let where: QueryThreadsArgs['where']
    if (threadIdsOrWhere === QueryWhereSpecial.ALL) {
      // where = eq(threadsSchema.threadKey, threadKey)
    } else if (
      threadIdsOrWhere === QueryWhereSpecial.NEWEST
      || threadIdsOrWhere === QueryWhereSpecial.OLDEST
    ) {
      limit = 1
      const order = threadIdsOrWhere === QueryWhereSpecial.NEWEST ? desc : asc
      orderBy = order(schema.threads.lastActivityTimestampMs)
    } else if (Array.isArray(threadIdsOrWhere)) {
      where = inArray(threadsSchema.threadKey, threadIdsOrWhere)
      if (threadIdsOrWhere.length === 1) limit = 1
    } else {
      where = threadIdsOrWhere
    }

    const args = {
      where,
      ...extraArgs,
    }

    if (limit) args.limit = limit
    if (orderBy) args.orderBy = orderBy

    const threads = (await queryThreads(this.papi.db, args)).map(t => mapThread(t, this.papi.env, this.papi.kv.get('fbid'), parseMessageRanges(t.ranges)))

    const participantIDs = threads.flatMap(t => t.participants.items.map(p => p.id))
    await this.getOrRequestContactsIfNotExist(participantIDs)
    return threads
  }

  async queryMessages(threadKey: string, messageIdsOrWhere: string[] | QueryWhereSpecial | QueryMessagesArgs['where'], extraArgs: Partial<Pick<QueryMessagesArgs, 'orderBy' | 'limit'>> = {}) {
    let orderBy: QueryMessagesArgs['orderBy']
    let limit: number
    let where: QueryMessagesArgs['where']
    if (messageIdsOrWhere === QueryWhereSpecial.ALL) {
      where = eq(messagesSchema.threadKey, threadKey)
    } else if (
      messageIdsOrWhere === QueryWhereSpecial.NEWEST
      || messageIdsOrWhere === QueryWhereSpecial.OLDEST
    ) {
      where = eq(messagesSchema.threadKey, threadKey)
      limit = 1
      const order = messageIdsOrWhere === QueryWhereSpecial.NEWEST ? desc : asc
      orderBy = order(schema.messages.timestampMs)
    } else if (Array.isArray(messageIdsOrWhere)) {
      where = inArray(messagesSchema.messageId, messageIdsOrWhere)
      if (messageIdsOrWhere.length === 1) limit = 1
    } else {
      where = messageIdsOrWhere
    }

    const args = {
      where,
      ...extraArgs,
    }

    if (limit) args.limit = limit
    if (orderBy) args.orderBy = orderBy

    return mapMessages(await queryMessages(this.papi.db, args), this.papi.env, this.papi.kv.get('fbid'))
  }

  async getMessageRanges(threadKey: string, _ranges?: string) {
    const thread = _ranges ? { ranges: _ranges } : await this.papi.db.query.threads.findFirst({
      where: eq(schema.threads.threadKey, threadKey),
      columns: { ranges: true },
    })
    if (!thread?.ranges) return
    return parseMessageRanges(thread.ranges)
  }

  async setMessageRanges(r: IGMessageRanges) {
    const ranges = {
      ...await this.getMessageRanges(r.threadKey!),
      ...r,
    }

    this.papi.db.update(schema.threads).set({
      ranges: JSON.stringify(ranges),
    }).where(eq(schema.threads.threadKey, r.threadKey)).run()
  }

  async resolveMessageRanges(r: IGMessageRanges) {
    const resolverKey = `messageRanges-${r.threadKey}` as const
    const promiseEntries = this.messageRangesResolver.get(resolverKey) || []
    promiseEntries.forEach(p => {
      p.resolve(r)
    })
  }

  async upsertAttachment(a: IGAttachment) {
    const {
      threadKey,
      messageId,
      attachmentFbid,
      timestampMs,
      offlineAttachmentId,
      ...attachment
    } = a

    const current = await this.papi.db.query.attachments.findFirst({
      columns: {
        attachment: true,
      },
      where: and(
        eq(schema.attachments.threadKey, threadKey),
        eq(schema.attachments.messageId, messageId),
        eq(schema.attachments.attachmentFbid, attachmentFbid),
      ),
    })

    const aMapped = {
      threadKey,
      messageId,
      attachmentFbid,
      timestampMs: new Date(timestampMs),
      offlineAttachmentId,
      attachment: JSON.stringify({
        ...(current?.attachment ? JSON.parse(current.attachment) : {}),
        ...attachment,
      }),
    }

    this.papi.db.insert(schema.attachments).values(aMapped).onConflictDoUpdate({
      target: [schema.attachments.threadKey, schema.attachments.messageId, schema.attachments.attachmentFbid],
      set: { ...aMapped },
    }).run()

    return aMapped
  }

  upsertMessage(m: IGMessage) {
    const {
      threadKey,
      messageId,
      offlineThreadingId,
      timestampMs,
      senderId,
      primarySortKey,
      ...message
    } = m
    const _m = {
      threadKey,
      messageId,
      offlineThreadingId,
      primarySortKey,
      timestampMs: new Date(timestampMs),
      senderId,
      message: JSON.stringify(message),
    }

    this.papi.db.insert(schema.messages).values(_m).onConflictDoUpdate({
      target: schema.messages.messageId,
      set: { ..._m },
    }).run()

    return m
  }

  removeThread(remove_type: ThreadRemoveType, thread_key: string, sync_group: SyncGroup) {
    if (remove_type === ThreadRemoveType.ARCHIVE && !this.papi.envOpts.supportsArchive) throw new Error('removeThread is not supported in this environment')
    return this.papi.socket.publishTask(
      remove_type === ThreadRemoveType.ARCHIVE ? RequestResolverType.ARCHIVE_THREAD : RequestResolverType.DELETE_THREAD,
      [{
        label: '146',
        payload: JSON.stringify({
          thread_key,
          remove_type,
          sync_group,
        }),
        queue_name: thread_key.toString(),
        task_id: this.papi.socket.taskIds.gen(),
        failure_count: null,
      }],
    )
  }

  async requestThread(threadKey: string) {
    return this.papi.socket.publishTask(RequestResolverType.GET_NEW_THREAD, [{
      label: '209',
      payload: JSON.stringify({
        thread_fbid: threadKey,
        force_upsert: 0,
        use_open_messenger_transport: 0,
        sync_group: SyncGroup.MAIN,
        metadata_only: 0,
        preview_only: 0,
      }),
      queue_name: threadKey.toString(),
      task_id: this.papi.socket.taskIds.gen(),
      failure_count: null,
    }])
  }

  async requestContacts(contactIDs: string[]) {
    if (contactIDs.length === 0) return
    return this.papi.socket.publishTask(RequestResolverType.REQUEST_CONTACTS, contactIDs.map(contact_id => ({
      label: '207',
      payload: JSON.stringify({
        contact_id,
      }),
      queue_name: 'cpq_v2',
      task_id: this.papi.socket.taskIds.gen(),
      failure_count: null,
    })))
    // @TODO: code above seems to work for messenger (it was made for ig)
    // but messenger.com uses `/send_additional_contacts`
  }

  async mutateReaction(threadID: string, messageID: string, reaction: string) {
    const message = this.papi.db
      .select({
        threadKey: schema.messages.threadKey,
        messageId: schema.messages.messageId,
        timestampMs: schema.messages.timestampMs,
      })
      .from(schema.messages)
      .limit(1)
      .where(eq(schema.messages.threadKey, threadID))
      .where(eq(schema.messages.messageId, messageID))
      .get()

    // @TODO: check `replaceOptimisticReaction` in response (not parsed atm)
    await this.papi.socket.publishTask(RequestResolverType.ADD_REACTION, [{
      label: '29',
      payload: JSON.stringify({
        thread_key: threadID,
        timestamp_ms: Number(message.timestampMs.getTime()),
        message_id: messageID,
        actor_id: this.papi.kv.get('fbid'),
        reaction,
        reaction_style: null,
        sync_group: SyncGroup.MAIN,
      }),
      queue_name: JSON.stringify([
        'reaction',
        messageID,
      ]),
      task_id: this.papi.socket.taskIds.gen(),
      failure_count: null,
    }])
  }

  async createGroupThread(participants: string[]) {
    const { otid, now } = getTimeValues()
    const thread_id = genClientContext()
    const response = await this.papi.socket.publishTask(RequestResolverType.CREATE_GROUP_THREAD, [{
      label: '130',
      payload: JSON.stringify({
        participants,
        send_payload: {
          thread_id: thread_id.toString(),
          otid: otid.toString(),
          source: 0,
          send_type: 8,
        },
      }),
      queue_name: thread_id.toString(),
      task_id: this.papi.socket.taskIds.gen(),
      failure_count: null,
    }])
    this.logger.debug('create group thread response', response)
    return { now, offlineThreadingId: response?.replaceOptimisticThread?.offlineThreadingId, threadId: response?.replaceOptimisticThread?.threadId }
  }

  async fetchMessages(threadID: string, _ranges?: Awaited<ReturnType<typeof this.getMessageRanges>>) {
    const ranges = _ranges || await this.getMessageRanges(threadID)

    this.logger.debug('fetchMessages', {
      threadID,
      ranges,
    })

    if (!ranges) return

    return this.papi.socket.publishTask(RequestResolverType.FETCH_MESSAGES, [{
      label: '228',
      payload: JSON.stringify({
        thread_key: threadID,
        direction: 0,
        reference_timestamp_ms: Number(ranges.minTimestamp),
        reference_message_id: ranges.minMessageId,
        sync_group: SyncGroup.MAIN,
        cursor: this.papi.kv.get('cursor-1-1'),
      }),
      queue_name: `mrq.${threadID}`,
      task_id: this.papi.socket.taskIds.gen(),
      failure_count: null,
    }])
  }

  async sendMessage(threadID: string, { text }: MessageContent, { quotedMessageID }: MessageSendOptions, attachmentFbids: string[] = []) {
    const { otid, timestamp, now } = getTimeValues()

    const reply_metadata = quotedMessageID && {
      reply_source_id: quotedMessageID,
      reply_source_type: 1,
      reply_type: 0,
    }

    const hasAttachment = attachmentFbids.length > 0

    const result = await this.papi.socket.publishTask(RequestResolverType.SEND_MESSAGE, [
      {
        label: '46',
        payload: JSON.stringify({
          thread_id: threadID,
          otid: otid.toString(),
          source: (2 ** 16) + 1,
          send_type: hasAttachment ? 3 : 1,
          sync_group: SyncGroup.MAIN,
          text: !hasAttachment ? text : null,
          initiating_source: hasAttachment ? undefined : 1,
          skip_url_preview_gen: hasAttachment ? undefined : 0,
          text_has_links: hasAttachment ? undefined : 0,
          reply_metadata,
          attachment_fbids: hasAttachment ? attachmentFbids : undefined,
        }),
        queue_name: threadID.toString(),
        task_id: this.papi.socket.taskIds.gen(),
        failure_count: null,
      },
      {
        label: '21',
        payload: JSON.stringify({
          thread_id: threadID,
          last_read_watermark_ts: Number(timestamp),
          sync_group: SyncGroup.MAIN,
        }),
        queue_name: threadID.toString(),
        task_id: this.papi.socket.taskIds.gen(),
        failure_count: null,
      },
    ])

    return {
      timestamp: new Date(now),
      offlineThreadingId: String(otid),
      messageId: result?.replaceOptimsiticMessage.messageId,
    }
  }

  private fetchMoreThreadsV3Promises = new Map<InboxName, Promise<unknown>>()

  fetchMoreThreadsV3 = async (inbox: InboxName) => {
    if (!(this.papi.env === 'FB' || this.papi.env === 'MESSENGER')) throw new Error('fetchMoreThreadsV3 is only supported with Facebook/Messenger')
    if (this.fetchMoreThreadsV3Promises.has(inbox)) {
      return this.fetchMoreThreadsV3Promises.get(inbox)
    }

    const syncGroups = this.computeSyncGroups(inbox)

    this.logger.debug('fetchMoreThreadsV3', {
      inbox,
      syncGroups,
    })

    const tasks = syncGroups.map(([syncGroup, parentThreadKey]) => {
      const range = this.getSyncGroupThreadsRange(syncGroup, parentThreadKey)
      if (typeof range?.hasMoreBefore === 'boolean' && !range.hasMoreBefore) return
      const parent_thread_key = parentThreadKey
      const reference_thread_key = range?.minThreadKey || 0
      const reference_activity_timestamp = range?.minLastActivityTimestampMs ? range.minLastActivityTimestampMs : 9999999999999
      const cursor = this.papi.kv.get(`cursor-1-${syncGroup}`)
      return {
        label: '145',
        payload: JSON.stringify({
          is_after: 0,
          parent_thread_key,
          reference_thread_key,
          reference_activity_timestamp,
          additional_pages_to_fetch: 0,
          cursor,
          messaging_tag: null,
          sync_group: syncGroup,
        }),
        queue_name: 'trq',
        task_id: this.papi.socket.taskIds.gen(),
        failure_count: null,
      }
    }).filter(Boolean)

    // if there are no more threads to load
    if (tasks.length === 0) return
    const task = this.papi.socket.publishTask(RequestResolverType.FETCH_MORE_THREADS, tasks, {
      timeout: 15000,
      throwOnTimeout: true,
    })
    task.finally(() => this.fetchMoreThreadsV3Promises.delete(inbox))
    this.fetchMoreThreadsV3Promises.set(inbox, task)
    return task
  }

  messageRangesResolver = new Map<`messageRanges-${string}`, {
    promise: Promise<unknown>
    resolve:((r: IGMessageRanges) => void)
    reject: RequestResolverReject
  }[]>()

  waitForMessageRange(threadKey: string) {
    const resolverKey = `messageRanges-${threadKey}` as const

    const p = createPromise()

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('WAIT_FOR_MESSAGE_RANGE_TIMEOUT'))
        // Optionally remove the promise from the array if it times out
        const existingPromises = this.messageRangesResolver.get(resolverKey) || []
        const index = existingPromises.findIndex(entry => entry.promise === p.promise)
        if (index !== -1) {
          existingPromises.splice(index, 1)
        }
      }, 10000)
    })

    const racedPromise = Promise.race([p.promise, timeoutPromise])

    const promiseEntry = {
      promise: racedPromise,
      resolve: p.resolve,
      reject: p.reject,
    }

    if (this.messageRangesResolver.has(resolverKey)) {
      this.messageRangesResolver.get(resolverKey).push(promiseEntry)
    } else {
      this.messageRangesResolver.set(resolverKey, [promiseEntry])
    }

    return racedPromise
  }

  // does not work for moving threads out of the message requests folder
  // prefer this.approveThread
  // since we pretend General and Primary are the same, this method is unused
  // but it is still here for reference
  // async changeThreadFolder(thread_key: string, old_ig_folder: number, new_ig_folder: number) {
  //   await this.socket.publishTask(RequestResolverType.SET_THREAD_FOLDER, [{
  //     label: '511',
  //     payload: JSON.stringify({
  //       thread_key,
  //       old_ig_folder,
  //       new_ig_folder,
  //       sync_group: 1,
  //     }),
  //     queue_name: thread_key,
  //     task_id: this.socket.genTaskId(),
  //     failure_count: null,
  //   }])
  // }

  // async createThread(userId: string) {
  //   const response = await this.api.socket.publishTask(RequestResolverType.CREATE_THREAD, {
  //     label: '209',
  //     payload: JSON.stringify({
  //       // thread_fbid: BigInt(userId),
  //       thread_fbid: userId,
  //     }),
  //     queue_name: userId,
  //     task_id: this.api.socket.genTaskId(),
  //     failure_count: null,
  //   })
  //   this.logger.info('create thread response', response)
  // }
}
