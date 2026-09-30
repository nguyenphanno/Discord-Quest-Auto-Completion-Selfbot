/**
 * @file Captcha provider registry.
 *
 * Keeps the vendor list in one place so the configuration layer can discover
 * which API keys exist, and so a provider can be selected either explicitly
 * (`CAPTCHA_PROVIDER`) or by auto-detection over a documented priority order.
 */

import type { CaptchaProvider, CaptchaProviderOptions } from './provider';
import { ManualCaptchaProvider } from './manual';
import { createAntiCaptchaProvider } from './anti-captcha';
import { createCapMonsterProvider } from './cap-monster';
import { createCapSolverProvider } from './cap-solver';
import { createTwoCaptchaProvider } from './two-captcha';
import { createYesCaptchaProvider } from './yes-captcha';

/** API keys keyed by their environment variable name. */
export type ProviderCredentials = Record<string, string | null | undefined>;

export interface ProviderDescriptor {
	/** Stable identifier used in `CAPTCHA_PROVIDER`. */
	id: string;
	/** Human readable name. */
	label: string;
	/** Environment variable holding the API key, `null` when none is needed. */
	credentialEnv: string | null;
	/** Lower comes first during auto-detection. */
	priority: number;
	/** Short note for logs and documentation. */
	note: string;
	/** Builds the provider for the supplied credentials. */
	create(credentials: ProviderCredentials, options: CaptchaProviderOptions): CaptchaProvider;
}

export interface ProviderResolution {
	/** The selected provider, or `null` when none is usable. */
	provider: CaptchaProvider | null;
	/** Why no provider was selected, when `provider` is `null`. */
	reason: string | null;
	/** Whether auto-detection matched a credential. */
	detected: boolean;
}

export interface ResolveOptions {
	/** Explicit provider id from `CAPTCHA_PROVIDER`. */
	providerId?: string | null;
	/** API keys keyed by environment variable name. */
	credentials?: ProviderCredentials;
	/** Tuning forwarded to the provider. */
	settings?: CaptchaProviderOptions;
	/** Allow the interactive stdin provider. */
	allowManual?: boolean;
}

/** Credential based vendors, best first for Discord's short-lived hCaptcha. */
const CREDENTIAL_DESCRIPTORS: readonly ProviderDescriptor[] = [
	{
		id: 'capsolver',
		label: 'CapSolver',
		credentialEnv: 'CAPSOLVER_API_KEY',
		priority: 10,
		note: 'fast, returns the user agent to replay',
		create: (credentials, options) =>
			createCapSolverProvider(credentials.CAPSOLVER_API_KEY ?? '', options),
	},
	{
		id: 'capmonster',
		label: 'CapMonster Cloud',
		credentialEnv: 'CAPMONSTER_API_KEY',
		priority: 20,
		note: 'fast in-house models',
		create: (credentials, options) =>
			createCapMonsterProvider(credentials.CAPMONSTER_API_KEY ?? '', options),
	},
	{
		id: 'anti-captcha',
		label: 'Anti-Captcha',
		credentialEnv: 'ANTI_CAPTCHA_API_KEY',
		priority: 30,
		note: 'mature service, broad task catalogue',
		create: (credentials, options) =>
			createAntiCaptchaProvider(credentials.ANTI_CAPTCHA_API_KEY ?? '', options),
	},
	{
		id: '2captcha',
		label: '2Captcha',
		credentialEnv: 'TWOCAPTCHA_API_KEY',
		priority: 40,
		note: 'classic in.php / res.php API',
		create: (credentials, options) =>
			createTwoCaptchaProvider(credentials.TWOCAPTCHA_API_KEY ?? '', options),
	},
	{
		id: 'yescaptcha',
		label: 'YesCaptcha',
		credentialEnv: 'YES_CAPTCHA_API_KEY',
		priority: 50,
		note: 'cheapest, but Discord often rejects it with error 10008',
		create: (credentials, options) =>
			createYesCaptchaProvider(credentials.YES_CAPTCHA_API_KEY ?? '', options),
	},
];

/** Credential free, opt-in provider. */
const MANUAL_DESCRIPTOR: ProviderDescriptor = {
	id: 'manual',
	label: 'Manual prompt',
	credentialEnv: null,
	priority: 999,
	note: 'asks for the token on stdin; interactive terminals only',
	create: (_credentials, options) => new ManualCaptchaProvider(options.timeoutMs),
};

export class CaptchaProviderRegistry extends null {
	static readonly descriptors: readonly ProviderDescriptor[] = [
		...CREDENTIAL_DESCRIPTORS,
		MANUAL_DESCRIPTOR,
	];

