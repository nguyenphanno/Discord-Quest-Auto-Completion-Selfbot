/**
 * @file Quest domain types.
 *
 * Field names and semantics mirror the current Discord quest resources
 * (https://docs.discord.food/resources/quests). Only config versions that are
 * still served are modelled; unknown fields are simply ignored because the
 * response is consumed through optional chaining.
 */

export type Snowflake = string;

/** `GET /quests/@me` */
export interface AllQuestsResponse {
	/** Quests the current user can participate in. */
	quests: Quest[];
	/** Quests the user cannot participate in, with a reduced payload. */
	excluded_quests: PartialQuest[];
	/** ISO timestamp the user may enroll in quests again, `null` when free. */
	quest_enrollment_blocked_until: string | null;
}

/** A sponsored quest. */
export interface Quest {
	/** The ID of the quest. */
	id: Snowflake;
	/** The configuration and metadata for the quest. */
	config: QuestConfig;
	/** The user's quest progress, `null` until the quest is accepted. */
	user_status: QuestUserStatus | null;
	/** The content areas where the quest can be shown. @deprecated */
	targeted_content?: number | number[];
	/** Whether the quest is unreleased and in preview for Discord employees. */
	preview: boolean;
	/** Sealed traffic metadata used when enrolling or claiming. */
	traffic_metadata_sealed?: string;
	/** Raw traffic metadata used when enrolling or claiming. */
	traffic_metadata_raw?: string;
}

/** Reduced payload used for quests the user cannot participate in. */
export interface PartialQuest {
	/** The ID of the quest. */
	id: Snowflake;
	/** The analogous replacement when the quest is unavailable. */
	replacement_id?: Snowflake | null;
}

/**
 * The quest definition. The structure has multiple distinct versions with
 * different field sets; only the version currently served is modelled.
 */
export interface QuestConfig {
	/** The ID of the quest config. */
	id: Snowflake;
	/** Quest configuration version. */
	config_version: number;
	/** When the quest period starts. */
	starts_at: string;
	/** When the quest period ends. */
	expires_at: string;
	/** The quest features enabled for the quest. */
	features: number | number[];
	/** The application metadata for the quest. */
	application: QuestApplication;
	/** Object that holds the quest's assets. */
	assets: QuestAssets;
	/** The accent colours for the quest. */
	colors: QuestGradient;
	/** Human-readable metadata for the quest. */
	messages: QuestMessages;
	/** The task configuration for the quest. */
	task_config_v2: QuestTaskConfigV2;
	/** Specifies rewards for the quest (e.g. collectibles). */
	rewards_config: QuestRewardsConfig;
	/** The share policy for the quest. */
	share_policy?: string;
	/** The quest call-to-action configuration. */
	cta_config?: QuestCtaConfig;
	/** The configuration for the video quest. */
	video_metadata?: QuestVideoMetadata;
	/** The configuration for the quest co-sponsor. */
	cosponsor_metadata?: QuestCosponsorMetadata;
}

/** The application (game or activity) the quest belongs to. */
export interface QuestApplication {
	/** The ID of the application. */
	id: Snowflake;
	/** The name of the application. */
	name: string;
	/** The link to the game's page. @deprecated Use `cta_config` instead. */
	link?: string;
}

/** An object holding CDN asset names. */
export interface QuestAssets {
	/** The quest's hero image. */
	hero: string;
	/** A video representation of the hero image. */
	hero_video: string | null;
	/** The hero image for the popup shown before accepting the quest. */
	quest_bar_hero: string;
	/** The blurhash of the quest bar hero image. */
	quest_bar_hero_blurhash?: string | null;
	/** A video representation of the quest bar hero image. */
	quest_bar_hero_video: string | null;
	/** The game's icon. */
	game_tile: string;
	/** The game's logo. */
	logotype: string;
}

/** A 2-point gradient with a primary and secondary colour. */
export interface QuestGradient {
	/** The hex-encoded primary colour of the gradient. */
	primary: string;
	/** The hex-encoded secondary colour of the gradient. */
	secondary: string;
}

/** Human-readable metadata for the quest. */
export interface QuestMessages {
	/** The name of the quest. */
	quest_name: string;
	/** The title of the game the quest is for. */
	game_title: string;
	/** The publisher of the game the quest is for. */
	game_publisher: string;
}

