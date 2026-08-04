import json
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Anchor missing in {path}: {old[:100]!r}")
    file_path.write_text(text.replace(old, new, 1))


replace_once(
    "server/services/remoteControlSessionService.ts",
    'import { isRemoteSupportEnabled } from "./remoteSupportRuntime";\n',
    'import { isRemoteSupportEnabled } from "./remoteSupportRuntime";\nimport { evaluateRemoteSupportRollout } from "./remoteSupportRollout";\n',
)
replace_once(
    "server/services/remoteControlSessionService.ts",
    '''  if (!isRemoteControlControllerRole(input.controllerRole)) {
    throw new RemoteControlSessionError("CONTROLLER_NOT_AUTHORIZED", 403, "This role cannot start support control.");
  }

  const targetUserId''',
    '''  if (!isRemoteControlControllerRole(input.controllerRole)) {
    throw new RemoteControlSessionError("CONTROLLER_NOT_AUTHORIZED", 403, "This role cannot start support control.");
  }
  const rollout = evaluateRemoteSupportRollout({
    companyId: input.controllerCompanyId,
    controllerUserId: input.controllerUserId,
    controllerRole: input.controllerRole,
  });
  if (!rollout.allowed) {
    throw new RemoteControlSessionError(
      rollout.code ?? "REMOTE_SUPPORT_ROLLOUT_BLOCKED",
      409,
      rollout.message ?? "Remote support control is blocked by rollout policy."
    );
  }

  const targetUserId''',
)

replace_once(
    "server/services/remoteControlCommandService.ts",
    'import { isRemoteSupportEnabled } from "./remoteSupportRuntime";\n',
    'import { isRemoteSupportEnabled } from "./remoteSupportRuntime";\nimport { evaluateRemoteSupportRollout } from "./remoteSupportRollout";\n',
)
replace_once(
    "server/services/remoteControlCommandService.ts",
    '''  if (!isRemoteSupportEnabled("remoteControl")) {
    throw new RemoteMouseControlError("MOUSE_CONTROL_DISABLED", 409, "Mouse control is disabled.");
  }
  if (requireMouseCapability''',
    '''  if (!isRemoteSupportEnabled("remoteControl")) {
    throw new RemoteMouseControlError("MOUSE_CONTROL_DISABLED", 409, "Mouse control is disabled.");
  }
  const rollout = evaluateRemoteSupportRollout({
    companyId: session.companyId,
    controllerUserId: session.controllerUserId,
    controllerRole: session.controllerRole,
  });
  if (!rollout.allowed) {
    throw new RemoteMouseControlError(
      rollout.code ?? "REMOTE_SUPPORT_ROLLOUT_BLOCKED",
      409,
      rollout.message ?? "Remote support control is blocked by rollout policy."
    );
  }
  if (requireMouseCapability''',
)

replace_once(
    "server/services/remoteKeyboardCommandService.ts",
    'import { isRemoteSupportEnabled } from "./remoteSupportRuntime";\n',
    'import { isRemoteSupportEnabled } from "./remoteSupportRuntime";\nimport { evaluateRemoteSupportRollout } from "./remoteSupportRollout";\n',
)
replace_once(
    "server/services/remoteKeyboardCommandService.ts",
    '''  if (!isRemoteSupportEnabled("remoteControl") || !isRemoteSupportEnabled("keyboardControl")) {
    throw new RemoteKeyboardControlError("KEYBOARD_CONTROL_DISABLED", 409, "Keyboard control is disabled.");
  }
  if (!session.capabilities.mouse)''',
    '''  if (!isRemoteSupportEnabled("remoteControl") || !isRemoteSupportEnabled("keyboardControl")) {
    throw new RemoteKeyboardControlError("KEYBOARD_CONTROL_DISABLED", 409, "Keyboard control is disabled.");
  }
  const rollout = evaluateRemoteSupportRollout({
    companyId: session.companyId,
    controllerUserId: session.controllerUserId,
    controllerRole: session.controllerRole,
  });
  if (!rollout.allowed) {
    throw new RemoteKeyboardControlError(
      rollout.code ?? "REMOTE_SUPPORT_ROLLOUT_BLOCKED",
      409,
      rollout.message ?? "Remote support control is blocked by rollout policy."
    );
  }
  if (!session.capabilities.mouse)''',
)

replace_once(
    "server/routes/applicationRoutes.ts",
    'import { registerRemoteSupportAuditRoutes } from "./remoteSupportAuditRoutes";\n',
    'import { registerRemoteSupportAuditRoutes } from "./remoteSupportAuditRoutes";\nimport { registerRemoteSupportRolloutRoutes } from "./remoteSupportRolloutRoutes";\n',
)
replace_once(
    "server/routes/applicationRoutes.ts",
    '''  registerRemoteKeyboardControlRoutes(app);
  registerRemoteSupportAuditRoutes(app);
  registerLocationRoutes(app);''',
    '''  registerRemoteKeyboardControlRoutes(app);
  registerRemoteSupportAuditRoutes(app);
  registerRemoteSupportRolloutRoutes(app);
  registerLocationRoutes(app);''',
)

rollout_import = '''import {
  resetRemoteSupportRolloutForTests,
  updateRemoteSupportRollout,
} from "../server/services/remoteSupportRollout";
'''
for test_path in [
    "tests/remote-control-session-service.test.ts",
    "tests/remote-control-command-service.test.ts",
    "tests/remote-keyboard-command-service.test.ts",
]:
    path = Path(test_path)
    text = path.read_text()
    runtime_import = 'import { restoreRemoteSupportBootDefaults, updateRemoteSupportFlags } from "../server/services/remoteSupportRuntime";\n'
    if rollout_import not in text:
        if runtime_import not in text:
            raise SystemExit(f"Runtime import missing in {test_path}")
        text = text.replace(runtime_import, runtime_import + rollout_import, 1)
    before_section = text.split("afterEach", 1)[0]
    if "resetRemoteSupportRolloutForTests();" not in before_section:
        text = text.replace(
            "  beforeEach(() => {\n",
            "  beforeEach(() => {\n    resetRemoteSupportRolloutForTests();\n",
            1,
        )
    if 'updateRemoteSupportRollout({ stage: "general" }' not in text:
        marker = "    );\n  });\n\n  afterEach"
        if marker not in text:
            raise SystemExit(f"beforeEach end missing in {test_path}")
        text = text.replace(
            marker,
            '    );\n    updateRemoteSupportRollout({ stage: "general" }, "remote-support-test");\n  });\n\n  afterEach',
            1,
        )
    if text.count("resetRemoteSupportRolloutForTests();") < 2:
        text = text.replace(
            "    restoreRemoteSupportBootDefaults(",
            "    resetRemoteSupportRolloutForTests();\n    restoreRemoteSupportBootDefaults(",
            1,
        )
    path.write_text(text)

config_path = Path("config/ci-ratchet-allowances.json")
config = json.loads(config_path.read_text())
routes = config.setdefault("routeManifestAdditions", [])
for route in [
    "GET /api/screen-feed/admin/rollout [requireAuth > <anonymous>]",
    "PATCH /api/screen-feed/admin/rollout [requireAuth > <anonymous>]",
    "POST /api/screen-feed/admin/rollout/rollback [requireAuth > <anonymous>]",
]:
    if route not in routes:
        routes.append(route)
config_path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n")

Path(".github/workflows/remote-support-phase8-finish.yml").unlink(missing_ok=True)
Path("scripts/finish-remote-support-phase8.py").unlink(missing_ok=True)