	/** Provider ids accepted by `CAPTCHA_PROVIDER`, in priority order. */
	static ids(): string[] {
		return CaptchaProviderRegistry.descriptors.map((descriptor) => descriptor.id);
	}

	/** Environment variables that can activate a provider. */
	static credentialEnvNames(): string[] {
		return CREDENTIAL_DESCRIPTORS.map((descriptor) => descriptor.credentialEnv).filter(
			(name): name is string => name !== null,
		);
	}

	static find(id: string): ProviderDescriptor | null {
		const normalised = id.trim().toLowerCase();
		return (
			CaptchaProviderRegistry.descriptors.find(
				(descriptor) =>
					descriptor.id === normalised ||
					descriptor.label.toLowerCase() === normalised,
			) ?? null
		);
	}

	/** Ids that currently have a credential in the environment. */
	static configuredIds(credentials: ProviderCredentials = {}): string[] {
		return CREDENTIAL_DESCRIPTORS.filter(
			(descriptor) =>
				descriptor.credentialEnv !== null && Boolean(credentials[descriptor.credentialEnv]),
		).map((descriptor) => descriptor.id);
	}

	/** Rows describing every provider, for the preflight block. */
	static describeAll(credentials: ProviderCredentials = {}): Array<[string, string]> {
		return CaptchaProviderRegistry.descriptors.map((descriptor) => {
			let state: string;
			if (descriptor.credentialEnv === null) {
				state = 'opt-in';
			} else if (credentials[descriptor.credentialEnv]) {
				state = 'configured';
			} else {
				state = `needs ${descriptor.credentialEnv}`;
			}
			return [descriptor.id, `${descriptor.label} - ${state}`];
		});
	}

	/**
	 * Picks the descriptor that would be used:
	 *  1. an explicit `CAPTCHA_PROVIDER` id always wins,
	 *  2. otherwise the first credential found in priority order,
	 *  3. otherwise the manual provider when it is allowed and usable.
	 */
	static select(options: ResolveOptions = {}): {
		descriptor: ProviderDescriptor | null;
		detected: boolean;
		reason: string | null;
	} {
		const credentials = options.credentials ?? {};
		const requested = options.providerId?.trim();

		if (requested) {
			const descriptor = CaptchaProviderRegistry.find(requested);
			if (!descriptor) {
				return {
					descriptor: null,
					detected: false,
					reason: `Unknown captcha provider "${requested}". Known providers: ${CaptchaProviderRegistry.ids().join(', ')}.`,
				};
			}
			if (descriptor.credentialEnv && !credentials[descriptor.credentialEnv]) {
				return {
					descriptor: null,
					detected: false,
					reason: `CAPTCHA_PROVIDER="${descriptor.id}" needs ${descriptor.credentialEnv} to be set.`,
				};
			}
			return { descriptor, detected: true, reason: null };
		}

		const auto = [...CREDENTIAL_DESCRIPTORS]
			.sort((left, right) => left.priority - right.priority)
			.find(
				(descriptor) =>
					descriptor.credentialEnv !== null &&
					Boolean(credentials[descriptor.credentialEnv]),
			);
		if (auto) {
			return { descriptor: auto, detected: true, reason: null };
		}

		if (options.allowManual && ManualCaptchaProvider.available) {
			return { descriptor: MANUAL_DESCRIPTOR, detected: false, reason: null };
		}

		return {
			descriptor: null,
			detected: false,
			reason:
				'No captcha provider is configured. Set one of ' +
				`${CaptchaProviderRegistry.credentialEnvNames().join(', ')}, ` +
				'or CAPTCHA_MANUAL=true for an interactive prompt.',
		};
	}

	/** Instantiates the provider selected for the supplied options. */
	static resolve(options: ResolveOptions = {}): ProviderResolution {
		const selection = CaptchaProviderRegistry.select(options);
		if (!selection.descriptor) {
			return { provider: null, detected: false, reason: selection.reason };
		}
		return {
			provider: selection.descriptor.create(
				options.credentials ?? {},
				options.settings ?? {},
			),
			detected: selection.detected,
			reason: null,
		};
	}

	/** Human readable label of the active provider, for the preflight block. */
	static labelFor(options: ResolveOptions = {}): string {
		const selection = CaptchaProviderRegistry.select(options);
		if (!selection.descriptor) {
			return 'disabled';
		}
		const auto = selection.detected && !options.providerId?.trim();
		return auto ? `${selection.descriptor.label} (auto)` : selection.descriptor.label;
	}
}