/** Every task type Discord can attach to a quest. */
export enum QuestTaskConfigType {
	STREAM_ON_DESKTOP = 'STREAM_ON_DESKTOP',
	PLAY_ON_DESKTOP = 'PLAY_ON_DESKTOP',
	PLAY_ON_DESKTOP_V2 = 'PLAY_ON_DESKTOP_V2',
	PLAY_ON_XBOX = 'PLAY_ON_XBOX',
	PLAY_ON_PLAYSTATION = 'PLAY_ON_PLAYSTATION',
	WATCH_VIDEO = 'WATCH_VIDEO',
	WATCH_VIDEO_ON_MOBILE = 'WATCH_VIDEO_ON_MOBILE',
	PLAY_ACTIVITY = 'PLAY_ACTIVITY',
	ACHIEVEMENT_IN_GAME = 'ACHIEVEMENT_IN_GAME',
	ACHIEVEMENT_IN_ACTIVITY = 'ACHIEVEMENT_IN_ACTIVITY',
}

/**
 * Task configuration, keyed by event name. The map is partial because a quest
 * only ever carries the tasks it actually needs.
 */
export interface QuestTaskConfigV2 {
	/** Tasks required to complete the quest, keyed by their event name. */
	tasks: Partial<Record<QuestTaskConfigType, QuestTask>>;
	/** The eligibility operator used to join multiple tasks (`and` / `or`). */
	join_operator?: string;
	/** A link to the third-party quest task enrollment page. */
	enrollment_url?: string;
	/** The ID of the embedded activity for the third-party task. */
	developer_application_id?: Snowflake;
}

/** A required task inside a quest. */
export interface QuestTask {
	/** The type of task event. */
	event_name: string;
	/** The value the user must reach. */
	target: number;
	/** The type of the task, when present. */
	type?: QuestTaskConfigType;
	/** IDs of the target game on console platforms. */
	external_ids?: string[];
	/** The third-party task title. */
	title?: string;
	/** The third-party task description. */
	description?: string;
}

/** How the rewards of a quest are distributed. */
export interface QuestRewardsConfig {
	/** How the rewards are assigned. */
	assignment_method: number;
	/** The possible rewards, ordered by tier when applicable. */
	rewards: QuestReward[];
	/** When the reward claiming period ends. */
	rewards_expire_at: string | null;
	/** The platforms the rewards can be redeemed on. */
	platforms: number[];
}

/** A single reward attached to a quest. */
export interface QuestReward {
	/** The reward's type. */
	type: number;
	/** The ID of the SKU awarded. */
	sku_id: Snowflake;
	/** The reward's media asset. */
	asset?: string | null;
	/** The reward's video asset. */
	asset_video?: string | null;
	/** Human-readable metadata for the reward. */
	messages: QuestRewardMessages;
	/** An approximate count of how many users can claim the reward. */
	approximate_count?: number | null;
	/** The link used to redeem the reward. */
	redemption_link?: string | null;
	/** When the reward expires. */
	expires_at?: string | null;
	/** When the reward expires for premium users. */
	expires_at_premium?: string | null;
	/** The expiration mode. */
	expiration_mode?: number;
	/** The amount of Discord Orbs awarded. */
	orb_quantity?: number;
	/** The days of fractional premium awarded. */
	quantity?: number;
}

/** Human-readable metadata for a reward. */
export interface QuestRewardMessages {
	/** The reward's name. */
	name: string;
	/** The article variant of the name, e.g. `a Cybernetic Headgear Decoration`. */
	name_with_article: string;
	/** Redemption instructions per platform. */
	reward_redemption_instructions_by_platform?: Record<number, string>;
}

/** The quest call-to-action configuration. */
export interface QuestCtaConfig {
	/** The label rendered on the call-to-action button. */
	cta_label?: string;
	/** The link the call-to-action points at. */
	cta_link?: string;
}

/** Video specific quest configuration. */
export interface QuestVideoMetadata {
	/** Human-readable metadata for the video quest. */
	messages: QuestVideoMessages;
	/** Object that holds the quest's video assets. */
	assets: QuestVideoAssets;
}

/** Video assets used by the quest player. */
export interface QuestVideoAssets {
	/** The HLS video asset for the video player. */
	video_player_video_hls: string | null;
	/** The video asset for the video player. */
	video_player_video: string;
	/** The thumbnail asset for the video player. */
	video_player_thumbnail: string | null;
	/** The low-resolution video asset for the video player. */
	video_player_video_low_res: string;
	/** The caption asset for the video player. */
	video_player_caption: string;
	/** The transcript asset for the video player. */
	video_player_transcript: string;
	/** The video asset for the quest bar preview. */
	quest_bar_preview_video: string | null;
	/** The thumbnail asset for the quest bar preview. */
	quest_bar_preview_thumbnail: string | null;
	/** The video asset for the quest home page. */
	quest_home_video: string | null;
}

