const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function optionalTrimmed(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readActualCommit(env) {
  return (
    optionalTrimmed(env.RENDER_GIT_COMMIT) ||
    optionalTrimmed(env.BUILD_COMMIT_SHA) ||
    optionalTrimmed(env.GIT_COMMIT) ||
    null
  );
}

export function resolveReleaseIdentity(env = process.env, isProduction = env.NODE_ENV === "production") {
  const actualCommit = readActualCommit(env);
  const expectedCommit = optionalTrimmed(env.RELEASE_EXPECTED_COMMIT);
  const releaseId = optionalTrimmed(env.RELEASE_ID);

  if (actualCommit && !FULL_COMMIT_SHA.test(actualCommit)) {
    const message = `Release commit must be a full 40-character Git SHA; received ${JSON.stringify(actualCommit)}`;
    if (isProduction) throw new Error(message);
  }

  if (expectedCommit && !FULL_COMMIT_SHA.test(expectedCommit)) {
    throw new Error("RELEASE_EXPECTED_COMMIT must be a full 40-character Git SHA");
  }

  if (releaseId && !RELEASE_ID.test(releaseId)) {
    throw new Error("RELEASE_ID may contain only letters, numbers, dots, underscores, and hyphens");
  }

  if (expectedCommit && !actualCommit) {
    throw new Error("RELEASE_EXPECTED_COMMIT is set but no runtime commit identity is available");
  }

  if (expectedCommit && actualCommit?.toLowerCase() !== expectedCommit.toLowerCase()) {
    throw new Error(
      `Deployed commit ${actualCommit} does not match approved release commit ${expectedCommit}`,
    );
  }

  return Object.freeze({
    commitSha: actualCommit,
    expectedCommitSha: expectedCommit,
    commitVerified: Boolean(expectedCommit && actualCommit),
    releaseId,
  });
}
