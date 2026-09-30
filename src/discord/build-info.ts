/**
 * @file Resolves the current Discord client build number.
 *
 * Discord rejects requests that advertise a stale `client_build_number`, so the
 * live web bundle is scraped once per run and the newest number is patched into
 * the desktop fingerprint. Failures are non-fatal: the previously known value
 * is kept and a warning is logged.
 */

import { Constants } from './constants';
import { Http } from '../shared/http';
import { Logger } from '../ui/logger';

export interface BuildInfoOptions {
	/** Skip the network round trip and use the cached value. */
	offline?: boolean;
	/** Request timeout for each asset. */
	timeoutMs?: number;
}

export class BuildInfo extends null {
	private static readonly log = new Logger('build');
	private static cached: number | null = null;

	/** Last successfully resolved build number, if any. */
	static get lastKnown(): number | null {
		return BuildInfo.cached;
	}

	/**
	 * Scrapes `discord.com/app` for the current build number.
	 * @returns the build number, or `null` when it could not be determined.
	 */
	static async resolve(options: BuildInfoOptions = {}): Promise<number | null> {
		if (options.offline) {
			BuildInfo.log.debug('Skipping build number lookup (offline mode)');
			return BuildInfo.cached;
		}

		const log = BuildInfo.log;
		const headers = { 'User-Agent': Constants.USER_AGENT };
		const requestOptions = {
			timeoutMs: options.timeoutMs ?? 15_000,
			retries: 1,
			scope: 'build',
			quiet: true,
		};

		try {
			log.debug('Fetching https://discord.com/app');
			const html = await Http.text(
				Constants.ORIGIN + '/app',
				{ headers },
				{ ...requestOptions, label: 'GET discord.com/app' },
			);

			const assets = Array.from(html.match(Constants.Tuning.webAssetPattern) ?? []);
			if (assets.length === 0) {
				log.warn('No web assets found in the Discord landing page');
				return BuildInfo.cached;
			}

			for (const assetPath of assets) {
				try {
					const script = await Http.text(
						Constants.ORIGIN + assetPath,
						{ headers },
						{ ...requestOptions, label: `GET ${assetPath}` },
					);
					const match = script.match(Constants.Tuning.buildNumberPattern);
					const digits = match?.[1];
					if (!digits) {
						continue;
					}
					const buildNumber = Number.parseInt(digits, 10);
					BuildInfo.apply(buildNumber);
					return buildNumber;
				} catch (error) {
					log.debug(
						`Asset ${assetPath} could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}

			log.warn('Build number not found in any web asset; keeping the bundled value');
			return BuildInfo.cached;
		} catch (error) {
			log.warn(
				`Unable to resolve the latest build number: ${error instanceof Error ? error.message : String(error)}`,
			);
			return BuildInfo.cached;
		}
	}

	/** Applies an explicit build number (config override or scraped value). */
	static apply(buildNumber: number): void {
		if (!Number.isFinite(buildNumber) || buildNumber <= 0) {
			return;
		}
		if (BuildInfo.cached === buildNumber) {
			return;
		}
		BuildInfo.cached = buildNumber;
		Constants.Properties.client_build_number = buildNumber;
		BuildInfo.log.debug(`client_build_number = ${buildNumber}`);
	}
}