/** Human-readable metadata for a video quest. */
export interface QuestVideoMessages {
	/** The title of the video. */
	video_title: string;
	/** The title of the call-to-action at the end of the video. */
	video_end_cta_title: string;
	/** The subtitle of the call-to-action at the end of the video. */
	video_end_cta_subtitle: string;
	/** The label of the call-to-action button at the end of the video. */
	video_end_cta_button_label: string;
}

/** Metadata for a quest co-sponsor. */
export interface QuestCosponsorMetadata {
	/** The name of the co-sponsor. */
	name: string;
	/** The co-sponsor's logo asset. */
	logotype: string;
	/** The co-sponsor's redemption instructions. */
	redemption_instructions: string;
}

/** The current user's progress on a quest. */
export interface QuestUserStatus {
	/** The ID of the user. */
	user_id: Snowflake;
	/** The ID of the quest. */
	quest_id?: Snowflake;
	/** When the user accepted the quest. */
	enrolled_at: string | null;
	/** When the user completed the quest. */
	completed_at: string | null;
	/** When the user claimed the quest's reward. */
	claimed_at: string | null;
	/** Which reward tier was claimed, for `TIERED` assignment methods. */
	claimed_tier?: number | null;
	/** When the last heartbeat was received. */
	last_stream_heartbeat_at?: string | null;
	/** Seconds the user has streamed the game since accepting the quest. */
	stream_progress_seconds?: string;
	/** The content areas the user dismissed for the quest. */
	dismissed_quest_content?: number;
	/** The user's progress for each task, keyed by event name. */
	progress?: Record<string, QuestTaskProgress>;
}

/** Progress of a single task. */
export interface QuestTaskProgress {
	/** The type of task event. */
	event_name: string;
	/** The current task value. */
	value: number;
	/** When the task was last updated. */
	updated_at: string;
	/** When the task was completed. */
	completed_at: string | null;
	/** The task's heartbeat data. */
	heartbeat?: QuestTaskHeartbeat | null;
}

/** Heartbeat bookkeeping attached to a long running task. */
export interface QuestTaskHeartbeat {
	/** When the last heartbeat was received. */
	last_beat_at: string;
	/** When the task progress expires. */
	expires_at: string | null;
}

/** `GET /quests/{id}/claim-reward-code` result. */
export interface ClaimedQuest {
	/** The ID of the user that claimed. */
	user_id: Snowflake;
	/** The ID of the quest. */
	quest_id: Snowflake;
	/** When the reward code was claimed. */
	claimed_at: string;
	/** The reward code details when one was issued. */
	reward_code?: QuestRewardCode | null;
}

/** A redeemable code issued by a quest reward. */
export interface QuestRewardCode {
	/** The code to redeem. */
	code: string;
	/** The SKU the code belongs to. */
	sku_id: Snowflake;
}

/** Machine readable hint returned when a console quest cannot be started. */
export interface QuestErrorHint {
	/** The kind of error. */
	type: string;
	/** The human readable error message. */
	message: string;
	/** The ID of the linked connection. */
	connected_account_id: Snowflake;
	/** The type of the linked connection, e.g. `xbox`. */
	connected_account_type: string;
}

/** Captcha challenge payload attached to a rejected request. */
export interface CaptchaDataFromRequest {
	captcha_key: string[];
	captcha_sitekey: string;
	captcha_service: 'hcaptcha';
	captcha_session_id: string;
	captcha_rqdata: string;
	captcha_rqtoken: string;
}

/** `POST /applications/{id}/proxy-tickets` */
export interface ProxyTicket {
	ticket: string;
	expires_at: string;
	application_id: Snowflake;
	user_id: Snowflake;
}

/** An entry of `GET /oauth2/tokens`. */
export interface OAuth2TokenInfo {
	/** The ID of the token. */
	id: Snowflake;
	/** The scopes granted to the application. */
	scopes: string[];
	/** The application the token belongs to. */
	application: { id: Snowflake; name?: string };
	/** The disclosures the user accepted. */
	disclosures: number[];
}

/** Trimmed shape of `GET /applications/public`. */
export interface PublicApplication {
	id: Snowflake;
	name: string;
	icon: string;
	description: string;
	executables: Array<{ os: string; name: string; is_launcher: boolean }>;
}

/** Terminal state of a quest worker, used by the run summary. */
export type QuestOutcome = 'completed' | 'already-complete' | 'failed' | 'skipped';

/** Result of processing a single quest. */
export interface QuestRunResult {
	questId: Snowflake;
	questName: string;
	task: QuestTaskConfigType | 'UNKNOWN';
	outcome: QuestOutcome;
	detail: string;
	errorCode?: string;
}


