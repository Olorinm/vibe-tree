import type {
  AchievementState,
  AchievementUnlock,
  AchievementUnlockResult,
  CloudSyncStatus,
  CreateSocialFriendInput,
  CreateSocialGroupFriendInviteInput,
  CreateSocialGroupInput,
  CreateSocialGroupInviteInput,
  LedgerFile,
  LeaderboardCollection,
  LeaderboardData,
  LeaderboardRange,
  LeaderboardStatus,
  Settings,
  SocialFriend,
  SocialFriendList,
  SocialGroup,
  SocialGroupInvite,
  SocialGroupJoinRequest,
  SocialGroupLeaderboardBasis,
  SocialGroupLeaderboardData,
  SocialGroupList,
  SocialGroupModerationList,
  SocialGroupRequestList,
  SocialProfilePrivacy,
  SocialProfileResult,
  ToastPlacement,
  TreeToastItem,
  UpdateStatus,
  UsageStatus,
  WindowBounds,
} from "../shared/types";
import type { DashboardTab } from "./types";

declare global {
  interface Window {
    bonsai: {
      getLedger: () => Promise<LedgerFile>;
      addEntry: (input: { tokens: number; note?: string }) => Promise<LedgerFile>;
      updateSettings: (partial: Partial<Settings>) => Promise<LedgerFile>;
      setExpanded: (expanded: boolean) => Promise<boolean>;
      getWindowBounds: () => Promise<WindowBounds | null>;
      setWindowPosition: (position: { x: number; y: number }) => Promise<void>;
      persistWindowPosition: () => Promise<void>;
      getUsageStatus: () => Promise<UsageStatus>;
      getUpdateStatus: () => Promise<UpdateStatus>;
      checkForUpdates: () => Promise<UpdateStatus>;
      installUpdate: () => Promise<UpdateStatus>;
      openUpdatePage: (url?: string) => Promise<void>;
      getLeaderboardStatus: () => Promise<LeaderboardStatus>;
      loginLeaderboard: () => Promise<LeaderboardStatus>;
      logoutLeaderboard: () => Promise<LeaderboardStatus>;
      setLeaderboardEnabled: (enabled: boolean) => Promise<LeaderboardStatus>;
      syncLeaderboard: (options?: { force?: boolean }) => Promise<LeaderboardStatus>;
      getLeaderboard: (range: LeaderboardRange) => Promise<LeaderboardData>;
      getLeaderboards: () => Promise<LeaderboardCollection>;
      publishLeaderboards: (collection: LeaderboardCollection) => void;
      getSocialFriends: () => Promise<SocialFriendList>;
      requestSocialFriend: (input: CreateSocialFriendInput) => Promise<SocialFriend>;
      acceptSocialFriend: (userId: string) => Promise<SocialFriend>;
      removeSocialFriend: (userId: string) => Promise<SocialFriendList>;
      getSocialGroups: () => Promise<SocialGroupList>;
      createSocialGroup: (input: CreateSocialGroupInput) => Promise<SocialGroup>;
      createSocialGroupInvite: (groupId: string, input?: CreateSocialGroupInviteInput) => Promise<SocialGroupInvite>;
      createSocialGroupFriendInvite: (groupId: string, input: CreateSocialGroupFriendInviteInput) => Promise<SocialGroupJoinRequest>;
      requestSocialGroupJoin: (code: string) => Promise<SocialGroupJoinRequest>;
      getMySocialGroupRequests: () => Promise<SocialGroupRequestList>;
      acceptSocialGroupFriendInvite: (requestId: string) => Promise<SocialGroup>;
      declineSocialGroupFriendInvite: (requestId: string) => Promise<SocialGroupJoinRequest>;
      getSocialGroupRequests: (groupId: string) => Promise<SocialGroupModerationList>;
      approveSocialGroupRequest: (groupId: string, requestId: string) => Promise<SocialGroup>;
      declineSocialGroupRequest: (groupId: string, requestId: string) => Promise<SocialGroupJoinRequest>;
      leaveSocialGroup: (groupId: string) => Promise<void>;
      setSocialGroupShareUsage: (groupId: string, shareUsage: boolean) => Promise<SocialGroup>;
      getSocialProfile: (userId: string) => Promise<SocialProfileResult>;
      getSocialProfilePrivacy: () => Promise<SocialProfilePrivacy>;
      updateSocialProfilePrivacy: (input: Partial<SocialProfilePrivacy>) => Promise<SocialProfilePrivacy>;
      getSocialGroupLeaderboard: (groupId: string, range: LeaderboardRange, basis?: SocialGroupLeaderboardBasis) => Promise<SocialGroupLeaderboardData>;
      getCloudSyncStatus: () => Promise<CloudSyncStatus>;
      startNewTree: () => Promise<CloudSyncStatus>;
      enableCloudSync: () => Promise<CloudSyncStatus>;
      joinExistingTree: () => Promise<CloudSyncStatus>;
      cancelCloudAuth: () => Promise<CloudSyncStatus>;
      syncCloudTree: () => Promise<CloudSyncStatus>;
      getAchievements: () => Promise<AchievementState>;
      unlockAchievements: (items: Array<{ id: string; trigger?: Record<string, unknown> }>) => Promise<AchievementUnlockResult>;
      previewAchievementToast: (id: string) => Promise<boolean>;
      updateAchievementStats: (stats: Record<string, unknown>) => Promise<AchievementState>;
      reconcileAchievements: (input: { version: number; unlockedIds: string[]; stats?: Record<string, unknown> }) => Promise<AchievementState>;
      saveShareImage: (input: { filename: string; pngBase64: string }) => Promise<{ canceled: boolean; filePath?: string }>;
      showManager: () => Promise<void>;
      openManagerSettings: () => Promise<void>;
      openMenubarComponentSettings: () => Promise<void>;
      openManagerTab: (tab: DashboardTab) => Promise<void>;
      toggleMenuBarPopover: () => Promise<void>;
      hideMenuBarPopover: () => Promise<void>;
      showLevelToast: (input: { from: number; to: number }) => void;
      notifyAchievementToastReady: () => void;
      notifyAchievementToastDrained: () => void;
      notifyManagerReady: () => void;
      onLedger: (callback: (ledger: LedgerFile) => void) => () => void;
      onExpanded: (callback: (expanded: boolean) => void) => () => void;
      onOpenAddToken: (callback: () => void) => () => void;
      onOpenSettings: (callback: (category?: string | null) => void) => () => void;
      onOpenDashboardTab: (callback: (tab: DashboardTab) => void) => () => void;
      onUsageStatus: (callback: (status: UsageStatus) => void) => () => void;
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
      onLeaderboardStatus: (callback: (status: LeaderboardStatus) => void) => () => void;
      onLeaderboardData: (callback: (collection: LeaderboardCollection) => void) => () => void;
      onAchievements: (callback: (state: AchievementState, unlocked: AchievementUnlock[]) => void) => () => void;
      onPreviewAchievementToast: (callback: (id: string) => void) => () => void;
      onAchievementToast: (callback: (payload: { ids?: string[]; items?: TreeToastItem[]; placement: ToastPlacement }) => void) => () => void;
      onAchievementToastPlacement: (callback: (placement: ToastPlacement) => void) => () => void;
    };
  }
}
