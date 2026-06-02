const { contextBridge, ipcRenderer } = require("electron");

const api = {
  getLedger: () => ipcRenderer.invoke("ledger:get"),
  addEntry: (input) => ipcRenderer.invoke("ledger:add-entry", input),
  updateSettings: (partial) => ipcRenderer.invoke("settings:update", partial),
  setExpanded: (expanded) => ipcRenderer.invoke("window:set-expanded", expanded),
  getWindowBounds: () => ipcRenderer.invoke("window:get-bounds"),
  setWindowPosition: (position) => ipcRenderer.invoke("window:set-position", position),
  persistWindowPosition: () => ipcRenderer.invoke("window:persist-position"),
  getUsageStatus: () => ipcRenderer.invoke("usage:get-status"),
  getUpdateStatus: () => ipcRenderer.invoke("updates:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  openUpdatePage: (url) => ipcRenderer.invoke("updates:open", url),
  getLeaderboardStatus: () => ipcRenderer.invoke("leaderboard:get-status"),
  loginLeaderboard: () => ipcRenderer.invoke("leaderboard:login"),
  logoutLeaderboard: () => ipcRenderer.invoke("leaderboard:logout"),
  setLeaderboardEnabled: (enabled) => ipcRenderer.invoke("leaderboard:set-enabled", enabled),
  syncLeaderboard: (options) => ipcRenderer.invoke("leaderboard:sync", options),
  getLeaderboard: (range) => ipcRenderer.invoke("leaderboard:get", range),
  getLeaderboards: () => ipcRenderer.invoke("leaderboard:get-all"),
  publishLeaderboards: (collection) => ipcRenderer.send("leaderboard:publish", collection),
  getSocialFriends: () => ipcRenderer.invoke("social:friends"),
  requestSocialFriend: (input) => ipcRenderer.invoke("social:request-friend", input),
  acceptSocialFriend: (userId) => ipcRenderer.invoke("social:accept-friend", userId),
  removeSocialFriend: (userId) => ipcRenderer.invoke("social:remove-friend", userId),
  getSocialGroups: () => ipcRenderer.invoke("social:groups"),
  createSocialGroup: (input) => ipcRenderer.invoke("social:create-group", input),
  createSocialGroupInvite: (groupId, input) => ipcRenderer.invoke("social:create-invite", groupId, input),
  createSocialGroupFriendInvite: (groupId, input) => ipcRenderer.invoke("social:create-friend-invite", groupId, input),
  requestSocialGroupJoin: (code) => ipcRenderer.invoke("social:request-group-join", code),
  getMySocialGroupRequests: () => ipcRenderer.invoke("social:group-requests:mine"),
  acceptSocialGroupFriendInvite: (requestId) => ipcRenderer.invoke("social:group-requests:accept", requestId),
  declineSocialGroupFriendInvite: (requestId) => ipcRenderer.invoke("social:group-requests:decline", requestId),
  getSocialGroupRequests: (groupId) => ipcRenderer.invoke("social:group-requests", groupId),
  approveSocialGroupRequest: (groupId, requestId) => ipcRenderer.invoke("social:group-requests:approve", groupId, requestId),
  declineSocialGroupRequest: (groupId, requestId) => ipcRenderer.invoke("social:group-requests:moderation-decline", groupId, requestId),
  leaveSocialGroup: (groupId) => ipcRenderer.invoke("social:leave-group", groupId),
  setSocialGroupShareUsage: (groupId, shareUsage) => ipcRenderer.invoke("social:set-group-share-usage", groupId, shareUsage),
  getSocialProfile: (userId) => ipcRenderer.invoke("social:get-profile", userId),
  getSocialProfilePrivacy: () => ipcRenderer.invoke("social:get-profile-privacy"),
  updateSocialProfilePrivacy: (input) => ipcRenderer.invoke("social:update-profile-privacy", input),
  getSocialGroupLeaderboard: (groupId, range, basis) => ipcRenderer.invoke("social:group-leaderboard", groupId, range, basis),
  getCloudSyncStatus: () => ipcRenderer.invoke("cloud-sync:get-status"),
  startNewTree: () => ipcRenderer.invoke("cloud-sync:start-new"),
  enableCloudSync: () => ipcRenderer.invoke("cloud-sync:enable"),
  joinExistingTree: () => ipcRenderer.invoke("cloud-sync:join-existing"),
  cancelCloudAuth: () => ipcRenderer.invoke("cloud-sync:cancel-auth"),
  syncCloudTree: () => ipcRenderer.invoke("cloud-sync:sync"),
  getAchievements: () => ipcRenderer.invoke("achievements:get"),
  unlockAchievements: (items) => ipcRenderer.invoke("achievements:unlock", items),
  previewAchievementToast: (id) => ipcRenderer.invoke("achievements:preview-toast", id),
  updateAchievementStats: (stats) => ipcRenderer.invoke("achievements:update-stats", stats),
  reconcileAchievements: (input) => ipcRenderer.invoke("achievements:reconcile", input),
  saveShareImage: (input) => ipcRenderer.invoke("share:save-image", input),
  showManager: () => ipcRenderer.invoke("window:show-manager"),
  openManagerSettings: () => ipcRenderer.invoke("window:open-settings"),
  openMenubarComponentSettings: () => ipcRenderer.invoke("window:open-menubar-settings"),
  openManagerTab: (tab) => ipcRenderer.invoke("window:open-manager-tab", tab),
  toggleMenuBarPopover: () => ipcRenderer.invoke("menubar:toggle-popover"),
  hideMenuBarPopover: () => ipcRenderer.invoke("menubar:hide-popover"),
  showLevelToast: (input) => ipcRenderer.send("level:toast", input),
  notifyAchievementToastReady: () => ipcRenderer.send("achievements:toast-ready"),
  notifyAchievementToastDrained: () => ipcRenderer.send("achievements:toast-drained"),
  notifyManagerReady: () => ipcRenderer.send("manager:ready"),
  onLedger: (callback) => {
    const listener = (_event, ledger) => callback(ledger);
    ipcRenderer.on("bonsai:ledger", listener);
    return () => ipcRenderer.removeListener("bonsai:ledger", listener);
  },
  onExpanded: (callback) => {
    const listener = (_event, expanded) => callback(expanded);
    ipcRenderer.on("bonsai:expanded", listener);
    return () => ipcRenderer.removeListener("bonsai:expanded", listener);
  },
  onOpenAddToken: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("bonsai:open-add-token", listener);
    return () => ipcRenderer.removeListener("bonsai:open-add-token", listener);
  },
  onOpenSettings: (callback) => {
    const listener = (_event, category) => callback(category);
    ipcRenderer.on("bonsai:open-settings", listener);
    return () => ipcRenderer.removeListener("bonsai:open-settings", listener);
  },
  onOpenDashboardTab: (callback) => {
    const listener = (_event, tab) => callback(tab);
    ipcRenderer.on("bonsai:open-dashboard-tab", listener);
    return () => ipcRenderer.removeListener("bonsai:open-dashboard-tab", listener);
  },
  onUsageStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("bonsai:usage-status", listener);
    return () => ipcRenderer.removeListener("bonsai:usage-status", listener);
  },
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("bonsai:update-status", listener);
    return () => ipcRenderer.removeListener("bonsai:update-status", listener);
  },
  onLeaderboardStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("bonsai:leaderboard-status", listener);
    return () => ipcRenderer.removeListener("bonsai:leaderboard-status", listener);
  },
  onLeaderboardData: (callback) => {
    const listener = (_event, collection) => callback(collection);
    ipcRenderer.on("bonsai:leaderboard-data", listener);
    return () => ipcRenderer.removeListener("bonsai:leaderboard-data", listener);
  },
  onAchievements: (callback) => {
    const listener = (_event, state, unlocked) => callback(state, unlocked);
    ipcRenderer.on("bonsai:achievements", listener);
    return () => ipcRenderer.removeListener("bonsai:achievements", listener);
  },
  onPreviewAchievementToast: (callback) => {
    const listener = (_event, id) => callback(id);
    ipcRenderer.on("bonsai:preview-achievement-toast", listener);
    return () => ipcRenderer.removeListener("bonsai:preview-achievement-toast", listener);
  },
  onAchievementToast: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("bonsai:achievement-toast", listener);
    return () => ipcRenderer.removeListener("bonsai:achievement-toast", listener);
  },
  onAchievementToastPlacement: (callback) => {
    const listener = (_event, placement) => callback(placement);
    ipcRenderer.on("bonsai:achievement-toast-placement", listener);
    return () => ipcRenderer.removeListener("bonsai:achievement-toast-placement", listener);
  },
};

contextBridge.exposeInMainWorld("bonsai", api);
