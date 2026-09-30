import { describe, expect, it, vi } from 'vitest';

import { BuildInfo } from '../../../src/discord/build-info';
import { Constants } from '../../../src/discord/constants';
import { Http } from '../../../src/shared/http';

describe('BuildInfo', () => {
	it('ignores a non numeric or non positive build number', () => {
		const before = Constants.Properties.client_build_number;
		BuildInfo.apply(Number.NaN);
		BuildInfo.apply(0);
		BuildInfo.apply(-1);
		expect(Constants.Properties.client_build_number).toBe(before);
	});

	it('patches the desktop fingerprint with a resolved number', () => {
		BuildInfo.apply(424_242);
		expect(Constants.Properties.client_build_number).toBe(424_242);
		expect(BuildInfo.lastKnown).toBe(424_242);
	});

	it('keeps the cached value when running offline', async () => {
		const request = vi.spyOn(Http, 'request');
		try {
			await expect(BuildInfo.resolve({ offline: true })).resolves.toBe(424_242);
			expect(request).not.toHaveBeenCalled();
		} finally {
			request.mockRestore();
		}
	});

	it('returns the cached value when the landing page has no web asset', async () => {
		const text = vi.spyOn(Http, 'text').mockResolvedValue('<html>no assets here</html>' as never);
		try {
			await expect(BuildInfo.resolve()).resolves.toBe(424_242);
		} finally {
			text.mockRestore();
		}
	});

	it('returns the cached value when the lookup fails', async () => {
		const text = vi.spyOn(Http, 'text').mockRejectedValue(new Error('offline'));
		try {
			await expect(BuildInfo.resolve()).resolves.toBe(424_242);
		} finally {
			text.mockRestore();
		}
	});
});
