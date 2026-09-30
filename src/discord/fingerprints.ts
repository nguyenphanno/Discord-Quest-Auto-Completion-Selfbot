/**
 * @file Frozen desktop / Android protocol fingerprints.
 *
 * These objects replicate the handshake of the official clients. Discord uses
 * them to decide whether a caller looks like a real client, so the values are
 * deliberate copies and must not be "improved" casually: re-capture a fresh
 * handshake from the live desktop and Android builds before editing anything
 * here.
 *
 * `client_build_number` is the single field patched at runtime by `BuildInfo`;
 * everything else stays as captured. `Constants` re-exports these objects so
 * the rest of the application keeps one import path.
 */

import { randomUUID } from 'node:crypto';

/** User agent advertised by the desktop client. */
export const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9236 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36';

/** Desktop super-properties, sent as `x-super-properties` and in IDENTIFY. */
export const DesktopFingerprint = {
	os: 'Windows',
	browser: 'Discord Client',
	release_channel: 'stable',
	client_version: '1.0.9236',
	os_version: '10.0.19045',
	os_arch: 'x64',
	app_arch: 'x64',
	system_locale: 'en-US',
	has_client_mods: false,
	client_launch_id: randomUUID(),
	browser_user_agent: USER_AGENT,
	browser_version: '37.6.0',
	os_sdk_version: '19045',
	client_build_number: 539951,
	native_build_number: 81687,
	client_event_source: null,
	launch_signature: randomUUID(),
	client_heartbeat_session_id: randomUUID(),
	client_app_state: 'focused',
};

/** User agent advertised by the Android client. */
export const ANDROID_USER_AGENT = 'Discord-Android/316011;RNA';

/** Android super-properties, used by the mobile video flow. */
export const AndroidFingerprint = {
	os: 'Android',
	browser: 'Discord Android',
	device: 'b0q',
	system_locale: 'en-US',
	has_client_mods: false,
	client_version: '316.11 - rn',
	release_channel: 'googleRelease',
	device_vendor_id: randomUUID(),
	design_id: 2,
	browser_user_agent: '',
	browser_version: '',
	os_version: '28',
	client_build_number: 5169,
	client_event_source: null,
	client_launch_id: randomUUID(),
	launch_signature: '1771754995045142953',
	client_app_state: 'active',
	client_heartbeat_session_id: randomUUID(),
};

/**
 * Cipher list for reward claiming. Discord rejects the default Node cipher
 * order on that route, so the desktop client's ordering is replayed.
 */
export const TLS_CIPHERS = [
	'TLS_AES_128_GCM_SHA256',
	'TLS_AES_256_GCM_SHA384',
	'TLS_CHACHA20_POLY1305_SHA256',
	'ECDHE-ECDSA-AES128-GCM-SHA256',
	'ECDHE-RSA-AES128-GCM-SHA256',
	'ECDHE-ECDSA-AES256-GCM-SHA384',
	'ECDHE-RSA-AES256-GCM-SHA384',
	'ECDHE-ECDSA-CHACHA20-POLY1305',
	'ECDHE-RSA-CHACHA20-POLY1305',
	'ECDHE-RSA-AES128-SHA',
	'ECDHE-RSA-AES256-SHA',
	'AES128-GCM-SHA256',
	'AES256-GCM-SHA384',
	'AES128-SHA',
	'AES256-SHA',
].join(':');
