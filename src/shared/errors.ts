/** Stable errors understood by the application and its summaries. */
export class AppError extends Error {
	constructor(
		readonly code:
			| 'ENROLL_BLOCKED'
			| 'ENROLL_COOLDOWN'
			| 'CAPTCHA_REJECTED'
			| 'UNSUPPORTED_TASK'
			| 'ABORTED'
			| 'GATEWAY_TIMEOUT',
		message: string,
	) {
		super(message);
		this.name = 'AppError';
	}
}
