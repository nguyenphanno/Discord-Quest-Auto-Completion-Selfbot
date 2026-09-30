/**
 * @file Idempotent gateway IDENTIFY patch for user-account sessions.
 */

import { WebSocketShard } from '@discordjs/ws';
import { GatewayOpcodes } from 'discord-api-types/v10';
import type { GatewayIdentifyData, GatewaySendPayload } from 'discord-api-types/v10';
import { Constants } from './constants';

let installed = false;
const originalShardSend = WebSocketShard.prototype.send;

export function identifyPatchInstalled(): boolean {
	return installed;
}

/** Rewrites IDENTIFY so the gateway sees a desktop client. Safe to call twice. */
export function installIdentifyPatch(): void {
	if (installed) {
		return;
	}
	installed = true;
	WebSocketShard.prototype.send = async function (payload: GatewaySendPayload) {
		if (payload.op === GatewayOpcodes.Identify) {
			payload.d = {
				token: payload.d.token,
				properties: {
					...Constants.Properties,
					is_fast_connect: false,
					gateway_connect_reasons: 'AppSkeleton',
				},
				capabilities: 0,
				presence: payload.d.presence,
				compress: payload.d.compress,
				client_state: {
					guild_versions: {},
				},
			} as unknown as GatewayIdentifyData;
		}
		return originalShardSend.call(this, payload);
	};
}
