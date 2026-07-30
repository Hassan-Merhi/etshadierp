import { deploymentRuntimeConfig } from "./deploymentPreflight.mjs";

const startedAt = new Date();

export const runtimeReleaseState = Object.freeze({
  buildVersion: deploymentRuntimeConfig.buildVersion,
  commitSha: deploymentRuntimeConfig.commitSha,
  expectedCommitSha: deploymentRuntimeConfig.expectedCommitSha,
  commitVerified: deploymentRuntimeConfig.commitVerified,
  releaseId: deploymentRuntimeConfig.releaseId,
  environment: deploymentRuntimeConfig.isProduction ? "production" : process.env.NODE_ENV || "development",
  databaseSource: deploymentRuntimeConfig.databaseSource,
  startedAt: startedAt.toISOString(),
});

globalThis.__erpRuntimeRelease = runtimeReleaseState;

console.log(JSON.stringify({
  timestamp: startedAt.toISOString(),
  level: "INFO",
  module: "deployment-release",
  action: "release-identified",
  ...runtimeReleaseState,
}));
