/** @param {NodeJS.ProcessEnv} env */
function isWindowsDevOwnerSetupEnabled(env) {
  return env.NODE_ENV === "development" && env.TDK_WINDOWS_DEV_OWNER_SETUP === "1" &&
    env.DB_NAME === "TDK_POS_TEST";
}

/** @param {NodeJS.ProcessEnv} env */
function isOwnerSetupModeEnabled(env) {
  return env.TDK_NAS_OWNER_SETUP === "1" || isWindowsDevOwnerSetupEnabled(env);
}

/** @param {NodeJS.ProcessEnv} env */
function requiresInitialMasterStatusLimit(env) {
  return !isWindowsDevOwnerSetupEnabled(env);
}

module.exports = { isWindowsDevOwnerSetupEnabled, isOwnerSetupModeEnabled, requiresInitialMasterStatusLimit };
