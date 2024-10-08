// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { AmplifyClassV6, StorageAccessLevel } from '@aws-amplify/core';

import { assertValidationError } from '../../../errors/utils/assertValidationError';
import { StorageValidationErrorCode } from '../../../errors/types/validation';
import { resolvePrefix as defaultPrefixResolver } from '../../../utils/resolvePrefix';
import { BucketInfo, ResolvedS3Config, StorageBucket } from '../types/options';

import { DEFAULT_ACCESS_LEVEL, LOCAL_TESTING_S3_ENDPOINT } from './constants';

interface S3ApiOptions {
	accessLevel?: StorageAccessLevel;
	targetIdentityId?: string;
	useAccelerateEndpoint?: boolean;
	bucket?: StorageBucket;
}

interface ResolvedS3ConfigAndInput {
	s3Config: ResolvedS3Config;
	bucket: string;
	keyPrefix: string;
	isObjectLockEnabled?: boolean;
	identityId?: string;
}

/**
 * resolve the common input options for S3 API handlers from Amplify configuration and library options.
 *
 * @param {AmplifyClassV6} amplify The Amplify instance.
 * @param {S3ApiOptions} apiOptions The input options for S3 provider.
 * @returns {Promise<ResolvedS3ConfigAndInput>} The resolved common input options for S3 API handlers.
 * @throws A `StorageError` with `error.name` from `StorageValidationErrorCode` indicating invalid
 *   configurations or Amplify library options.
 *
 * @internal
 */
export const resolveS3ConfigAndInput = async (
	amplify: AmplifyClassV6,
	apiOptions?: S3ApiOptions,
): Promise<ResolvedS3ConfigAndInput> => {
	/**
	 * IdentityId is always cached in memory so we can safely make calls here. It
	 * should be stable even for unauthenticated users, regardless of credentials.
	 */
	const { identityId } = await amplify.Auth.fetchAuthSession();
	assertValidationError(!!identityId, StorageValidationErrorCode.NoIdentityId);

	/**
	 * A credentials provider function instead of a static credentials object is
	 * used because the long-running tasks like multipart upload may span over the
	 * credentials expiry. Auth.fetchAuthSession() automatically refreshes the
	 * credentials if they are expired.
	 */
	const credentialsProvider = async () => {
		const { credentials } = await amplify.Auth.fetchAuthSession();
		assertValidationError(
			!!credentials,
			StorageValidationErrorCode.NoCredentials,
		);

		return credentials;
	};

	const {
		bucket: defaultBucket,
		region: defaultRegion,
		dangerouslyConnectToHttpEndpointForTesting,
		buckets,
	} = amplify.getConfig()?.Storage?.S3 ?? {};

	const { bucket = defaultBucket, region = defaultRegion } =
		(apiOptions?.bucket && resolveBucketConfig(apiOptions, buckets)) || {};

	assertValidationError(!!bucket, StorageValidationErrorCode.NoBucket);
	assertValidationError(!!region, StorageValidationErrorCode.NoRegion);

	const {
		defaultAccessLevel,
		prefixResolver = defaultPrefixResolver,
		isObjectLockEnabled,
	} = amplify.libraryOptions?.Storage?.S3 ?? {};

	const keyPrefix = await prefixResolver({
		accessLevel:
			apiOptions?.accessLevel ?? defaultAccessLevel ?? DEFAULT_ACCESS_LEVEL,
		// use conditional assign to make tsc happy because StorageOptions is a union type that may not have targetIdentityId
		targetIdentityId:
			apiOptions?.accessLevel === 'protected'
				? (apiOptions?.targetIdentityId ?? identityId)
				: identityId,
	});

	return {
		s3Config: {
			credentials: credentialsProvider,
			region,
			useAccelerateEndpoint: apiOptions?.useAccelerateEndpoint,
			...(dangerouslyConnectToHttpEndpointForTesting
				? {
						customEndpoint: LOCAL_TESTING_S3_ENDPOINT,
						forcePathStyle: true,
					}
				: {}),
		},
		bucket,
		keyPrefix,
		identityId,
		isObjectLockEnabled,
	};
};

const resolveBucketConfig = (
	apiOptions: S3ApiOptions,
	buckets: Record<string, BucketInfo> | undefined,
): { bucket: string; region: string } | undefined => {
	if (typeof apiOptions.bucket === 'string') {
		const bucketConfig = buckets?.[apiOptions.bucket];
		assertValidationError(
			!!bucketConfig,
			StorageValidationErrorCode.InvalidStorageBucket,
		);

		return { bucket: bucketConfig.bucketName, region: bucketConfig.region };
	}

	if (typeof apiOptions.bucket === 'object') {
		return {
			bucket: apiOptions.bucket.bucketName,
			region: apiOptions.bucket.region,
		};
	}
};
