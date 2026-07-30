const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function completedEvidence(label, value, failures) {
  if (!value || typeof value !== "object") {
    failures.push(`${label} is missing`);
    return;
  }
  if (value.status !== "passed") failures.push(`${label}.status must be passed`);
  if (!nonEmptyString(value.evidence)) failures.push(`${label}.evidence is required`);
  if (!nonEmptyString(value.completedAt) || Number.isNaN(Date.parse(value.completedAt))) {
    failures.push(`${label}.completedAt must be an ISO timestamp`);
  }
}

export function createReleaseEvidence(policy, commitSha) {
  if (!FULL_COMMIT_SHA.test(commitSha || "")) {
    throw new Error("A full 40-character release commit SHA is required");
  }

  const checks = Object.fromEntries(
    [...policy.requiredStaticChecks, ...policy.requiredExecutableChecks].map((check) => [
      check.id,
      {
        command: check.command,
        status: "pending",
        completedAt: null,
        evidence: "",
      },
    ]),
  );

  const sections = Object.fromEntries(
    policy.requiredEvidenceSections.map((section) => [
      section,
      {
        status: "pending",
        completedAt: null,
        evidence: "",
      },
    ]),
  );

  const smokeModules = Object.fromEntries(
    policy.requiredSmokeModules.map((moduleName) => [
      moduleName,
      {
        status: "pending",
        completedAt: null,
        evidence: "",
      },
    ]),
  );

  return {
    schemaVersion: policy.version,
    release: {
      commitSha,
      deployedCommitSha: "",
      releaseId: "",
      deploymentId: "",
      previousHealthyDeployment: "",
      createdAt: new Date().toISOString(),
    },
    checks,
    sections,
    smokeModules,
    dangerousControls: {
      autoDeployEnabled: false,
      migrationsRunFromStartup: false,
      historicalReplayApplyEnabled: false,
      masterPasswordEnabled: false,
    },
    approval: {
      approver: "",
      approvedAt: "",
      rollbackOwner: "",
    },
  };
}

export function validateReleaseEvidence(evidence, policy) {
  const failures = [];

  if (!evidence || typeof evidence !== "object") return ["release evidence must be a JSON object"];
  if (evidence.schemaVersion !== policy.version) {
    failures.push(`schemaVersion must equal ${policy.version}`);
  }

  const release = evidence.release;
  if (!release || typeof release !== "object") {
    failures.push("release is missing");
  } else {
    for (const field of ["commitSha", "deployedCommitSha"]) {
      if (!FULL_COMMIT_SHA.test(release[field] || "")) {
        failures.push(`release.${field} must be a full 40-character Git SHA`);
      }
    }
    if (
      FULL_COMMIT_SHA.test(release.commitSha || "") &&
      FULL_COMMIT_SHA.test(release.deployedCommitSha || "") &&
      release.commitSha.toLowerCase() !== release.deployedCommitSha.toLowerCase()
    ) {
      failures.push("release.deployedCommitSha must match release.commitSha");
    }
    for (const field of ["releaseId", "deploymentId", "previousHealthyDeployment", "createdAt"]) {
      if (!nonEmptyString(release[field])) failures.push(`release.${field} is required`);
    }
    if (nonEmptyString(release.createdAt) && Number.isNaN(Date.parse(release.createdAt))) {
      failures.push("release.createdAt must be an ISO timestamp");
    }
  }

  const checks = evidence.checks || {};
  for (const check of [...policy.requiredStaticChecks, ...policy.requiredExecutableChecks]) {
    const result = checks[check.id];
    completedEvidence(`checks.${check.id}`, result, failures);
    if (result && result.command !== check.command) {
      failures.push(`checks.${check.id}.command must remain ${check.command}`);
    }
  }

  const sections = evidence.sections || {};
  for (const section of policy.requiredEvidenceSections) {
    completedEvidence(`sections.${section}`, sections[section], failures);
  }

  const smokeModules = evidence.smokeModules || {};
  for (const moduleName of policy.requiredSmokeModules) {
    completedEvidence(`smokeModules.${moduleName}`, smokeModules[moduleName], failures);
  }

  const dangerousControls = evidence.dangerousControls || {};
  for (const key of [
    "autoDeployEnabled",
    "migrationsRunFromStartup",
    "historicalReplayApplyEnabled",
    "masterPasswordEnabled",
  ]) {
    if (dangerousControls[key] !== false) failures.push(`dangerousControls.${key} must be false`);
  }

  const approval = evidence.approval || {};
  for (const field of ["approver", "rollbackOwner"]) {
    if (!nonEmptyString(approval[field])) failures.push(`approval.${field} is required`);
  }
  if (!nonEmptyString(approval.approvedAt) || Number.isNaN(Date.parse(approval.approvedAt))) {
    failures.push("approval.approvedAt must be an ISO timestamp");
  }

  return failures;
}
