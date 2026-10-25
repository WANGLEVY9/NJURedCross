import { notifyCommunityReview, notifyBlessingDelivered } from './lib/community/author-notifications.js';
import { validateBirthdayCalendar, birthdayCalendarSchemaReady, isBirthdayOn } from './lib/community/birthday-calendar.js';
import {participationReminderMessages} from './lib/events/participation-reminders.js';
import {openMailSettings} from './lib/mail/templates.js';
import {mailSettingsRoutes} from './lib/mail/settings-api.js';
import {projectEventSessionAccess} from './lib/events/event-session-access.js';
import {createActivityLifecycleStore} from './lib/events/activity-lifecycle-store.js';
import {createBloodWeekStore} from './lib/events/blood-week-store.js';
import { readCommunityRows } from './lib/community/scoped-rows.js';
import {workspaceNotificationItems} from './lib/events/workspace-notifications.js';
import { createActivityChangeStore } from './lib/events/activity-change-store.js';
/**
 * 应用装配入口。
 *
 * 一个进程同时提供：公众服务门户、运营控制台、静态资源与 `/api/*` 业务接口。
 * 请求进来后先解析会话与权限，再按路径前缀委派给各业务域模块；委派模块用
 * `return false` 表示「不是我的路由」，控制权继续向后传递。
 *
 * 分层：
 *   · `lib/http/`     —— 传输与响应策略（安全头、静态文件、分页、读缓存）
 *   · `lib/identity/` —— 账号、口令、邮箱验证、资料与会员私有字段
 *   · `lib/events/`   —— 活动运维、志愿流程试点、献血车排班与通知附件
 *   · `lib/morning/`、`lib/community/` —— 早安晚安、留言墙与生日祝福
 *
 * 业务域模块只接收显式注入的上下文，不反向导入本文件；新增域模块请沿用
 * `lib/<domain>/api.js` 的形式。数据边界见 docs/ARCHITECTURE.md。
 */

import { accountFromRow } from './lib/identity/store.js';
import {organizationAuthority,readAuthorityEvents} from './lib/events/organization-authority.js';
import {organizationDirectory} from './lib/events/organization-directory.js';
import {withoutRequestBudget} from './lib/http/request-budget.js';
import { morningRoutes } from './lib/morning/api.js';
import { morningAdminRoutes } from './lib/morning/admin.js';
import { morningPlazaRoutes } from './lib/morning/plaza.js';
import { openMorningPlazaSnapshotStore } from './lib/morning/plaza-snapshot-store.js';
import { readMorningGrades } from './lib/morning/grade-source.js';
import { morningInvitationRoutes } from './lib/morning/invitations.js';
import { readMorningInviteCoordinators } from './lib/morning/coordinators.js';
import { morningRevisionRoutes } from './lib/morning/revisions.js';
import { morningTagRoutes } from './lib/morning/tags.js';
import { MORNING_PROTECTED_TABLES } from './lib/morning/shared.js';
import { createWarmthCapabilities } from './lib/community/capabilities.js';
import { inspectMorningSchema } from './lib/morning/rollout.js';
import { readPagedRows } from './lib/http/paged-rows.js';
import { validateAttendancePhoto } from './lib/events/photo-validation.js';
import { messageRoutes, MESSAGE_TABLE } from './lib/community/messages.js';
import { craneRoutes } from './lib/community/cranes.js';
import { birthdayDeliveryQuota } from './lib/community/birthday-delivery.js';
import { friendBlessingTarget, friendSchemaReady, assertFriendSchema, deliverFriendBlessings, shanghaiDate as friendDeliveryDate } from './lib/community/friend-blessings.js';
import { birthdayRolloutConfig, inspectBirthdaySchema } from './lib/community/birthday-rollout.js';
import { workflowMode } from './lib/events/workflow-mode.js';
import {participantDirectory} from './lib/events/participant-directory.js';
import http from 'node:http';
import { observer } from './lib/observability.js';
import { clientTelemetry } from './lib/client-telemetry.js';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Base } from 'seatable-api';
import { json, securityHeaders } from './lib/http/response.js';
import { withDisplayReads, isDisplayRead, isDisplayRequest, invalidateDisplayReads, displayRead, displayReadCacheStats } from './lib/http/display-reads.js';
import { createReadCache } from './lib/http/read-cache.js';
import { createWriteJournal, withWriteJournal, writtenTables, trackClient } from './lib/cache/write-tracker.js';
import { createIdleGate } from './lib/background/idle-gate.js';
import { createJobQueue } from './lib/queue/index.js';
import { createStaticHandler } from './lib/http/static.js';
import { createPdfAssets } from './lib/http/pdf-assets.js';
import { createSeaTableAccess } from './lib/seatable-auth.js';
import QRCode from 'qrcode';
import { ACCOUNT_TABLE, loadAccountsFromTable, findAccountByLogin, resolveSignInAccount, generateMemberCode, canAuthenticate, credentialVersion } from './lib/identity/store.js';
import { identityRoutes, withIdentityAccountLock } from './lib/identity/api.js';
import { readVolunteerPlatformHours, lookupVolunteerHours } from './lib/events/volunteer-platform-hours.js';
import { validatePrivateStateDirectory } from './lib/http/private-state-directory.js';
import {openWorkspaceDraftStore} from './lib/events/workspace-draft-store.js';
import {createWorkspaceDrafts} from './lib/events/workspace-drafts.js';
import {createWorkspaceSubmissions} from './lib/events/workspace-submissions.js';
import {createWorkspaceWorkflowBridge} from './lib/events/workspace-workflow-bridge.js';
import {createActivityApprovalRouter,readWorkspaceProfileData,readWorkspaceRoster} from './lib/events/workspace-providers.js';
import {createWorkspaceRoleStore} from './lib/events/workspace-role-store.js';
import {createWorkspaceApprovalRouting} from './lib/events/workspace-approval-routing.js';
import {workspaceDraftAccess,createWorkspaceDraftAuthorization} from './lib/events/workspace-draft-access.js';
import {assertWorkspaceResponsible} from './lib/events/workspace-responsible.js';
import {configureMailer,mailerStatus,sendMail,getMailDeliveryStatuses,repairMailRecords,retryQueuedMail} from './lib/mailer.js';
import { eventsOpsRoutes } from './lib/events/api.js';
import { assertApiRequestPath } from './lib/http/request-path.js';
import * as njubox from './lib/events/njubox.js';
import { summarizeVolunteerWorkflow, registrationReadiness, previewHoursEntry } from './lib/events/volunteer-workflow.js';
import { projectWorkflowEvents } from './lib/events/public-workflow.js';
import { activityKind, activityRegion, categoryFacets } from './public/app/shared/activity-taxonomy.js';
import { createWorkflow, WF } from './lib/events/workflow.js';
import {createHoursSubmissionStore} from './lib/events/hours-submission-store.js';
import { ORDINARY_GROUP_TABLE } from './lib/events/ordinary-groups.js';
import { createWishlist } from './lib/events/wishlist.js';
import {createOrdinaryPlaces} from './lib/events/ordinary-places.js';
import {createRegistrationNotifications} from './lib/events/registration-notifications.js';
import {createDecisionMail} from './lib/events/decision-mail.js';
import {openDecisionMailStore} from './lib/events/decision-mail-store.js';
import { workflowRoutes } from './lib/events/workflow-api.js';
import { previewHoursExport } from './lib/events/hours-export.js';
import { apiFailure } from './lib/http/errors.js';
import { createMutationQueue, assertCompleteRows } from './lib/events/safety.js';
import { CONSOLE_PERMISSION_SCOPES, normalizePermissions, hasPermission, isAccountActive, scopeForConsolePath } from './lib/permissions.js';
import {createApprovalRouting} from './lib/events/approval-routing.js';
import {createApprovalRoutingStore} from './lib/events/approval-routing-store.js';
import * as attachmentApi from './lib/attachment/api.js';
import * as mediaApi from './lib/attachment/media.js';
import * as showcaseApi from './lib/attachment/showcase.js';
import * as reviewFlow from './lib/attachment/review.js';
import { applyReviewStep } from './lib/attachment/review-policy.js';
import * as taskApi from './lib/attachment/tasks.js';
import { searchBusinessRecords } from './lib/console-search.js';
import { agentRoutes } from './lib/agent/api.js';
import { createAgentTaskService } from './lib/agent/task-service.js';
import { createConfiguredAgentModel } from './lib/agent/model-factory.js';
import {
  createConfiguredAgentCallLimiter,
} from './lib/agent/call-limit-config.js';
import {
  readAgentBusinessContext,
} from './lib/agent/business-context.js';
import { createFileAgentTaskStore } from './lib/agent/task-store.js';
import { SUBMISSION_ATTACHMENT_TABLE, MEDIA_TABLE, SHOWCASE_TABLE, formatAttachmentRefs, parseAttachmentRefs, normalizePenName, PEN_NAME_MIN, PEN_NAME_MAX, ARTICLE_CATEGORIES, SHOWCASE_GROUPS, LIAISON_TABLE, CHECKLIST_TABLE, TASK_TABLE, TASK_CLAIM_TABLE, SKILL_TABLE, PUBLISH_FORMS, normalizePublishForm, REVIEW_STATUS, reviewChainFor, reviewProgressFor, parseReviewTrail, canSchedule, canReturnAtLevel, submissionKindFor } from './lib/attachment/store.js';
import { createSessionRevocations } from './lib/identity/session-revocations.js';
import {
  assertRequestActive,
  withHttpRequestBudget,
  withRequestBudget,
} from './lib/http/request-budget.js';
import { uploadSeaTableImageRequest } from './lib/http/seatable-image.js';
import { collectRequestBody } from './lib/http/request-body.js';
import { readJsonObject } from './lib/http/json-body.js';
import { openMaterialReceiptStore } from './lib/materials/receipt-store.js';
import { openPublicMaterialRequestStore } from './lib/materials/public-request-store.js';
import { createPublicMaterialsPortal, assertMaterialRequestAsset, materialLinkedIds } from './lib/materials/public-portal.js';
import { publicMaterialRoutes } from './lib/materials/public-api.js';
import { reimbursementConfiguration, reimbursementConnection, reimbursementReviewerBindings } from './lib/reimbursements/config.js';
import { createReimbursementNotifier } from './lib/reimbursements/notifications.js';
import { FINANCE_REVIEWERS, resolveFinanceReviewerBindings } from './lib/reimbursements/review-routing.js';
import { findReimbursementReviewer } from './lib/reimbursements/reviewer-source.js';
import { createReimbursementTableStore } from './lib/reimbursements/table-store.js';
import { createReimbursementWriteFence } from './lib/reimbursements/write-fence.js';
import { createReimbursementBox } from './lib/reimbursements/box-storage.js';
import { createTableReimbursementService } from './lib/reimbursements/table-service.js';
import { createProductionReimbursementApi, reimbursementFeatureEnabled, productionFinancePermissions, productionReimbursementActor } from './lib/reimbursements/production-api.js';
import { createWriteCoordinator } from './lib/materials/write-coordinator.js';
import { materialOperationIdentity } from './lib/materials/operation.js';
import { executeMaterialRecovery } from './lib/materials/execute-recovery.js';
import { materialApplicationPlan } from './lib/materials/application-plan.js';
import { openMailDeliveryStore } from './lib/mail/delivery-store.js';
import { openMailRetryStore } from './lib/mail/retry-store.js';
import {
  hashPasswordAsync as hashPassword,
  verifyPasswordAsync as verifyPassword,
} from './lib/identity/password-async.js';
import { createAuditWriteHealth } from './lib/audit/write-health.js';
import { openAuditReconciliationStore } from './lib/audit/reconciliation-store.js';
import {
  persistAuditRecord,
  reconcileAuditRecord,
} from './lib/audit/reconciliation.js';
import { auditReconciliationConfig } from './lib/audit/config.js';
import { startBackgroundTask } from './lib/background/task.js';
import {
  createHttpShutdown,
  registerShutdownCleanup,
} from './lib/http/shutdown.js';
import { registerShutdownSignals } from './lib/http/shutdown-signals.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const port = Number(process.env.PORT || 3000);
const serverUrl = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const apiToken = process.env.SEATABLE_API_TOKEN;
const configuredTable = process.env.SEATABLE_TABLE?.trim();
const volunteerApiToken = process.env.SEATABLE_VOLUNTEER_API_TOKEN?.trim();
const volunteerBaseUuid = process.env.SEATABLE_VOLUNTEER_BASE_UUID?.trim() || null;
const adminUsername = process.env.PLATFORM_ADMIN_USERNAME?.trim();
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD;
/**
 * Account file. `PLATFORM_ADMIN_ACCOUNTS_FILE` is the pre-rename name and is
 * still honoured so an existing deployment keeps booting after the upgrade.
 */
const accountsFile = join(root, process.env.PLATFORM_ACCOUNTS_FILE || process.env.PLATFORM_ADMIN_ACCOUNTS_FILE || '.platform-accounts.json');
const isProduction = process.env.NODE_ENV === 'production';
const birthdayRollout = birthdayRolloutConfig(process.env);
async function assertBirthdayReady(client) {
  if (!birthdayRollout.enabled) throw httpError(503, '生日祝福升级尚未启用。');
  const result = inspectBirthdaySchema(await client.getMetadata());
  if (!result.ready) {
    const error = httpError(503, '生日祝福数据表尚未准备好，请联系管理员。');
    error.code = 'birthday_schema_not_ready';
    throw error;
  }
}

/**
 * Two surfaces, three roles:
 *   · the operations console is the internal workspace and is restricted to
 *     platform administrators;
 *   · the public service portal is the student surface, open to any member.
 * A platform administrator may use the portal as well; a member may not reach
 * the console.
 */
const roleDefinitions = {
  super_admin: { label: '超级管理员', surfaces: ['console', 'portal'] },
  platform_admin: { label: '管理平台管理员', surfaces: ['console', 'portal'] },
  member: { label: '活动平台成员', surfaces: ['portal'] },
};
const consoleRoles = new Set(['platform_admin', 'super_admin']);
/** Password complexity applies to new registrations and resets; keep legacy login compatible. */
const minimumPasswordLength = 8;
const publicEmailDomains = String(process.env.PUBLIC_EMAIL_DOMAINS || 'nju.edu.cn,smail.nju.edu.cn')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const publicWriteLimit = Math.max(1, Number(process.env.PUBLIC_WRITE_LIMIT_PER_HOUR || 12));
const publicRequests = new Map();
const sessionSecret = process.env.PLATFORM_SESSION_SECRET;
const sessionTtlHours = Math.min(Math.max(Number(process.env.PLATFORM_SESSION_TTL_HOURS || 8), 1), 24 * 7);
const sessionTtlSeconds = Math.round(sessionTtlHours * 60 * 60);
const secureCookie = isProduction || String(process.env.PLATFORM_COOKIE_SECURE || 'false') === 'true';
const smtpHost = process.env.SMTP_HOST?.trim();
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const smtpUser = process.env.SMTP_USER?.trim();
const smtpPassword = process.env.SMTP_PASSWORD;
const reminderFrom = process.env.MATERIALS_REMINDER_FROM?.trim() || smtpUser;
const reminderIntervalMinutes = Math.max(5, Number(process.env.MATERIALS_REMINDER_INTERVAL_MINUTES || 15));
const configuredPublicBaseUrl = process.env.PUBLIC_BASE_URL?.trim()
  || (isProduction && process.env.WARMTH_MORNING_ENABLED === 'true' ? 'https://njuredcross.cn' : '');
let publicBaseUrl = `http://localhost:${port}`;
if (configuredPublicBaseUrl) {
  let parsed;
  try { parsed = new URL(configuredPublicBaseUrl); } catch { throw new Error('PUBLIC_BASE_URL must be a valid absolute URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('PUBLIC_BASE_URL must be an HTTP(S) origin without credentials, query or fragment');
  }
  publicBaseUrl = parsed.href.replace(/\/$/, '');
}
const loginAttempts = new Map();

const revocationFile = process.env.PLATFORM_SESSION_REVOCATIONS_FILE?.trim()
  || join(root, '.session-state', 'revocations.json');
const revokedSessions = await createSessionRevocations({
  file: revocationFile,
});

if (!apiToken || apiToken === 'replace-with-your-api-token') {
  console.error('Missing SEATABLE_API_TOKEN. Copy .env.example to .env and configure it.');
  process.exit(1);
}
if (!sessionSecret || sessionSecret.startsWith('replace-with-') || sessionSecret.length < 32) {
  console.error('Missing secure platform login configuration. Set a 32+ character PLATFORM_SESSION_SECRET in .env.');
  process.exit(1);
}

const configuredWriteStateDir =
  process.env.PLATFORM_WRITE_STATE_DIR?.trim();

if (isProduction && !configuredWriteStateDir) {
  throw new Error(
    'Production requires PLATFORM_WRITE_STATE_DIR in persistent private storage',
  );
}

const auditConfig = auditReconciliationConfig(process.env, publicDir);
const auditBaseUuid = auditConfig?.baseUuid || '';
const writeStateDir = resolve(
  configuredWriteStateDir || join(root, '.write-state'),
);

await validatePrivateStateDirectory(
  { directory: writeStateDir },
  publicDir,
);
const agentTaskService = createAgentTaskService({
  model: createConfiguredAgentModel(),
  callLimiter: createConfiguredAgentCallLimiter(),
  readBusinessContext: ({ brief, permissions }) =>
    readAgentBusinessContext({ brief, permissions, search: getConsoleSearch }),
  store: createFileAgentTaskStore({
    filePath: join(writeStateDir, 'agent-tasks.json'),
  }),
});
const materialReceiptStore = await openMaterialReceiptStore(
  join(writeStateDir, 'material-receipts.sqlite'),
);
const withSharedWriteLock = await createWriteCoordinator(
  join(writeStateDir, 'write-lock.sqlite'),
);
const morningPlazaSnapshotStore = await openMorningPlazaSnapshotStore(
  join(writeStateDir, 'morning-plaza-daily.sqlite'),
);
// Identity requests run concurrently; maintenance alone takes this gate exclusively.
const withIdentityAccess = await createWriteCoordinator(
  join(writeStateDir, 'identity-maintenance.sqlite'), { mode: 'shared' },
);
const mailDeliveryStore = await openMailDeliveryStore(
  join(writeStateDir, 'mail-deliveries.sqlite'),
);
const mailRetryStore = await openMailRetryStore(
  join(writeStateDir, 'mail-retries.sqlite'),
);
const mailSettingsStore=await openMailSettings(join(writeStateDir,'mail-settings.json'));
let registrationTriggerPending = false;
const configuredQueueConcurrency = Number.parseInt(process.env.PLATFORM_QUEUE_CONCURRENCY || '2', 10);
const jobQueue = await createJobQueue({
  file: join(writeStateDir, 'jobs.sqlite'),
  concurrency: configuredQueueConcurrency >= 1 && configuredQueueConcurrency <= 4 ? configuredQueueConcurrency : 2,
  handlers: {
    'registration.notifications': async () => runRegistrationNotificationsJob(),
    'approval.reminders': async () => reconcileApprovalReminders(),
  },
  onError: () => console.warn('Queued task deferred; durable state kept for retry or review'),
});

const auditReconciliationStore = auditConfig
  ? await openAuditReconciliationStore(
    auditConfig.file,
    { secret: sessionSecret, baseUuid: auditConfig.baseUuid },
  )
  : null;
// 写表记账代理：只记录被写入的表名，用于请求结束后精确失效展示投影。
const base = trackClient(new Base({ server: serverUrl, APIToken: apiToken }), { onWrite: invalidateWrittenSnapshots });
const volunteerBase = volunteerApiToken ? trackClient(new Base({ server: serverUrl, APIToken: volunteerApiToken }), { onWrite: invalidateWrittenSnapshots }) : null;
const mainAccess = createSeaTableAccess(base);
// Finance uses dedicated credentials, after private-directory validation.
// Construction does no network or file writes.
const reimbursementConfig = reimbursementConfiguration();
const currentFinanceBindings = () => resolveFinanceReviewerBindings(accountsByUsername.values(), reimbursementReviewerBindings());
const reimbursementStore = createReimbursementTableStore({ getClient: reimbursementConnection(reimbursementConfig.table),
  allowWrites: reimbursementConfig.allowWrites,
  fence: createReimbursementWriteFence(join(writeStateDir, 'reimbursement-write-fence.json')) });
const reimbursementService = createTableReimbursementService({ store: reimbursementStore, files: createReimbursementBox(reimbursementConfig.box),
  activityProvider: async () => getPublicEvents(await getBase()) });
const reimbursementApi = createProductionReimbursementApi({ config: reimbursementConfig, store: reimbursementStore, service: reimbursementService,
  requirePortalSession, requirePortalWrite, enforceLimit: enforcePublicLimit,
  actorFor: session => { const account = accountsByUsername.get(session.username); return isAccountActive(account) ? productionReimbursementActor(account, currentFinanceBindings()) : null; } });
const reimbursementNotifier = createReimbursementNotifier({ service: reimbursementService,
  origin: process.env.PUBLIC_BASE_URL || 'https://njuredcross.cn',
  enabled: () => process.env.PLATFORM_REIMBURSEMENTS_MAIL_ENABLED === 'true' && reimbursementFeatureEnabled(reimbursementConfig) && mailerStatus().configured,
  getReviewer: async key => {
    const bindings = currentFinanceBindings(), id = bindings[key];
    if (!id || Object.values(bindings).filter(value => value === id).length !== 1) return null;
    return findReimbursementReviewer(await getIdentityBase(), id, FINANCE_REVIEWERS[key]);
  }, send: message => sendMail(message, { renderTemplate: false }) });
const volunteerAccess = volunteerBase ? createSeaTableAccess(volunteerBase) : null;

async function getBase() {
  const client=await mainAccess();
  if(isProduction&&client.dtableUuid!==process.env.SEATABLE_BUSINESS_BASE_UUID)throw new Error('Business Base configuration mismatch');
  return client;
}

// Private identity Base is never exposed through business table/metadata routes.
const identityApiToken = process.env.SEATABLE_IDENTITY_API_TOKEN?.trim();
const identityBaseUuid = process.env.SEATABLE_IDENTITY_BASE_UUID?.trim();
if (isProduction && (!identityApiToken || !identityBaseUuid)) throw new Error('Production requires a separate configured identity Base');
const identityBase = identityApiToken ? trackClient(new Base({server:serverUrl,APIToken:identityApiToken}), { onWrite: invalidateWrittenSnapshots }) : null;
// Read-only mirror of the legacy 志愿服务平台 Base for member-center hours.
const volunteerPlatformApiToken = process.env.SEATABLE_VOLUNTEER_PLATFORM_API_TOKEN?.trim();
const volunteerPlatformBaseUuid = process.env.SEATABLE_VOLUNTEER_PLATFORM_BASE_UUID?.trim() || null;
const volunteerPlatformBase = volunteerPlatformApiToken ? trackClient(new Base({server:serverUrl,APIToken:volunteerPlatformApiToken}), { onWrite: invalidateWrittenSnapshots }) : null;
const volunteerPlatformAccess = volunteerPlatformBase ? createSeaTableAccess(volunteerPlatformBase) : null;
const identityAccess = identityBase ? createSeaTableAccess(identityBase) : null;
// Dedicated write connection to the explicitly configured profile Base only.
const profileBaseUuid=process.env.SEATABLE_PROFILE_BASE_UUID?.trim();
const profileBase=process.env.SEATABLE_PROFILE_API_TOKEN?trackClient(new Base({server:serverUrl,APIToken:process.env.SEATABLE_PROFILE_API_TOKEN}), { onWrite: invalidateWrittenSnapshots }):null;
const profileAccess=profileBase?createSeaTableAccess(profileBase):null;
async function getProfileBase(){
  const client=await profileAccess();
  if(!profileBaseUuid || client.dtableUuid!==profileBaseUuid)throw new Error('Profile Base configuration mismatch');
  return client;
}
// Production borrowing uses the existing business Base and its real link column.
// Finance/returns preview services are deliberately not mounted here.
const publicMaterialRequests = openPublicMaterialRequestStore(
  join(writeStateDir, 'public-material-requests.sqlite'),
);
const publicMaterialsPortal = createPublicMaterialsPortal({
  getProfileBase,
  getInventory: materialBundle,
  store: publicMaterialRequests,
});
function materialPortalActor(session) {
  const account = accountsByUsername.get(session.username);
  return account ? { id: businessAccountRef(session), realName: account.realName,
    studentId: account.studentId, email: account.email, emailVerified: account.emailVerified } : null;
}
async function getIdentityBase() {
  if (!identityAccess) return getBase(); // Local legacy/bootstrap compatibility only.
  const client = await identityAccess();
  if (!identityBaseUuid || client.dtableUuid !== identityBaseUuid) throw new Error('Identity Base configuration mismatch');
  return client;
}
async function getVolunteerPlatformBase() {
  if (!volunteerPlatformAccess) return null;
  const client = await volunteerPlatformAccess();
  if (!volunteerPlatformBaseUuid || client.dtableUuid !== volunteerPlatformBaseUuid) throw new Error('Volunteer platform Base configuration mismatch');
  return client;
}
function volunteerPlatformCacheTtlMs() {
  const raw = Number(process.env.PLATFORM_VOLUNTEER_PLATFORM_CACHE_MS);
  return Number.isSafeInteger(raw) && raw >= 0 ? raw : 300_000;
}
let volunteerPlatformHours = { at: 0, promise: null };
/** 姓名＋学号匹配的会级时长索引；共享单飞缓存，失败后由下一个请求重建。 */
async function getVolunteerPlatformHours(account) {
  if (!volunteerPlatformAccess) return null;
  const ttl = volunteerPlatformCacheTtlMs(), now = Date.now();
  if (!ttl || !volunteerPlatformHours.promise || now - volunteerPlatformHours.at >= ttl) {
    const startedAt = Date.now();
    const promise = getVolunteerPlatformBase().then(readVolunteerPlatformHours);
    volunteerPlatformHours = { at: now, promise };
    promise.then(index => console.log(JSON.stringify({ schema: 1, type: 'dependency', service: 'seatable', operation: 'volunteer-platform-index', durationMs: Date.now() - startedAt, status: 200, rows: index.size })))
      .catch(error => {
        if (volunteerPlatformHours.promise === promise) volunteerPlatformHours = { at: 0, promise: null };
        console.warn('Volunteer platform hours index rebuild deferred:', String(error?.cause?.code || error?.code || error?.message || error).slice(0, 60));
      });
  }
  try {
    return lookupVolunteerHours(await volunteerPlatformHours.promise, account);
  } catch {
    return null;
  }
}

async function loadAccountsFromFile() {
  if (process.env.PLATFORM_ACCOUNTS_FILE || process.env.PLATFORM_ADMIN_ACCOUNTS_FILE) {
    try {
      const configured = JSON.parse(await readFile(accountsFile, 'utf8'));
      if (!Array.isArray(configured) || configured.length === 0) throw new Error('must be a non-empty JSON array');
      return configured;
    } catch (error) {
          console.error('Unable to load platform accounts; check the private account file path, format and permissions.');
      process.exit(1);
    }
  }
  if (!adminUsername || !adminPassword || adminPassword.startsWith('replace-with-')) {
    console.error('Missing platform account configuration. Set PLATFORM_ACCOUNTS_FILE, or PLATFORM_ADMIN_USERNAME and PLATFORM_ADMIN_PASSWORD in .env.');
    process.exit(1);
  }
  return [{ username: adminUsername, password: adminPassword, role: 'platform_admin', label: '本地管理员' }];
}

/**
 * Accounts live in SeaTable once the identity schema has been applied. The JSON
 * file stays as the bootstrap path so an existing checkout keeps starting
 * before `npm run accounts:apply` has ever been run. The active source is
 * printed at boot so it is never ambiguous which store is being served.
 */
async function loadAccounts() {
  try {
    const client = await getIdentityBase();
    const stored = await loadAccountsFromTable(client);
    if (stored?.size) return { source: `seatable:${identityApiToken ? 'identity:' : ''}${ACCOUNT_TABLE}`, accounts: [...stored.values()] };
    if (identityApiToken) throw new Error('Private identity account table is empty');
    console.warn(`Platform account table "${ACCOUNT_TABLE}" is missing or empty; falling back to ${accountsFile}. Run \`npm run accounts:apply\` to migrate.`);
  } catch (error) {
    if (identityApiToken) throw new Error('Private identity store unavailable; refusing credential fallback');
    console.warn('Unable to read the platform account table; using the configured local bootstrap account file.');
  }
  return { source: accountsFile, accounts: await loadAccountsFromFile() };
}

const accountLoad = await loadAccounts();
const accountsByUsername = new Map();
for (const account of accountLoad.accounts) {
  const username = typeof account?.username === 'string' ? account.username.trim() : '';
  const role = roleDefinitions[account?.role];
  const password = typeof account.password === 'string' ? account.password : '';
  const passwordHash = typeof account.passwordHash === 'string' ? account.passwordHash : '';
  if (
    !username
    || (!password && !passwordHash)
    || (!passwordHash && password.length < minimumPasswordLength)
    || !role
    || accountsByUsername.has(username)
  ) {
    console.error(
      `Platform account configuration is invalid. Each account needs a unique username, a password hash (or a password of at least ${minimumPasswordLength} characters, ${isProduction ? 'production' : 'development'} policy), and one of these roles: ${Object.keys(roleDefinitions).join(', ')}.`,
    );
    process.exit(1);
  }
  accountsByUsername.set(username, {
    ...account,
    username,
    password,
    passwordHash,
    label: String(account.label || role.label).trim(),
    role: account.role,
    permissions: normalizePermissions(account.permissions, account.role),
  });
}
if (!isProduction) {
  const weak = [...accountsByUsername.values()].filter((account) => !account.passwordHash && account.password.length < 16);
  if (weak.length) {
    console.warn(
      `Development password policy active: ${weak.length} of ${accountsByUsername.size} accounts use passwords shorter than 16 characters. Set NODE_ENV=production to enforce the production policy.`,
    );
  }
}
console.log(`Platform accounts: ${accountsByUsername.size} loaded from ${accountLoad.source}`);

const organizationEvents=accountLoad.source.startsWith('seatable:');
/**
 * 会话账号的读取窗口。展示读（GET/HEAD）允许复用最近一次账号行，写请求始终
 * 直读权威源，因此停号、改角色、改权限在写操作上仍然立即生效。
 */
function accountRefreshTtlMs(){
 const raw=Number(process.env.PLATFORM_ACCOUNT_REFRESH_MS);
 return Number.isSafeInteger(raw)&&raw>=0?raw:5_000;
}
const accountRefreshCache=new Map();
let accountRefreshGeneration=0;
function invalidateAccountRefresh(username){
 accountRefreshGeneration++;
 if(typeof username==='string'&&username)accountRefreshCache.delete(username.trim().toLowerCase());
 else accountRefreshCache.clear();
}
async function loadSessionAccount(username,{allowCache=false}={}){
 const key=String(username||'').trim().toLowerCase();
 if(!key)return null;
 const ttl=accountRefreshTtlMs(),now=Date.now(),cached=accountRefreshCache.get(key);
 if(allowCache&&ttl&&cached&&now-cached.at<ttl)return cached.account;
 const generation=accountRefreshGeneration;
 const fresh=await findAccountByLogin(await getIdentityBase(),key);
 if(generation===accountRefreshGeneration)accountRefreshCache.set(key,{at:now,account:fresh});
 return fresh;
}
/** 账号与组织目录的快照窗口；目录只用于负责人选择与参与者资料，不参与鉴权。 */
function directoryCacheTtlMs(){
 const raw=Number(process.env.PLATFORM_DIRECTORY_CACHE_MS);
 return Number.isSafeInteger(raw)&&raw>=0?raw:60_000;
}
let directorySnapshot={at:0,promise:null};
async function loadEventDirectory(){
 const accounts=organizationEvents?[...(await loadAccountsFromTable(await getIdentityBase())).values()]:[...accountsByUsername.values()];
 return organizationEvents?organizationDirectory(accounts,await getVolunteerBase()):accounts;
}
async function eventDirectory(){
 if(!isDisplayRead())return loadEventDirectory();
 const ttl=directoryCacheTtlMs(),now=Date.now();
 if(ttl&&directorySnapshot.promise&&now-directorySnapshot.at<ttl)return directorySnapshot.promise;
 const promise=loadEventDirectory();
 directorySnapshot={at:now,promise};
 // 读取失败不能固化成缓存：失败后下一次调用立即重新取数。
 promise.catch(()=>{if(directorySnapshot.promise===promise)directorySnapshot={at:0,promise:null};});
 return promise;
}
function invalidateEventDirectory(){directorySnapshot={at:0,promise:null};}
async function eventAuthority(session,{allowCache=false}={}){
 const base=await getVolunteerBase();
 // 花名册不依赖账号与活动证据，放进同一批并发取；此前它串行排在两者之后。
 const [account,events,roster]=await Promise.all([loadSessionAccount(session?.username,{allowCache}),readAuthorityEvents(base),getWorkspaceRoster()]);
 return organizationAuthority(account,base,events,{workspaceRoster:roster});
}
function accountsSnapshotTtlMs(){
 const raw=Number(process.env.PLATFORM_ACCOUNTS_SNAPSHOT_MS);
 return Number.isSafeInteger(raw)&&raw>=0?raw:60_000;
}
/**
 * 账号表整表读取是管理端最贵的一次往返（每页 500 行、跨境逐页）。
 * 花名册与负责人名单只需要展示快照：按 TTL 单飞复用，账号表写入时立即失效。
 * 登录、会话与身份判定仍走 `loadAccountsFromTable` 直读权威源，不复用这里。
 */
let accountsSnapshot={at:0,promise:null};
function invalidateAccountsSnapshot(){accountsSnapshot={at:0,promise:null};}
async function loadAccountsSnapshot(){
 const ttl=accountsSnapshotTtlMs(),now=Date.now();
 if(ttl&&accountsSnapshot.promise&&now-accountsSnapshot.at<ttl)return accountsSnapshot.promise;
 const promise=loadAccountsFromTable(await getIdentityBase());
 accountsSnapshot={at:now,promise};
 // 读取失败不能固化成缓存：失败后下一次调用立即重新取数。
 promise.catch(()=>{if(accountsSnapshot.promise===promise)invalidateAccountsSnapshot();});
 return promise;
}
async function rosterAccounts(){return [...(await loadAccountsSnapshot()).values()];}
const legacyApprovalRouting=createApprovalRouting({store:createApprovalRoutingStore(join(root,process.env.PLATFORM_ACTIVITY_APPROVERS_FILE||'.activity-approvers.json')),organizationMode:organizationEvents,getAccounts:eventDirectory});
async function getWorkspaceRoster(){
  const configured=process.env.PLATFORM_ACTIVITY_WORKSPACE_ROSTER_FILE;
  const path=configured?resolve(root,configured):join(writeStateDir,'activity-workspace-roster.json');
  // 名单文件每次都读（本地磁盘、改动即时生效），只复用账号表的展示快照。
  return readWorkspaceRoster(path,await rosterAccounts());
}
let workspaceRoleStore;
function getWorkspaceRoleStore(){
 const path=process.env.PLATFORM_ACTIVITY_WORKSPACE_ROSTER_FILE?resolve(root,process.env.PLATFORM_ACTIVITY_WORKSPACE_ROSTER_FILE):join(writeStateDir,'activity-workspace-roster.json');
 return workspaceRoleStore??=createWorkspaceRoleStore(path,rosterAccounts);
}
const approvalRouting=createActivityApprovalRouter({legacy:legacyApprovalRouting,getRoster:getWorkspaceRoster});
let workflowInstance, wishlistPending, registrationNotifications;
let registrationDeliveryRunning=false,registrationDeliveryQueued=false;
async function reconcileRegistrationNotifications(data){
 if(registrationDeliveryRunning){registrationDeliveryQueued=true;return;}
 if(process.env.PLATFORM_REGISTRATION_NOTIFICATIONS!=='true')return;
 registrationDeliveryRunning=true;
 try{
  const workflow=await getWorkflow(),notifications=await getRegistrationNotifications(),snapshot=data||await workflow.read();
  await notifications.reconcile(snapshot);
  await notifications.retryReviewed(snapshot,{deliverRoster:workflow.deliverRoster,statuses:getMailDeliveryStatuses});
 }
 finally{registrationDeliveryRunning=false;if(registrationDeliveryQueued){registrationDeliveryQueued=false;queueRegistrationNotifications();}}
}
/**
 * 报名通知写入持久化队列：请求立即返回，发送失败可退避重试，
 * 进程重启后未完成的任务仍然存在。入队失败只降级为告警，
 * 不会把已经成功的业务写入报告为失败。
 */
function queueRegistrationNotifications(){
 try{
  const {created}=jobQueue.enqueue({type:'registration.notifications',dedupeKey:'registration.notifications',maxAttempts:3});
  // 已有在途任务时记一次补跑请求，任务结束后重新入队，避免丢失这次唤醒。
  if(!created)registrationTriggerPending=true;
 }catch{console.warn('Registration notifications could not be queued');}
}
async function runRegistrationNotificationsJob(){
 try{await reconcileRegistrationNotifications();}
 finally{
  if(registrationTriggerPending){registrationTriggerPending=false;queueRegistrationNotifications();}
 }
}
const decisionMailStore=await openDecisionMailStore(join(writeStateDir,'activity-decision-mail.sqlite'),{secret:sessionSecret});
const decisionMail=createDecisionMail({read:async()=>(await getWorkflow()).read(),store:decisionMailStore,origin:process.env.PUBLIC_BASE_URL||'https://njuredcross.cn',
 send:message=>mailerStatus().configured?sendMail(message):Promise.resolve({ok:false,retryable:true,transport:'none'}),
 schedule:task=>setImmediate(()=>{void withoutRequestBudget(task).catch(()=>console.warn('Activity decision mail deferred'));}),onError:()=>console.warn('Activity decision mail requires reconciliation')});
function notifyRegistrationDecisions(items){
 if(process.env.PLATFORM_REGISTRATION_NOTIFICATIONS==='true'){
  const direct=items.filter(item=>item.kind==='reject');
  if(direct.length!==items.length)queueRegistrationNotifications();
  return (direct.length?decisionMail.enqueue(direct):false)||direct.length!==items.length;
 }
 return decisionMail.enqueue(items);
}
let approvalDeliveryRunning=false;
async function reconcileApprovalReminders(){
 if(approvalDeliveryRunning||!organizationEvents||process.env.PLATFORM_REGISTRATION_NOTIFICATIONS!=='true')return;
 approvalDeliveryRunning=true;
 try{
  const events=await readAuthorityEvents(await getVolunteerBase());
  const accounts=events.some(e=>{try{return e['状态']==='待审核'||Boolean(JSON.parse(e['报名页配置']||'{}').publicationNotice);}catch{return false;}})?await eventDirectory():[];
  const regionalReviewers={},regionalEvents=events.filter(event=>{try{return event['状态']==='待审核'&&JSON.parse(event['报名页配置']||'{}').approval?.mode==='workspace-regional';}catch{return false;}});
  if(regionalEvents.length){
   const roster=await getWorkspaceRoster(),routing=createWorkspaceApprovalRouting({getRoster:async()=>roster});
   for(const event of regionalEvents){
    const approval=JSON.parse(event['报名页配置']).approval,ids=approval.levels?.final?.ids||approval.reviewerIds||[];regionalReviewers[event._id]=[];
    for(const id of ids)if((await routing.describe([event],id))[0].approvalAccess.canReview)regionalReviewers[event._id].push(id);
   }
  }
  await (await getRegistrationNotifications()).approvals(events,accounts,{deliver:true,regionalReviewers});
 }finally{approvalDeliveryRunning=false;}
}
function queueApprovalReminders(){
 try{jobQueue.enqueue({type:'approval.reminders',dedupeKey:'approval.reminders',maxAttempts:3});}
 catch{console.warn('Approval reminders could not be queued');}
}
let finalHoursDeliveryRunning=false;
async function reconcileFinalHoursMail(){
 if(finalHoursDeliveryRunning||!mailerStatus().configured)return;
 finalHoursDeliveryRunning=true;
 try{await (await getWorkflow()).deliverPendingFinalHours(sendMail);}finally{finalHoursDeliveryRunning=false;}
}
function queueFinalHoursMail(){setImmediate(()=>{void withoutRequestBudget(reconcileFinalHoursMail).catch(()=>console.warn('Final hours mail deferred for reconciliation'));});}
async function getRegistrationNotifications(){
 const base=await getVolunteerBase();
 if(!registrationNotifications)registrationNotifications=createRegistrationNotifications(base,{send:sendMail,enabled:()=>process.env.PLATFORM_REGISTRATION_NOTIFICATIONS==='true'&&mailerStatus().configured,origin:process.env.PUBLIC_BASE_URL||'https://njuredcross.cn'});
 return registrationNotifications;
}
async function getWishlist(){if(!wishlistPending)wishlistPending=Promise.all([getVolunteerBase(),getWorkflow()]).then(([base,workflow])=>createWishlist(base,workflow,{sendMail,origin:process.env.PUBLIC_BASE_URL||'https://njuredcross.cn'})).catch(error=>{wishlistPending=null;throw error;});return wishlistPending;}

let workspaceDraftStore;
const workspaceDraftQueue=createMutationQueue();
function getWorkspaceDraftStore(){
  if(!workspaceDraftStore){
    const source=workflowMode(process.env).expected;
    const suffix=createHash('sha256').update(source).digest('hex').slice(0,16);
    workspaceDraftStore=openWorkspaceDraftStore(join(writeStateDir,`activity-workspace-${suffix}.sqlite`));
  }
  return workspaceDraftStore;
}
function workspaceDraftAuthorize(actor,authority){
 return createWorkspaceDraftAuthorization({actor,getRoster:getWorkspaceRoster,assertCreate:input=>authority?.assertCreate(input)});
}
async function getWorkspaceDrafts(session,authority){
  const actor=businessAccountRef(session);
  return createWorkspaceDrafts({...getWorkspaceDraftStore(),queue:workspaceDraftQueue,
    getCopyEvent:async id=>{const row=authority?.assertEvent(id);if(!row)throw Object.assign(new Error('正式活动复制需要当前活动权限证据'),{statusCode:403});return row;},
    authorize:workspaceDraftAuthorize(actor,authority),
    getAccess:async(row,actor)=>workspaceDraftAccess(row,actor,await getWorkspaceRoster()),
    validateResponsible:async(content,requested,options)=>{
      if(!content.responsibleId&&!options?.required)return;
      assertWorkspaceResponsible(content,requested,await getWorkspaceRoster(),options);
    },
  });
}
async function getWorkspaceBridge(){
  return createWorkspaceWorkflowBridge({workflow:await getWorkflow(),getRoster:getWorkspaceRoster});
}
async function getWorkspaceSubmissions(session,authority){
  const actor=businessAccountRef(session),drafts=await getWorkspaceDrafts(session,authority),bridge=await getWorkspaceBridge();
  return createWorkspaceSubmissions({...getWorkspaceDraftStore(),queue:workspaceDraftQueue,drafts,authorize:workspaceDraftAuthorize(actor,authority),...bridge});
}
async function getWorkspaceProfileData(accountId,session,authority){
  return readWorkspaceProfileData({
    identityBase:await getIdentityBase(),
    volunteerBase:await getVolunteerBase(),
    baseUuid:String(process.env.SEATABLE_PROFILE_BASE_UUID||'').trim(),
    accountId,
  });
}

async function getWorkflow() {
  const config=workflowMode(process.env);
  const base=await getVolunteerBase();
  if(base.dtableUuid!==config.expected)throw Object.assign(new Error('活动数据源身份不符'),{statusCode:503});
  if(!workflowInstance){
    let hoursSchemaReady=false;
    const stateSuffix=createHash('sha256').update(base.dtableUuid).digest('hex').slice(0,16);
    const activityChangeStore=createActivityChangeStore(join(writeStateDir,`activity-changes-${stateSuffix}.sqlite`));
    workflowInstance=createWorkflow(base,{onSourceLifecycleChanged:()=>invalidateWrittenSnapshots(WF.events),activityLifecycleStore:createActivityLifecycleStore(join(writeStateDir,`activity-lifecycle-${stateSuffix}.sqlite`)),bloodWeekStore:createBloodWeekStore(join(writeStateDir,`blood-week-${stateSuffix}.sqlite`)),activityChangeStore,hoursSubmissionStore:createHoursSubmissionStore(join(writeStateDir,'activity-hours-review.json')),approvalRouting,prepareLeaveDecision:async(event,row,decision)=>{if(process.env.PLATFORM_REGISTRATION_NOTIFICATIONS==='true')await (await getRegistrationNotifications()).prepareLeaveDecision(event,row,decision);},mode:config.mode,bloodSourceTable:config.bloodSourceTable,places:process.env.PLATFORM_ORDINARY_PLACES==='true'?createOrdinaryPlaces(base):null,checkinSecret:process.env.PLATFORM_CHECKIN_SECRET||sessionSecret||'',assertWritable:async()=>{
      if(workflowMode(process.env).expected!==base.dtableUuid)throw new Error('Workflow Base changed');
    },assertHoursWritable:async()=>{
      if(!hoursSchemaReady){
        const metadata=await base.getMetadata();
        const table=metadata.tables?.find(row=>row.name==='网站服务时长明细表');
        if(['工作内容','核对摘要','退回原因','具体工作地点','正式工作日期','备注','修订人','修订时间'].some(name=>!table?.columns?.some(column=>column.name===name&&column.type==='text')))
          throw Object.assign(new Error('时长审核表结构尚未更新，请管理员先预览并完成目标库增列。'),{statusCode:503,code:'workflow_schema_required'});
        hoursSchemaReady=true;
      }
    }});
  }
  return workflowInstance;
}

async function getVolunteerBase() {
  if (!volunteerAccess) throw Object.assign(new Error('Volunteer SeaTable source is not configured'), { statusCode: 503, code: 'volunteer_not_configured' });
  return volunteerAccess();
}

/* --------------------------------------------------------------------------
   State layer — SeaTable is the single source of truth.

   这里的读取遇到错误一律抛出，而不是退化成空结果：SeaTable 是权威数据源，
   取不到表必须表现为错误状态，而不是「没有记录」。唯一例外是审计轨迹 ——
   审计写失败时绝不能中断它正在记录的业务操作。
   -------------------------------------------------------------------------- */
const outreachProjectTable = '宣传项目表';
const outreachSubmissionTable = '宣传投稿表';
const outreachTaskTable = '宣传发布任务表';
const outreachLiaisonTable = LIAISON_TABLE;
const outreachChecklistTable = CHECKLIST_TABLE;

/** 审核链 kind → 中文标签（控制台进度条文案）。 */
const REVIEW_KIND_LABELS = Object.freeze({
  article: '文字稿件 · 两级审核',
  design: '文创设计 · 三级审核',
  brief: '小绿书 · 两级审核',
});
const communityEnrollmentTable = '温暖连接参加表';
const communitySubmissionTable = '温暖连接投稿表';
const auditTable = '操作审计表';

const publicSubmissionSource = '公众投稿';
const consoleEnrollmentSource = '控制台';
const portalEnrollmentSource = '公众端';
const submissionStatusPending = '待审核';
const submissionStatusApproved = '已通过';
const submissionStatusReturned = '需修改';
const submissionStatusRejected = '已拒绝';
const enrollmentStatusPending = '待人工确认';
const enrollmentStatusConfirmed = '已确认';
const enrollmentStatusWithdrawn = '已退出';
const activeEnrollmentStatuses = new Set([enrollmentStatusPending, enrollmentStatusConfirmed]);
function isActiveEnrollmentStatus(status) {
  return activeEnrollmentStatuses.has(String(status || '').trim());
}
function isConfirmedEnrollmentStatus(status) {
  return String(status || '').trim() === enrollmentStatusConfirmed;
}

/** Birthday blessings collect month/day only, and the campus is a closed set. */
const WARMTH_CAMPUS_OPTIONS = ['鼓楼', '仙林', '苏州', '浦口'];
function accountByBusinessRef(ref) {
  const value = String(ref || '').trim();
  if (!value) return null;
  for (const account of accountsByUsername.values()) {
    if (account.accountId === value || account.username === value) return account;
  }
  return null;
}
function isValidBirthdayMonthDay(value) {
  const match = /^(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Probe with a leap year so 02-29 stays valid.
  const probe = new Date(Date.UTC(2024, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}
/** Birthday blessing submissions: one row per blessing a member writes. */
/** 随机匹配与祝福仓库共用的投稿额度；写给挚友不占用此额度。 */
const WARMTH_SUBMISSION_LIMIT = 3;
const WARMTH_DELIVERY_LABELS = Object.freeze({ random: '随机匹配', repository: '祝福仓库', friend: '写给挚友' });
const WARMTH_DELIVERY_KEYS = Object.freeze({ 随机匹配: 'random', 祝福仓库: 'repository', 写给挚友: 'friend' });
const WARMTH_DELIVERY_READY = '可投递';
/** 审核通过的祝福会入库，并按投递方式分成三类，供后续站内展示与投递使用。 */
const blessingLibraryTable = '温暖祝福库表';
const warmthLockTable = '温暖连接操作锁表';
const WARMTH_LOCK_ACTIVE = '锁定';
const WARMTH_LOCK_RELEASED = '已释放';
function warmthStateMaxRows() {
  const configured = Number(process.env.WARMTH_STATE_MAX_ROWS || 20000);
  return Number.isFinite(configured) ? Math.max(5000, Math.min(50000, configured)) : 20000;
}
const LIBRARY_STATUS_ACTIVE = '在库';
const LIBRARY_CATEGORY_BY_DELIVERY = Object.freeze({ 祝福仓库: '祝福仓库', 随机匹配: '一对一随机', 写给挚友: '写给挚友' });
const LIBRARY_CATEGORY_REPOSITORY = '祝福仓库';
const LIBRARY_CATEGORY_RANDOM = '一对一随机';
const LIBRARY_CATEGORY_SENT = '一对一已发过的';
const LIBRARY_CATEGORY_OFFLINE = '已下线的';
/** 生日当天自动投递：邮件 + 站内，一份祝福一条投递记录（幂等）。 */
const blessingDeliveryTable = '温暖祝福投递表';
const DELIVERY_SITE_DONE = '已投递';
const LIBRARY_STATUS_WITHDRAWN = '已撤下';
/** 作者自己删除已通过祝福：同样退出匹配/投递池，但不算「举报撤下」，已送达的收件人仍能看到内容。 */
const LIBRARY_STATUS_DELETED = '作者已删除';
function shouldWithdrawReportedBlessing(status) {
  return ![LIBRARY_STATUS_WITHDRAWN, LIBRARY_STATUS_DELETED].includes(String(status || ''));
}
/** 收件人对已送达祝福的举报：管理端受理成立后会把该祝福从祝福库撤下。 */
const blessingReportTable = '温暖祝福举报表';
const REPORT_STATUS_PENDING = '待处理';
const REPORT_STATUS_HANDLED = '已处理';
const REPORT_STATUS_DISMISSED = '已驳回';
/** 拉黑与踢出：拉黑会同时把成员踢出计划，并在加入/投稿处拦截。 */
const blacklistTable = '温暖连接黑名单表';
const BLACKLIST_ACTIVE = '生效';
const BLACKLIST_RELEASED = '已解除';
const enrollmentStatusKicked = '已踢出';
/**
 * Resolves where a birthday blessing is delivered. 「指定学号」已下线，
 * 投递方式只剩「随机匹配」与「祝福仓库」，两者都直接进入待审核。
 */
function resolveWarmthDelivery() {
  return { ok: true, targetStudentId: '', deliveryState: WARMTH_DELIVERY_READY, status: submissionStatusPending };
}
async function readWarmthBlessings(client, filter = null) {
  const rows = await scopedWarmthRows(client, communitySubmissionTable, { ...filter, 项目: 'birthday' });
  return rows
    .filter((row) => String(row['项目'] || '') === 'birthday')
    .map((row) => {
      const status = String(row['状态'] || submissionStatusPending);
      const pending = status === submissionStatusPending;
      const reviewNote = String(row['审核意见'] || '');
      const reviewedAt = row['审核时间'] || null;
      return {
        id: String(row['投稿ID'] || ''),
        program: 'birthday',
        content: String(row['内容'] || ''),
        actor: String(row['提交人'] || ''),
        nickname: String(row['署名昵称'] || ''),
        status,
        delivery: String(row['投递方式'] || ''),
        deliveryKey: WARMTH_DELIVERY_KEYS[String(row['投递方式'] || '')] || '',
        targetStudentId: String(row['目标学号'] || ''),
        friendEmail: String(row['挚友邮箱'] || ''),
        friendBirthday: String(row['挚友生日'] || ''),
        scheduledDate: String(row['计划投递日期'] || ''),
        deliveryState: String(row['投递条件'] || WARMTH_DELIVERY_READY),
        reviewNote: pending ? '' : reviewNote,
        reviewedAt: pending ? null : reviewedAt,
        previousReviewNote: pending ? reviewNote : '',
        previousReviewedAt: pending ? reviewedAt : null,
        submittedAt: row['提交时间'] || null,
      };
    })
    .sort(byDateDesc('submittedAt'));
}

async function readBlessingLibrary(client, filter = null, { classifySent = true } = {}) {
  const rows = await scopedWarmthRows(client, blessingLibraryTable, filter);
  const randomIds = rows.filter(row => row['分类'] === LIBRARY_CATEGORY_RANDOM)
    .map(row => String(row['投稿ID'] || '')).filter(Boolean);
  const deliveryRows = classifySent ? await scopedWarmthRows(client, blessingDeliveryTable,
    { 投稿ID: randomIds, 站内状态: DELIVERY_SITE_DONE }) : [];
  const sentIds = new Set(
    deliveryRows
      .filter((row) => String(row['站内状态'] || '') === DELIVERY_SITE_DONE)
      .map((row) => String(row['投稿ID'] || ''))
      .filter(Boolean),
  );
  return rows
    .map((row) => {
      const submissionId = String(row['投稿ID'] || '');
      const status = String(row['状态'] || '');
      const rawCategory = String(row['分类'] || '');
      const category = status === LIBRARY_STATUS_ACTIVE
        ? (rawCategory === LIBRARY_CATEGORY_RANDOM && sentIds.has(submissionId) ? LIBRARY_CATEGORY_SENT : rawCategory)
        : LIBRARY_CATEGORY_OFFLINE;
      return {
        id: String(row['入库ID'] || ''),
        submissionId,
        program: String(row['项目'] || ''),
        category,
        content: String(row['内容'] || ''),
        nickname: String(row['署名昵称'] || ''),
        targetStudentId: String(row['目标学号'] || ''),
        submitter: String(row['来源投稿人'] || ''),
        status,
        reviewer: String(row['审核人'] || ''),
        storedAt: row['入库时间'] || null,
      };
    })
    .sort(byDateDesc('storedAt'));
}

/**
 * Ingests an approved submission into the blessing library, classified by its
 * delivery mode. Idempotent: a re-approved submission updates its existing row
 * instead of adding a second one (keyed by 投稿ID).
 */
async function ingestApprovedBlessing(client, submission, reviewer, storedAt) {
  if (String(submission['项目'] || '') !== 'birthday') return null;
  const submissionId = String(submission['投稿ID'] || '');
  const category = LIBRARY_CATEGORY_BY_DELIVERY[String(submission['投递方式'] || '')];
  if (!submissionId || !category) return null;
  const patch = {
    项目: 'birthday',
    分类: category,
    内容: String(submission['内容'] || ''),
    署名昵称: String(submission['署名昵称'] || ''),
    目标学号: '',
    来源投稿人: String(submission['提交人'] || ''),
    状态: LIBRARY_STATUS_ACTIVE,
    审核人: reviewer,
    入库时间: storedAt,
  };
  const existing = (await scopedWarmthRows(client, blessingLibraryTable, { 投稿ID: submissionId })).find((row) => String(row['投稿ID'] || '') === submissionId);
  if (existing) {
    await client.updateRow(blessingLibraryTable, existing._id, patch);
    return String(existing['入库ID'] || '');
  }
  const libraryId = eventIdentifier('LIB');
  await client.appendRow(blessingLibraryTable, { 入库ID: libraryId, 投稿ID: submissionId, ...patch });
  return libraryId;
}

async function readWarmthBlacklist(client, filter = null) {
  const rows = await scopedWarmthRows(client, blacklistTable, filter);
  return rows
    .map((row) => ({
      id: String(row['黑名单ID'] || ''),
      participantRef: String(row['参与者标识'] || ''),
      studentId: String(row['学号'] || ''),
      realName: String(accountByBusinessRef(row['参与者标识'])?.realName || ''),
      reason: String(row['原因'] || ''),
      status: String(row['状态'] || BLACKLIST_ACTIVE),
      handledBy: String(row['操作人'] || ''),
      createdAt: row['拉黑时间'] || null,
      releasedAt: row['解除时间'] || null,
    }))
    .sort(byDateDesc('createdAt'));
}

/** 拉黑某成员：写黑名单、踢出仍有生效的登记、并按原因邮件通知本人。 */
async function blacklistParticipant(client, { participantRef, reason, operator }) {
  const rawRef = String(participantRef || '').trim();
  if (!rawRef) throw httpError(400, '缺少成员标识，无法拉黑。');
  const account = accountByBusinessRef(rawRef);
  // 统一存账号ID：公众端用账号ID、控制台曾用登录名，两套标识会让拦截失效。
  const canonicalRef = account?.accountId || rawRef;
  const existing = (await readWarmthBlacklist(client, { 参与者标识: canonicalRef })).find((item) => item.participantRef === canonicalRef && item.status === BLACKLIST_ACTIVE);
  const blacklistId = existing?.id || eventIdentifier('BLK');
  if (!existing) {
    await client.appendRow(blacklistTable, {
      黑名单ID: blacklistId,
      参与者标识: canonicalRef,
      学号: String(account?.studentId || ''),
      原因: reason,
      状态: BLACKLIST_ACTIVE,
      操作人: operator,
      拉黑时间: new Date().toISOString(),
      解除时间: '',
    });
  }
  const refKeys = new Set([canonicalRef, rawRef, account?.username, account?.studentId].filter(Boolean).map(String));
  const activeRow = (await readEnrollmentRows(client, { 参与者标识: [...refKeys] })).find((row) => refKeys.has(String(row['参与者标识'] || '')) && isActiveEnrollmentStatus(row['状态']));
  if (activeRow) {
    await updateEnrollment(client, String(activeRow['登记ID'] || ''), { 状态: enrollmentStatusKicked, 处理人: operator, 处理时间: new Date().toISOString() });
  }
  const mail = await sendMail({
    to: String(account?.email || '').trim(),
    subject: '关于你的生日祝福计划参与资格',
    text: `你已被移出南京大学红十字会生日祝福计划，并暂停参与资格。\n\n原因：${reason}\n\n如有疑问请联系平台管理员。\n\n南京大学红十字会`,
    kind: 'warmth-blacklist',
    idempotencyKey: `WARMTH-BLACKLIST:${blacklistId}`,
  });
  return { id: blacklistId, notified: mail.ok };
}

/** 是否处于生效中的拉黑状态（用于拦截加入与投稿）。 */
/** 多键匹配：账号ID / 登录名 / 学号任一命中即视为拉黑，兼容历史两套标识。 */
async function isWarmthBlacklisted(client, ref) {
  const value = String(ref || '').trim();
  if (!value) return false;
  const account = accountByBusinessRef(value);
  const keys = new Set([value, account?.accountId, account?.username, account?.studentId].filter(Boolean).map(String));
  return (await readWarmthBlacklist(client, [{ 参与者标识: [...keys] }, { 学号: [...keys] }])).some((entry) => entry.status === BLACKLIST_ACTIVE
    && (keys.has(String(entry.participantRef || '')) || (entry.studentId && keys.has(String(entry.studentId)))));
}

/** 解除某成员的黑名单：解除生效中的记录，并把被踢出的登记恢复为「已确认」。 */
async function releaseBlacklistForRef(client, ref, operator) {
  const account = [...accountsByUsername.values()].find((item) => item.accountId === ref || item.username === ref || String(item.studentId || '') === ref);
  const keys = new Set([ref, account?.accountId, account?.username, account?.studentId].filter(Boolean).map(String));
  let released = 0;
  for (const row of await scopedWarmthRows(client, blacklistTable, [{ 参与者标识: [...keys] }, { 学号: [...keys] }])) {
    if (String(row['状态'] || '') !== BLACKLIST_ACTIVE) continue;
    if (!keys.has(String(row['参与者标识'] || '')) && !(row['学号'] && keys.has(String(row['学号'])))) continue;
    await client.updateRow(blacklistTable, row._id, { 状态: BLACKLIST_RELEASED, 解除时间: new Date().toISOString() });
    released += 1;
  }
  let restored = 0;
  for (const row of await readEnrollmentRows(client, { 参与者标识: [...keys] })) {
    if (String(row['状态'] || '') !== enrollmentStatusKicked) continue;
    if (!keys.has(String(row['参与者标识'] || ''))) continue;
    await updateEnrollment(client, String(row['登记ID'] || ''), { 状态: enrollmentStatusConfirmed, 处理人: operator, 处理时间: new Date().toISOString() });
    restored += 1;
  }
  return { released, restored };
}


async function readWarmthReports(client, filter = null) {
  const rows = await scopedWarmthRows(client, blessingReportTable, filter);
  return rows
    .map((row) => ({
      id: String(row['举报ID'] || ''),
      submissionId: String(row['投稿ID'] || ''),
      reporterRef: String(row['举报人标识'] || ''),
      // 学号不落库冗余存储，按举报人标识实时解析（隐私最小化）
      reporterStudentId: String(accountByBusinessRef(row['举报人标识'])?.studentId || ''),
      reason: String(row['原因'] || ''),
      status: String(row['状态'] || REPORT_STATUS_PENDING),
      handledBy: String(row['处理人'] || ''),
      resolutionNote: String(row['处理意见'] || ''),
      handledAt: row['处理时间'] || null,
      acknowledgedAt: row['举报人确认时间'] || null,
      submittedAt: row['提交时间'] || null,
    }))
    .sort(byDateDesc('submittedAt'));
}

function pickRandom(list, count) {
  const pool = [...list];
  const picked = [];
  while (picked.length < count && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}

async function readWarmthDeliveries(client, filter = null) {
  const rows = await scopedWarmthRows(client, blessingDeliveryTable, filter);
  return rows
    .map((row) => ({
      id: String(row['投递ID'] || ''),
      submissionId: String(row['投稿ID'] || ''),
      recipientRef: String(row['收件人标识'] || ''),
      studentId: String(row['收件人学号'] || ''),
      triggerDay: String(row['触发日期'] || ''),
      source: String(row['来源'] || ''),
      mailStatus: String(row['邮件状态'] || ''),
      siteStatus: String(row['站内状态'] || ''),
      deliveredAt: row['投递时间'] || null,
      failureReason: String(row['失败原因'] || ''),
    }))
    .sort(byDateDesc('deliveredAt'));
}

/** 服务端所在时区无关的「Asia/Shanghai 的 MM-DD」。 */
function shanghaiMonthDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value || '';
  const day = parts.find((part) => part.type === 'day')?.value || '';
  return `${month}-${day}`;
}

/** 写信时间的人类可读粗粒度标签（年月日 + 早/下/晚），对外只发这个，不下发精确时间戳。 */
function shanghaiOriginLabel(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  const hour = Number(get('hour')) % 24;
  const period = hour >= 5 && hour < 12 ? '早上' : hour >= 12 && hour < 18 ? '下午' : '晚上';
  return `${get('year')}年${get('month')}月${get('day')}日 ${period}`;
}

/** Asia/Shanghai 的年份（投递幂等按「年 + 月日」判定，避免跨年同月日被误判为已投递）。 */
function shanghaiYear(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(date);
}

/**
 * 每天 08:00 的运行体：找出当天过生日、且已确认加入的成员，按本人
 * 「随机匹配 + 祝福仓库」的已通过条数，从「一对一随机」池匹配等量条数
 * （排除自己写的、排除已被匹配走的），池子不足时用祝福仓库补足差额；完全没有写过时，从「祝福仓库」池随机抽取一条。
 * 通过邮件发送，并写入站内投递记录；没有可用祝福时不做任何事。
 */
async function runWarmthBirthdayDelivery(client, { now = new Date(), onlyDay = null } = {}) {
  const day = onlyDay || shanghaiMonthDay(now);
  const year = shanghaiYear(now);
  return withWarmthLock(client, `warmth-delivery:${year}:${day}`, () => runWarmthBirthdayDeliveryUnlocked(client, { now, onlyDay }), { ttlMs: 30 * 60 * 1000, waitMs: 60 * 1000 });
}

async function communityNoticeAccount(ref) {
  const cached = accountByBusinessRef(ref);
  return findAccountByLogin(await getIdentityBase(), cached?.username || String(ref));
}

async function notifyBirthdayReview(row, patch, reviewedAt) {
  if (row['项目'] !== 'birthday') return;
  return notifyCommunityReview({ row: { ...row, ...patch }, status: patch['状态'], reviewedAt,
    accountForRef: communityNoticeAccount, send: message => sendMail(message, { renderTemplate: false }), origin: publicBaseUrl });
}

async function runFriendBirthdayBatch(client, now = new Date()) {
  if (!friendSchemaReady(await client.getMetadata())) return;
  const due = await scopedWarmthRows(client, communitySubmissionTable, {
    项目: 'birthday', 投递方式: '写给挚友', 状态: submissionStatusApproved, 计划投递日期: friendDeliveryDate(now),
  });
  for (const candidate of due) {
    const id = String(candidate['投稿ID'] || '');
    if (!id) continue;
    await withWarmthLock(client, `warmth-blessing:${id}`, async () => {
      const [submissions, library, deliveries] = await Promise.all([
        scopedWarmthRows(client, communitySubmissionTable, { 投稿ID: id }),
        scopedWarmthRows(client, blessingLibraryTable, { 投稿ID: id }),
        scopedWarmthRows(client, blessingDeliveryTable, { 投稿ID: id }),
      ]);
      await deliverFriendBlessings({ client, submissions, library, deliveries, now, identifier: eventIdentifier,
        onDelivered: (blessing, receipt) => notifyBlessingDelivered({ blessing, receipt, accountForRef: communityNoticeAccount,
          send: message => sendMail(message, { renderTemplate: false }), origin: publicBaseUrl }),
        eligibleAuthor: async username => {
          const account = await findAccountByLogin(await getIdentityBase(), username);
          if (!account || !isAccountActive(account)) return false;
          const ref = account.accountId || account.username;
          if (await isWarmthBlacklisted(client, ref)) return false;
          return (await readWarmthInterests(client, { 参与者标识: [ref] })).some(item =>
            item.program === 'birthday' && item.participantRef === ref && isConfirmedEnrollmentStatus(item.status));
        },
        send: message => sendMail(message, { renderTemplate: false }),
      });
    });
  }
}

async function runWarmthBirthdayDeliveryUnlocked(client, { now = new Date(), onlyDay = null } = {}) {
  const day = onlyDay || shanghaiMonthDay(now);
  const year = shanghaiYear(now);
  const [enrollments, library, existingRows, libraryRows] = await Promise.all([
    readWarmthInterests(client),
    readBlessingLibrary(client),
    warmthRows(client, blessingDeliveryTable),
    warmthRows(client, blessingLibraryTable),
  ]);
  const libraryRowByBusinessId = new Map(libraryRows.map((row) => [String(row['入库ID'] || ''), row]));
  const blacklist = await readWarmthBlacklist(client);
  const blockedEntries = blacklist.filter((entry) => entry.status === BLACKLIST_ACTIVE);
  const isBlocked = (item) => blockedEntries.some((entry) => {
    const account = accountByBusinessRef(item.participantRef);
    const keys = new Set([item.participantRef, account?.accountId, account?.username, account?.studentId].filter(Boolean).map(String));
    return keys.has(String(entry.participantRef || '')) || (entry.studentId && keys.has(String(entry.studentId)));
  });
  const recipients = enrollments.filter((item) => item.program === 'birthday' && isConfirmedEnrollmentStatus(item.status) && isBirthdayOn(item, `${year}-${day}`) && !isBlocked(item));
  const deliveredAt = now.toISOString();
  const summary = { day, recipients: recipients.length, matched: 0, repository: 0, delivered: 0, mailed: 0, retried: 0, records: [] };
  const deliveries = [...existingRows];

  async function deliver({ blessing, recipient, studentId, account, source }) {
    const existing = deliveries.find((row) => String(row['投稿ID'] || '') === blessing.submissionId
      && String(row['收件人学号'] || '') === studentId
      && String(row['触发日期'] || '') === day
      && String(row['触发年份'] || '') === year);
    if (existing && String(existing['站内状态'] || '') === DELIVERY_SITE_DONE) return false;
    const mail = await sendMail({
      to: String(account?.email || '').trim(),
      subject: '南京大学红十字会｜今天有人给你写了生日祝福',
      text: `今天是你的生日，这里有一段祝福：\n\n${blessing.content}\n\n—— ${blessing.nickname || '一位同学'}\n\n（平台在你生日当天自动送达；也可以登录网站查看。）`,
      kind: 'warmth-birthday',
      idempotencyKey: `WARMTH-BIRTHDAY:${blessing.submissionId}:${studentId}:${year}-${day}`,
    });
    const mailStatus = mail.ok ? '已发送' : (mail.skipped ? '未发送' : '发送失败');
    const patchRow = {
      投稿ID: blessing.submissionId,
      收件人标识: recipient.participantRef,
      收件人学号: studentId,
      触发日期: day,
      触发年份: year,
      来源: source,
      邮件状态: mailStatus,
      站内状态: DELIVERY_SITE_DONE,
      投递时间: deliveredAt,
      失败原因: mail.ok ? '' : String(mail.reason || ''),
    };
    if (existing) {
      await client.updateRow(blessingDeliveryTable, existing._id, patchRow);
    } else {
      const row = { 投递ID: eventIdentifier('DLV'), ...patchRow };
      await client.appendRow(blessingDeliveryTable, row);
      deliveries.push(row);
    }
    if (blessing.category === LIBRARY_CATEGORY_RANDOM) {
      blessing.category = LIBRARY_CATEGORY_SENT;
      const libraryRow = libraryRowByBusinessId.get(String(blessing.id || ''));
      if (libraryRow) await client.updateRow(blessingLibraryTable, libraryRow._id, { 分类: LIBRARY_CATEGORY_SENT });
    }
    summary.delivered += 1;
    if (mail.ok) summary.mailed += 1;
    summary.records.push({ submissionId: blessing.submissionId, studentId, source, mailStatus });
    return true;
  }

  for (const recipient of recipients) {
    const account = accountByBusinessRef(recipient.participantRef);
    const studentId = String(account?.studentId || recipient.studentId || '').trim();
    if (!studentId) continue;
    const active = library.filter((item) => item.status === LIBRARY_STATUS_ACTIVE);

    const mine = active.filter((item) => item.submitter && item.submitter === account?.username);
    // 「随机匹配」与「祝福仓库」的已通过投稿都换取等量一对一；「指定给某人」不计入。
    const earnCount = mine.filter((item) => (item.category === '一对一随机' || item.category === '祝福仓库') || item.category === '一对一已发过的').length;
    const quota = birthdayDeliveryQuota(deliveries, { studentId, day, year, earned: earnCount, doneStatus: DELIVERY_SITE_DONE });
    if (!quota.remaining) continue;
    const repositoryPool = () => active.filter((item) => item.category === '祝福仓库' && item.submitter !== account?.username && !quota.completedSubmissionIds.has(item.submissionId));
    if (earnCount > 0) {
      const consumed = new Set(deliveries.map((row) => String(row['投稿ID'] || '')));
      const randomPool = active.filter((item) => item.category === '一对一随机' && item.submitter !== account?.username && !consumed.has(item.submissionId));
      let fromRandom = 0;
      for (const blessing of pickRandom(randomPool, quota.remaining)) {
        if (await deliver({ blessing, recipient, studentId, account, source: '一对一匹配' })) { summary.matched += 1; fromRandom += 1; }
      }
      // 一对一随机池不足时，用祝福仓库（可重复调用、排除自己写的）补足差额，尽量保证每位收件人都能收到祝福
      const shortfall = quota.remaining - fromRandom;
      for (const blessing of pickRandom(repositoryPool(), shortfall)) {
        if (await deliver({ blessing, recipient, studentId, account, source: '仓库抽取' })) summary.repository += 1;
      }
    } else {
      // 完全没写过（或只写过指定给某人的）→ 从祝福仓库随机抽 1 条
      for (const blessing of pickRandom(repositoryPool(), 1)) {
        if (await deliver({ blessing, recipient, studentId, account, source: '仓库抽取' })) summary.repository += 1;
      }
    }
  }
  // 邮件失败重投：当天邮件未成功的投递记录再试一次（幂等键保证成功过的不重发）
  for (const row of await warmthRows(client, blessingDeliveryTable)) {
    if (String(row['来源'] || '') === '写给挚友') continue;
    if (String(row['触发日期'] || '') !== day || String(row['触发年份'] || '') !== year) continue;
    if (String(row['邮件状态'] || '') === '已发送') continue;
    const submissionId = String(row['投稿ID'] || '');
    const studentId = String(row['收件人学号'] || '');
    const blessing = library.find((item) => item.submissionId === submissionId);
    if (!blessing) continue;
    const account = accountByBusinessRef(row['收件人标识']);
    const mail = await sendMail({
      to: String(account?.email || '').trim(),
      subject: '南京大学红十字会｜今天有人给你写了生日祝福',
      text: `今天是你的生日，这里有一段祝福：\n\n${blessing.content}\n\n—— ${blessing.nickname || '一位同学'}\n\n（平台在你生日当天自动送达；也可以登录网站查看。）`,
      kind: 'warmth-birthday',
      idempotencyKey: `WARMTH-BIRTHDAY:${submissionId}:${studentId}:${year}-${day}`,
    });
    if (mail.ok) {
      await client.updateRow(blessingDeliveryTable, row._id, { 邮件状态: '已发送', 失败原因: '' });
      summary.retried += 1;
    }
  }
  // Replay only today's receipts; the per-delivery mail key prevents repeat notices.
  for (const receipt of deliveries) {
    if (String(receipt['触发日期'] || '') !== day || String(receipt['触发年份'] || '') !== year || receipt['来源'] === '写给挚友') continue;
    const blessing = library.find(item => item.submissionId === String(receipt['投稿ID'] || ''));
    if (blessing) await notifyBlessingDelivered({ blessing, receipt, accountForRef: communityNoticeAccount,
      send: message => sendMail(message, { renderTemplate: false }), origin: publicBaseUrl });
  }
  return summary;
}

/**
 * v3 文创类型字典（第 5/15 项）。
 * 服务端权威下发；前端不再硬编码。与制度里的「海报规格」类目对齐。
 */
const DESIGN_CATEGORIES_DICT = Object.freeze(['徽章', '贴纸', '卡牌', '表情包', '海报', '文创周边', '其他']);

/** Canonical review status → the decision vocabulary the API speaks. */
function reviewDecisionFromStatus(value) {
  const status = String(value || '').trim();
  if (status === submissionStatusApproved) return 'approve';
  if (status === submissionStatusReturned) return 'return';
  if (status === submissionStatusRejected) return 'reject';
  return null;
}
function statusFromReviewDecision(decision) {
  if (decision === 'approve') return submissionStatusApproved;
  if (decision === 'reject') return submissionStatusRejected;
  return submissionStatusReturned;
}

/**
 * SeaTable listRows is paged. A hard-coded limit silently turns totals into
 * lower bounds, so operational aggregates must read until the table ends.
 * The non-enumerable readMeta property lets callers expose truncation without
 * changing the array contract used throughout the current API layer.
 */
async function listAllRows(client, tableName, options = {}) {
  return displayRead(client, JSON.stringify(['rows', tableName, options]), () => loadAllRows(client, tableName, options), 5_000, [tableName]);
}
async function loadAllRows(client, tableName, options = {}) {
  return readPagedRows(client, tableName, {
    requireComplete: true,
    ...options,
  });
}


function readMeta(rows) {
  return rows?.readMeta || { total: Array.isArray(rows) ? rows.length : 0, truncated: false, maxRows: null };
}

function reviewFromRow(row) {
  const decision = reviewDecisionFromStatus(row['审核状态']);
  if (!decision) return null;
  return {
    decision,
    note: String(row['审核意见'] || ''),
    reviewer: String(row['审核人'] || ''),
    reviewedAt: row['审核时间'] || null,
  };
}
function stateRows(client, tableName, maxRows = 5000) {
  return listAllRows(client, tableName, {
    maxRows,
    requireComplete: true,
  });
}
/**
 * Warmth reads are used for quota, deduplication, audit and delivery decisions.
 * Refuse to make those decisions from a silently truncated first page.
 */
async function warmthRows(client, tableName, maxRows = null) {
  const limit = Number.isFinite(maxRows) && maxRows > 0 ? maxRows : warmthStateMaxRows();
  const rows = await stateRows(client, tableName, limit);
  assertCompleteRows(rows);
  return rows;
}
// Targeted operational reads bypass the display cache, including lock rechecks.
async function scopedWarmthRows(client, tableName, filter = null) {
  if (filter === null) return warmthRows(client, tableName);
  return readCommunityRows(client, tableName, filter, loadAllRows, { maxRows: warmthStateMaxRows() });
}

/** Newest first. Table order is insertion order, which is not display order. */
function byDateDesc(field) {
  return (left, right) => String(right[field] || '').localeCompare(String(left[field] || ''));
}

function auditIdentityRef(value) {
  const account = accountsByUsername.get(value);
  return account?.accountId || (/^ACC-/.test(value) ? value : 'REF-' + sign(String(value)).slice(0,24));
}

const auditWriteHealth = createAuditWriteHealth();

async function recordAudit(
  req,
  session,
  action,
  target,
  result = 'success',
  metadata = {},
  { strict = false } = {},
) {
  const acknowledgement = await auditWriteHealth.write(async () => {
    const keys = Object.keys(metadata || {});
    const row = {
      审计ID: eventIdentifier('AUD'),
      时间: new Date().toISOString(),
      操作人: action.startsWith('identity.')
        ? auditIdentityRef(session?.username || 'anonymous')
        : (session?.username || 'anonymous'),
      角色: session?.role || 'unknown',
      动作: action,
      对象: action.startsWith('identity.')
        ? auditIdentityRef(String(target || ''))
        : String(target || ''),
      结果: result,
      IP: action.startsWith('identity.')
        ? auditIdentityRef(clientIp(req))
        : clientIp(req),
      备注: keys.length ? JSON.stringify(metadata) : '',
    };

    if (auditReconciliationStore) {
      return persistAuditRecord({
        store: auditReconciliationStore,
        getBase,
        baseUuid: auditBaseUuid,
        row,
      });
    }

    const client = await getBase();
    await client.appendRow(auditTable, row);
  });

  if (strict && !acknowledgement.confirmed) {
    throw httpError(
      503,
      '操作留痕暂未完成，请刷新查看当前状态后联系管理员。',
    );
  }

  return acknowledgement;
}

async function readRecentAudit(limit = 50) {
  const client = await getBase();
  const rows = await stateRows(client, auditTable);

  return rows
    .map(row => ({
      at: row['时间'] || null,
      actor: String(row['操作人'] || 'anonymous'),
      role: String(row['角色'] || 'unknown'),
      action: String(row['动作'] || ''),
      target: String(row['对象'] || ''),
      result: String(row['结果'] || ''),
      ip: String(row['IP'] || ''),
      metadata: (() => {
        try {
          return row['备注'] ? JSON.parse(row['备注']) : {};
        } catch {
          return {};
        }
      })(),
    }))
    .sort(byDateDesc('at'))
    .slice(0, Math.min(Math.max(limit, 1), 200));
}

/* --- 宣传投稿表: public submissions and legacy-content review conclusions --- */

async function readOutreachSubmissionRows(client) {
  return stateRows(client, outreachSubmissionTable);
}

async function readOutreachReviews(client) {
  const rows = await readOutreachSubmissionRows(client);
  const reviews = {};
  for (const row of rows) {
    if (String(row['来源'] || '') === publicSubmissionSource) continue;
    const review = reviewFromRow(row);
    if (!review) continue;
    const id = String(row['投稿ID'] || '');
    if (id) reviews[id] = review;
  }
  return reviews;
}

async function readPublicSubmissions(client) {
  const rows = await readOutreachSubmissionRows(client);
  return rows
    .filter((row) => String(row['来源'] || '') === publicSubmissionSource)
    .map((row) => ({
      id: String(row['投稿ID'] || ''),
      title: String(row['标题'] || ''),
      content: String(row['正文'] || ''),
      category: String(row['类别'] || ''),
      signature: String(row['对外署名'] || ''),
      contactName: String(row['联系人'] || ''),
      contactEmail: String(row['联系邮箱'] || ''),
      // Account username for submissions made after the portal gained login;
      // older rows carry only the mailbox, which the field falls back to.
      submitterRef: String(row['投稿人引用'] || ''),
      // v2 文创设计投稿（笔名匿名）扩展列；文字稿件行带实名回填。
      designCategory: String(row['文创类别'] || ''),
      workTitle: String(row['作品标题'] || ''),
      studentId: String(row['学号'] || ''),
      // v3 扩展列：笔名快照 + 多级审核 + 栏目 + 发布形式
      penName: String(row['笔名'] || ''),
      articleCategory: String(row['推文类别'] || ''),
      reviewLevel: String(row['审核层级'] || ''),
      reviewTrail: String(row['审核轨迹'] || ''),
      reviewFile: String(row['审核意见文件'] || ''),
      publishForm: String(row['发布形式'] || ''),
      editor: String(row['美编人'] || ''),
      originalConfirm: String(row['原创确认'] || '') === '已确认',
      portraitConfirm: String(row['肖像授权'] || '') === '已确认',
      status: String(row['审核状态'] || submissionStatusPending),
      submittedAt: row['提交时间'] || null,
      review: reviewFromRow(row),
      attachmentIds: parseAttachmentRefs(String(row['附件引用'] || '')),
    }))
    .sort(byDateDesc('submittedAt'));
}

function publicSubmissionRow(submission) {
  return {
    投稿ID: submission.id,
    来源: publicSubmissionSource,
    项目ID: '',
    类别: submission.category,
    标题: submission.title,
    正文: submission.content,
    附件引用: Array.isArray(submission.attachmentIds) && submission.attachmentIds.length
      ? formatAttachmentRefs(submission.attachmentIds)
      : '',
    // Account username when the portal was signed in; the contact mailbox is
    // kept as the fallback so rows written before the login requirement are
    // still attributable.
    投稿人引用: submission.submitterRef || submission.contactEmail,
    联系人: submission.contactName,
    联系邮箱: submission.contactEmail,
    对外署名: submission.signature,
    公开范围: '',
    原创确认: submission.originalConfirm ? '已确认' : '未确认',
    肖像授权: submission.portraitConfirm ? '已确认' : '未确认',
    同意版本: submission.consentVersion,
    审核状态: submissionStatusPending,
    审核意见: '',
    审核人: '',
    提交时间: submission.submittedAt,
    审核时间: '',
    // v2 扩展列：文创设计投稿写文创类别/作品标题（笔名匿名，实名列留空）；
    // 文字稿件写学号（实名回填），文创类别/作品标题留空。
    文创类别: submission.designCategory || '',
    美编人: '',
    作品标题: submission.workTitle || '',
    学号: submission.studentId || '',
    // v3 扩展列：笔名绑定快照 + 多级审核 + 栏目 + 发布形式
    笔名: submission.penName || (submission.signature && submission.category === '文创设计' ? submission.signature : ''),
    推文类别: submission.articleCategory || '',
    审核层级: '',
    审核轨迹: '',
    审核意见文件: '',
    发布形式: submission.publishForm || '',
  };
}

/**
 * Reviews of legacy content (策划案 / 文创征集) live in the same
 * table, keyed by the same content id the API exposes, so one table answers
 * "what has been reviewed and what did we decide".
 */
async function saveOutreachReview(client, contentId, review, item) {
  const rows = await readOutreachSubmissionRows(client);
  const existing = rows.find((row) => String(row['投稿ID'] || '') === contentId);
  const patch = {
    审核状态: statusFromReviewDecision(review.decision),
    审核意见: review.note || '',
    审核人: review.reviewer,
    审核时间: review.reviewedAt,
  };
  if (existing) return client.updateRow(outreachSubmissionTable, existing._id, patch);
  return client.appendRow(outreachSubmissionTable, {
    投稿ID: contentId,
    来源: item?.type || '遗留内容',
    项目ID: '',
    类别: item?.type || '',
    标题: item?.title || contentId,
    正文: item?.summary || '',
    附件引用: '',
    投稿人引用: '',
    联系人: '',
    联系邮箱: '',
    对外署名: '',
    公开范围: '',
    原创确认: '',
    肖像授权: '',
    同意版本: 'v1',
    提交时间: item?.submittedAt || '',
    ...patch,
  });
}

/* --- v3 多级审核：对接人 / 清单模板 读取 --- */

async function readOutreachAssignees(client) {
  try {
    const rows = await stateRows(client, outreachLiaisonTable);
    // 注意：pickAssignee 读的是 SeaTable 原始中文列名，这里必须同时保留中文键，
    // 否则「按栏目选人」会静默返回空名单（英文别名只供前端 directory 展示用）。
    return rows.map((row) => ({
      id: String(row['对接人ID'] || ''),
      name: String(row['姓名'] || ''),
      category: String(row['负责栏目'] || ''),
      role: String(row['角色'] || ''),
      email: String(row['邮箱'] || ''),
      enabled: String(row['启用'] ?? '是') !== '否',
      '对接人ID': String(row['对接人ID'] || ''),
      '姓名': String(row['姓名'] || ''),
      '负责栏目': String(row['负责栏目'] || ''),
      '角色': String(row['角色'] || ''),
      '邮箱': String(row['邮箱'] || ''),
      '启用': String(row['启用'] ?? '是'),
    }));
  } catch {
    // 展示可降级；写入仍须通过 authorizeReviewStep 的身份门禁。
    return [];
  }
}

async function readChecklist(client) {
  try {
    const rows = await stateRows(client, outreachChecklistTable);
    return rows
      .filter((row) => String(row['启用'] ?? '是') !== '否')
      .map((row) => ({
        id: String(row['模板ID'] || ''),
        kind: String(row['适用类型'] || ''),
        category: String(row['类别'] || ''),
        item: String(row['检查项'] || ''),
        standard: String(row['标准'] || ''),
        order: toFiniteNumber(row['排序']),
      }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch {
    throw Object.assign(new Error('审核清单读取失败，请管理员检查表结构与访问权限。'), { statusCode: 503, code: 'outreach_checklist_unavailable' });
  }
}

/** 把投稿行（原始行或领域对象）转成审核状态机所需的形状。 */
function reviewShapeOf(source) {
  return {
    id: String(source['投稿ID'] || source.id || ''),
    title: String(source['标题'] || source.title || ''),
    category: String(source['类别'] || source.category || ''),
    publishForm: normalizePublishForm(source['发布形式'] || source.publishForm),
    reviewLevel: String(source['审核层级'] ?? source.reviewLevel ?? ''),
    reviewTrail: String(source['审核轨迹'] ?? source.reviewTrail ?? ''),
    status: String(source['审核状态'] || source.status || submissionStatusPending),
    editor: String(source['美编人'] || source.editor || ''),
    articleCategory: String(source['推文类别'] || source.articleCategory || ''),
  };
}

/** 审核链视图：给控制台渲染进度条用。 */
function reviewChainView(source, assignees = []) {
  const shape = reviewShapeOf(source);
  const kind = submissionKindFor({ category: shape.category, publishForm: shape.publishForm });
  const state = reviewFlow.chainStateFor({ ...shape, reviewTrail: shape.reviewTrail });
  const picked = reviewFlow.assigneesForCategory(assignees, shape.articleCategory || shape.category);
  const trail = parseReviewTrail(shape.reviewTrail);
  const currentLevel = state.current?.level || state.total;
  return {
    kind,
    kindLabel: REVIEW_KIND_LABELS[kind] || '审核链',
    status: shape.status,
    category: shape.articleCategory || shape.category,
    publishForm: shape.publishForm,
    passed: state.passed,
    total: state.total,
    done: state.done,
    schedulable: canSchedule({ kind, reviewLevel: shape.reviewLevel, reviewTrail: shape.reviewTrail, status: shape.status }),
    // 同一层级最多退回一次（制度 §4.1）。已完成则无需退回。
    canReturn: !state.done && canReturnAtLevel(shape.reviewTrail, currentLevel).allowed,
    steps: state.chain.map((step) => {
      const done = trail.some((entry) => entry.level === step.level && entry.decision === 'approve');
      const returned = trail.filter((entry) => entry.level === step.level && entry.decision === 'return').length;
      return { ...step, done, returnRounds: returned };
    }),
    current: state.current,
    assignees: picked,
    trail,
  };
}

/* --- 宣传发布任务表 --- */
async function readOutreachPublications(client) {
  const rows = await stateRows(client, outreachTaskTable);
  const publications = {};
  for (const row of rows) {
    const contentId = String(row['投稿ID'] || '');
    if (!contentId) continue;
    publications[contentId] = {
      taskId: String(row['任务ID'] || ''),
      contentId,
      channel: String(row['发布渠道'] || ''),
      publishForm: String(row['发布形式'] || ''),
      plannedAt: row['计划发布时间'] || null,
      status: String(row['发布状态'] || ''),
      note: String(row['备注'] || ''),
      createdBy: String(row['创建人'] || ''),
      createdAt: row['创建时间'] || null,
      resultAt: row['完成时间'] || null,
      publishedLink: String(row['发布链接'] || ''),
      failureReason: String(row['失败原因'] || ''),
      retryCount: toFiniteNumber(row['重试次数']),
      resultBy: String(row['确认人'] || ''),
    };
  }
  return publications;
}

async function saveOutreachPublication(client, contentId, task) {
  const row = {
    任务ID: task.taskId,
    投稿ID: contentId,
    发布渠道: task.channel || '',
    发布形式: task.publishForm || '',
    计划发布时间: task.plannedAt || '',
    发布状态: task.status || '',
    发布链接: task.publishedLink || '',
    失败原因: task.failureReason || '',
    重试次数: String(toFiniteNumber(task.retryCount)),
    确认人: task.resultBy || '',
    完成时间: task.resultAt || '',
    备注: task.note || '',
    创建人: task.createdBy || '',
    创建时间: task.createdAt || '',
  };
  const rows = await stateRows(client, outreachTaskTable);
  const existing = rows.find((item) => String(item['投稿ID'] || '') === contentId);
  if (existing) return client.updateRow(outreachTaskTable, existing._id, row);
  return client.appendRow(outreachTaskTable, row);
}

/* --- 温暖连接参加表: public sign-ups and console consent share one shape --- */

async function readEnrollmentRows(client, filter = null) {
  return scopedWarmthRows(client, communityEnrollmentTable, filter);
}

/** Console opt-ins, keyed the way the console reads them: `<actor>:<program>`. */
async function readCommunityConsents(client) {
  const rows = await readEnrollmentRows(client);
  const consents = {};
  for (const row of rows) {
    if (String(row['来源'] || '') !== consoleEnrollmentSource) continue;
    const key = String(row['登记ID'] || '');
    if (!key) continue;
    consents[key] = {
      actor: String(row['参与者标识'] || ''),
      program: String(row['项目'] || ''),
      frequency: String(row['频率'] || ''),
      contentMode: String(row['内容模式'] || ''),
      enabled: String(row['状态'] || '') === enrollmentStatusConfirmed,
      updatedAt: row['提交时间'] || null,
    };
  }
  return consents;
}

/** Keep legacy solar enrolments writable until the optional schema is applied. */
async function birthdayCalendarPatch(client, kind) {
  const ready = birthdayCalendarSchemaReady(await client.getMetadata());
  if (!ready && kind === 'lunar') throw httpError(503, '阴历生日功能尚未完成数据表配置，请联系管理员补充「生日历法」字段。');
  return ready ? { 生日历法: kind } : {};
}

async function readWarmthInterests(client, filter = null) {
  const rows = await readEnrollmentRows(client, { ...filter, 来源: portalEnrollmentSource });
  return rows
    .filter((row) => String(row['来源'] || '') === portalEnrollmentSource)
    .map((row) => ({
      id: String(row['登记ID'] || ''),
      program: String(row['项目'] || ''),
      frequency: String(row['频率'] || ''),
      nickname: String(row['昵称'] || ''),
      participantRef: String(row['参与者标识'] || ''),
      studentId: String(accountByBusinessRef(row['参与者标识'])?.studentId || ''),
      email: String(row['邮箱'] || ''),
      campus: String(row['校区'] || ''),
      birthdayMonthDay: String(row['生日月日'] || ''),
      birthdayCalendar: String(row['生日历法'] || 'solar'),
      note: String(row['备注'] || ''),
      status: String(row['状态'] || ''),
      consentVersion: String(row['同意版本'] || ''),
      submittedAt: row['提交时间'] || null,
      handledBy: String(row['处理人'] || '') || null,
      handledAt: row['处理时间'] || null,
    }))
    .sort(byDateDesc('submittedAt'));
}

/** Confirmed participants from both the portal and the console, deduplicated. */
async function readConfirmedWarmthCandidates(client) {
  const portal = await readWarmthInterests(client);
  const consents = await readCommunityConsents(client);
  const seen = new Set();
  const candidates = [];
  for (const item of portal) {
    if (!isConfirmedEnrollmentStatus(item.status)) continue;
    const key = `${item.participantRef}|${item.program}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ participantRef: item.participantRef, program: item.program, frequency: item.frequency });
  }
  for (const item of Object.values(consents)) {
    if (!item.enabled) continue;
    const key = `${item.actor}|${item.program}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ participantRef: item.actor, program: item.program, frequency: item.frequency });
  }
  return candidates;
}

async function buildWarmthMatchingPreview(client) {
  const [candidates, enrollmentRows, library, blacklist] = await Promise.all([
    readConfirmedWarmthCandidates(client),
    readEnrollmentRows(client),
    readBlessingLibrary(client),
    readWarmthBlacklist(client),
  ]);
  const activeBlacklist = blacklist.filter((entry) => entry.status === BLACKLIST_ACTIVE);
  const enrollmentByRef = new Map(enrollmentRows.map((row) => [String(row['参与者标识'] || ''), {
    nickname: String(row['昵称'] || ''),
    campus: String(row['校区'] || ''),
    birthdayMonthDay: String(row['生日月日'] || ''),
    birthdayCalendar: String(row['生日历法'] || 'solar'),
    status: String(row['状态'] || ''),
  }]));
  const isBlocked = (candidate) => {
    const account = accountByBusinessRef(candidate.participantRef);
    const keys = new Set([candidate.participantRef, account?.accountId, account?.username, account?.studentId].filter(Boolean).map(String));
    return activeBlacklist.some((entry) => keys.has(String(entry.participantRef || '')) || (entry.studentId && keys.has(String(entry.studentId))));
  };
  const eligible = candidates.filter((candidate) => !isBlocked(candidate));
  const birthdayCandidates = eligible.filter((candidate) => candidate.program === 'birthday');
  const morningCandidates = eligible.filter((candidate) => candidate.program === 'morning');
  const activeLibrary = library.filter((item) => item.status === LIBRARY_STATUS_ACTIVE);
  const randomPool = activeLibrary.filter((item) => item.category === LIBRARY_CATEGORY_RANDOM);
  const repositoryPool = activeLibrary.filter((item) => item.category === LIBRARY_CATEGORY_REPOSITORY);
  const sentPool = library.filter((item) => item.category === LIBRARY_CATEGORY_SENT);
  const offlinePool = library.filter((item) => item.category === LIBRARY_CATEGORY_OFFLINE);
  const remainingRandom = [...randomPool];
  const hasOtherRepository = (username) => repositoryPool.some((item) => item.submitter !== username);
  const previewRows = [];
  let writtenQuota = 0;
  let randomMatched = 0;
  let repositoryFallback = 0;
  let shortfall = 0;
  let missingBirthday = 0;

  const sortedBirthday = [...birthdayCandidates].sort((a, b) => String(a.participantRef).localeCompare(String(b.participantRef)));
  for (const candidate of sortedBirthday) {
    const account = accountByBusinessRef(candidate.participantRef);
    const enrollment = enrollmentByRef.get(String(candidate.participantRef)) || {};
    const mine = activeLibrary.filter((item) => item.submitter && item.submitter === account?.username);
    const written = mine.filter((item) => [LIBRARY_CATEGORY_REPOSITORY, LIBRARY_CATEGORY_RANDOM, LIBRARY_CATEGORY_SENT].includes(item.category)).length;
    const desired = written > 0 ? written : 1;
    writtenQuota += desired;
    let random = 0;
    let repository = 0;

    if (!enrollment.birthdayMonthDay) {
      missingBirthday += 1;
      previewRows.push({
        id: candidate.participantRef,
        displayName: enrollment.nickname || maskedApplicant(account?.realName || ''),
        campus: enrollment.campus || '—',
        birthday: '—',
        written,
        projected: 0,
        random: 0,
        repository: 0,
        source: '缺少生日',
        status: '待补充',
      });
      continue;
    }

    if (written > 0) {
      for (let index = 0; index < written; index += 1) {
        const randomIndex = remainingRandom.findIndex((item) => item.submitter !== account?.username);
        if (randomIndex >= 0) {
          remainingRandom.splice(randomIndex, 1);
          random += 1;
        } else if (hasOtherRepository(account?.username)) {
          repository += 1;
        }
      }
    } else if (hasOtherRepository(account?.username)) {
      repository = 1;
    }

    const projected = random + repository;
    const missing = Math.max(0, desired - projected);
    randomMatched += random;
    repositoryFallback += repository;
    shortfall += missing;
    previewRows.push({
      id: candidate.participantRef,
      displayName: enrollment.nickname || maskedApplicant(account?.realName || ''),
      campus: enrollment.campus || '—',
      birthday: enrollment.birthdayMonthDay,
      written,
      projected,
      random,
      repository,
      source: written > 0
        ? random && repository ? '随机 + 仓库兜底' : random ? '一对一匹配' : repository ? '仓库兜底' : '资源不足'
        : repository ? '仓库抽取' : '资源不足',
      status: missing ? '资源不足' : written > 0 ? '可预览' : '未写祝福',
    });
  }

  const byProgram = [
    {
      program: 'birthday',
      eligible: birthdayCandidates.length,
      weekly: birthdayCandidates.filter((item) => item.frequency === 'weekly').length,
      projected: randomMatched + repositoryFallback,
      status: '可预览',
    },
    {
      program: 'morning',
      eligible: morningCandidates.length,
      weekly: morningCandidates.filter((item) => item.frequency === 'weekly').length,
      projected: 0,
      status: '待建设',
    },
  ];

  return {
    byProgram,
    previewRows,
    stats: {
      candidates: eligible.length,
      birthdayCandidates: birthdayCandidates.length,
      morningCandidates: morningCandidates.length,
      writtenQuota,
      projectedDeliveries: randomMatched + repositoryFallback,
      randomMatched,
      repositoryFallback,
      shortfall,
      randomPool: randomPool.length,
      repositoryPool: repositoryPool.length,
      sentPool: sentPool.length,
      offlinePool: offlinePool.length,
      missingBirthday,
    },
    pools: {
      random: randomPool.length,
      repository: repositoryPool.length,
      sent: sentPool.length,
      offline: offlinePool.length,
    },
  };
}

/** Upsert keyed by 登记ID — the natural key for both enrollment sources. */
async function saveEnrollment(client, registrationId, row) {
  const rows = await readEnrollmentRows(client, { 登记ID: registrationId });
  const existing = rows.find((item) => String(item['登记ID'] || '') === registrationId);
  if (existing) return client.updateRow(communityEnrollmentTable, existing._id, row);
  return client.appendRow(communityEnrollmentTable, { 登记ID: registrationId, ...row });
}

async function updateEnrollment(client, registrationId, patch) {
  const rows = await readEnrollmentRows(client, { 登记ID: registrationId });
  const existing = rows.find((item) => String(item['登记ID'] || '') === registrationId);
  if (!existing) return null;
  return client.updateRow(communityEnrollmentTable, existing._id, patch);
}

/* --- 温暖连接投稿表 --- */

async function readCommunitySubmissions(client) {
  const rows = await warmthRows(client, communitySubmissionTable);
  return rows
    .map((row) => ({
      id: String(row['投稿ID'] || ''),
      program: String(row['项目'] || ''),
      content: String(row['内容'] || ''),
      tone: String(row['语气'] || ''),
      actor: String(row['提交人'] || ''),
      nickname: String(row['署名昵称'] || ''),
      delivery: String(row['投递方式'] || ''),
      targetStudentId: String(row['目标学号'] || ''),
      friendEmail: String(row['挚友邮箱'] || ''),
      friendBirthday: String(row['挚友生日'] || ''),
      scheduledDate: String(row['计划投递日期'] || ''),
      deliveryState: String(row['投递条件'] || ''),
      status: String(row['状态'] || submissionStatusPending),
      submittedAt: row['提交时间'] || null,
      review: reviewFromRow({ 审核状态: row['状态'], 审核意见: row['审核意见'], 审核人: row['审核人'], 审核时间: row['审核时间'] }),
    }))
    .sort(byDateDesc('submittedAt'));
}

async function updateCommunitySubmission(client, submissionId, patch) {
  const rows = await scopedWarmthRows(client, communitySubmissionTable, { 投稿ID: submissionId });
  const existing = rows.find((item) => String(item['投稿ID'] || '') === submissionId);
  if (!existing) return null;
  return client.updateRow(communitySubmissionTable, existing._id, patch);
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// Public endpoints have no session to rate-limit against, so writes are capped
// per client address and per action bucket.
function enforcePublicLimit(req, bucket, limit = publicWriteLimit, identity = '') {
  const key = `${bucket}:${identity || clientIp(req)}`;
  const now = Date.now();
  for (const [existingKey, existing] of publicRequests) {
    if (existing.resetAt <= now) publicRequests.delete(existingKey);
  }
  const entry = publicRequests.get(key);
  if (!entry || entry.resetAt <= now) {
    publicRequests.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return;
  }
  entry.count += 1;
  if (entry.count > limit) {
    throw httpError(429, `提交过于频繁，请在 ${Math.ceil((entry.resetAt - now) / 60000)} 分钟后重试。`);
  }
}
const keyedLocks = new Map();
async function withKeyedLock(key, task) {
  const prior = keyedLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const chained = prior.then(() => gate);
  keyedLocks.set(key, chained);
  await prior;
  try {
    return await task();
  } finally {
    release();
    if (keyedLocks.get(key) === chained) keyedLocks.delete(key);
  }
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

let warmthLockTableAvailable = null;
let warmthLockWarningShown = false;
let warmthLockRetryAt = 0;
const configuredWarmthLockRetryMs = Number(process.env.WARMTH_LOCK_RETRY_MS || 30_000);
const warmthLockRetryMs = Number.isFinite(configuredWarmthLockRetryMs)
  ? Math.max(1, configuredWarmthLockRetryMs)
  : 30_000;
const warmthLockRequired = isProduction || String(process.env.WARMTH_LOCK_REQUIRED || 'false').toLowerCase() === 'true';

async function readWarmthLockRows(client, key) {
  if (warmthLockTableAvailable === false && Date.now() < warmthLockRetryAt) {
    if (warmthLockRequired) throw httpError(503, '温暖连接操作锁表不可用，已拒绝执行生日祝福写操作。');
    return null;
  }
  try {
    const rows = await scopedWarmthRows(client, warmthLockTable, { 锁键: key });
    warmthLockTableAvailable = true;
    warmthLockRetryAt = 0;
    return rows;
  } catch (error) {
    warmthLockTableAvailable = false;
    warmthLockRetryAt = Date.now() + warmthLockRetryMs;
    if (warmthLockRequired) {
      console.error(`Warmth lock table is required but unavailable: ${error.message}`);
      throw httpError(503, '温暖连接操作锁表不可用，已拒绝执行生日祝福写操作。');
    }
    if (!warmthLockWarningShown) {
      warmthLockWarningShown = true;
      console.warn(`Warmth lock table unavailable; falling back to process lock: ${error.message}`);
    }
    return null;
  }
}

function warmthLockIsActive(row, now) {
  if (String(row['状态'] || '') !== WARMTH_LOCK_ACTIVE) return false;
  const expiry = Date.parse(row['过期时间']);
  return Number.isFinite(expiry) && expiry > now;
}

function compareWarmthLocks(left, right) {
  return String(left['创建时间'] || '').localeCompare(String(right['创建时间'] || ''))
    || String(left['锁ID'] || '').localeCompare(String(right['锁ID'] || ''));
}

/**
 * Birthday-only durable lease. The lock row lives in SeaTable so separate Node
 * processes arbitrate the same quota/unique/idempotency key. The existing
 * process lock remains as a compatibility fallback before schema migration.
 */
async function withWarmthLock(client, key, task, { ttlMs = 5 * 60 * 1000, waitMs = 30 * 1000, pollMs = 120 } = {}) {
  const initialRows = await readWarmthLockRows(client, key);
  if (!initialRows) return withKeyedLock(key, task);

  const token = `${process.pid}-${Date.now().toString(36)}-${randomBytes(10).toString('hex')}`;
  const deadline = Date.now() + waitMs;
  let owned = null;

  while (Date.now() <= deadline) {
    const now = Date.now();
    const rows = await readWarmthLockRows(client, key);
    if (!rows) return withKeyedLock(key, task);

    const expired = rows.filter((row) => String(row['锁键'] || '') === key && String(row['状态'] || '') === WARMTH_LOCK_ACTIVE && !warmthLockIsActive(row, now));
    for (const row of expired) await client.deleteRow(warmthLockTable, row._id).catch(() => {});
    const active = rows.filter((row) => String(row['锁键'] || '') === key && warmthLockIsActive(row, now)).sort(compareWarmthLocks);

    if (!active.length) {
      const createdAt = new Date(now).toISOString();
      try {
        await client.appendRow(warmthLockTable, {
          锁ID: eventIdentifier('LCK'),
          锁键: key,
          持有者: token,
          令牌: token,
          状态: WARMTH_LOCK_ACTIVE,
          过期时间: new Date(now + ttlMs).toISOString(),
          创建时间: createdAt,
          更新时间: createdAt,
        });
      } catch {
        await delay(pollMs);
        continue;
      }

      const refreshed = await readWarmthLockRows(client, key);
      if (!refreshed) return withKeyedLock(key, task);
      const refreshedActive = refreshed.filter((row) => String(row['锁键'] || '') === key && warmthLockIsActive(row, Date.now())).sort(compareWarmthLocks);
      const winner = refreshedActive[0];
      if (winner && String(winner['令牌'] || '') === token) {
        owned = winner;
        break;
      }
      const mine = refreshed.find((row) => String(row['锁键'] || '') === key && String(row['令牌'] || '') === token);
      if (mine?._id) await client.deleteRow(warmthLockTable, mine._id).catch(() => {});
    }
    await delay(pollMs + Math.floor(Math.random() * 80));
  }

  if (!owned) throw httpError(409, '该操作正在处理中，请稍后重试。');
  const heartbeat = setInterval(() => {
    client.updateRow(warmthLockTable, owned._id, {
      过期时间: new Date(Date.now() + ttlMs).toISOString(),
      更新时间: new Date().toISOString(),
    }).catch(() => {});
  }, Math.max(1000, Math.floor(ttlMs / 3)));
  heartbeat.unref?.();
  try {
    return await task();
  } finally {
    clearInterval(heartbeat);
    await client.updateRow(warmthLockTable, owned._id, {
      状态: WARMTH_LOCK_RELEASED,
      更新时间: new Date().toISOString(),
    }).catch(() => {});
  }
}

function assertPublicEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, '邮箱格式不正确');
  if (!publicEmailDomains.length) return email;
  const domain = email.split('@')[1].toLowerCase();
  const allowed = publicEmailDomains.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`));
  if (!allowed) throw httpError(400, `请使用 ${publicEmailDomains.join(' 或 ')} 邮箱提交，便于核验校内身份。`);
  return email;
}

async function readJson(req) {
  return readJsonObject(req);
}

async function readMaterialAction(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('multipart/form-data')) return { body: await readJson(req), photo: null };
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > 8 * 1024 * 1024) { const error = new Error('Photo upload is limited to 8 MB'); error.statusCode = 413; throw error; }
  const buffer = await collectRequestBody(req, 8 * 1024 * 1024);
  let form;
  try {
    form = await new Response(buffer, {
      headers: { 'content-type': req.headers['content-type'] },
    }).formData();
  } catch {
    assertRequestActive();
    throw Object.assign(
      new Error('上传表单格式不正确，请重新选择文件后提交。'),
      { statusCode: 400, code: 'invalid_multipart_body' },
    );
  }
  assertRequestActive();
  const body = {};
  const seenFields = new Set();

  for (const [key, value] of form.entries()) {
    if (seenFields.has(key)) {
      throw Object.assign(
        new Error('上传表单包含重复字段，请重新提交。'),
        { statusCode: 400, code: 'duplicate_multipart_field' },
      );
    }
    seenFields.add(key);

    if (!(value instanceof File)) {
      Object.defineProperty(body, key, {
        value: String(value),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }

  const photo = form.get('photo');
  return { body, photo: photo instanceof File && photo.size > 0 ? photo : null };
}

function safeUploadName(name = 'photo.jpg') {
  const extension = String(name).toLowerCase().match(/\.(jpg|jpeg|png|webp)$/)?.[1] || 'jpg';
  return `nju-redcross-${Date.now()}-${randomBytes(5).toString('hex')}.${extension}`;
}

async function uploadSeaTableImage(file) {
  if (!file) return null;
  const bytes = Buffer.from(await file.arrayBuffer());
  const validated = await validateAttendancePhoto(bytes, { maxBytes: 8 * 1024 * 1024 });
  if (validated.contentType !== file.type) throw httpError(400, '图片类型与实际内容不一致');
  return uploadSeaTableImageRequest(file, { serverUrl, apiToken, filename: safeUploadName(file.name) });
}

function tableFrom(url, body = {}) {
  const table = String(url.searchParams.get('table') || body.table || configuredTable || '').trim();
  if (!table) {
    const error = new Error('Please select a table first');
    error.statusCode = 400;
    throw error;
  }
  return table;
}

const materialsTable = '物资管理';
const inventoryTable = '工位物资表';
const eventProjectTable = '活动项目表';
const eventSessionTable = '活动场次表';
const eventRegistrationTable = '活动报名表';
/**
 * Tables whose rows are owned by a business state machine or contain security
 * data. They remain readable in the data centre for diagnosis, but generic
 * CRUD must never bypass the domain routes that validate transitions and emit
 * audit records.
 */
const genericWriteProtectedTables = new Map([
  ['网站普通活动项目表', '统一报名开关与截止必须经过活动项目路由'],
  ...MORNING_PROTECTED_TABLES,
  [materialsTable, '请使用物资申请、审批、出库和归还流程'],
  [inventoryTable, '库存基线只能通过物资专用流程维护'],
  ['物资配置表', '物资配置需要经过专用配置流程'],
  ['物资流水表', '流水只能由物资状态机生成'],
  [eventProjectTable, '请使用活动中心维护活动'],
  [eventSessionTable, '请使用活动中心维护场次'],
  [eventRegistrationTable, '报名、取消和签到必须经过活动状态机'],
  ['活动通知表', '通知必须经过活动通知流程'],
  ['活动附件表', '附件必须经过活动附件流程'],
  [outreachProjectTable, '请使用宣传中心维护项目'],
  [outreachSubmissionTable, '投稿审核必须经过宣传状态机'],
  [outreachTaskTable, '发布任务必须经过宣传状态机'],
  [communityEnrollmentTable, '参加、退出和确认必须经过温暖连接流程'],
  [communitySubmissionTable, '投稿审核必须经过温暖连接流程'],
  ...[blessingLibraryTable, blessingDeliveryTable, blessingReportTable, blacklistTable, warmthLockTable].map(name => [name, '生日祝福数据必须经过专用流程']),
  [MESSAGE_TABLE, '留言内容必须经过红会留言墙管理'],
  ['红会语录墙', '旧语录内容仅供迁移审查，不允许通用表格写入'],
  [auditTable, '审计记录为系统只写数据'],
  ['平台账号表', '账号必须经过身份与权限管理流程'],
  ['邮箱验证码表', '验证码为系统安全数据'],
  ['邮件发件记录表', '发件记录为系统留痕数据'],
  ['博爱青春策划案 线下答辩', '既有业务源表仅供平台读取'],
  ['博爱青春纪念品大赛', '既有业务源表仅供平台读取'],
]);

function genericDataAccess(table) {
  const reason = genericWriteProtectedTables.get(table) || '';
  return { read: true, write: !reason, mode: reason ? 'business-route-only' : 'controlled-repair', reason };
}

function assertGenericWriteAllowed(table) {
  const access = genericDataAccess(table);
  if (access.write) return access;
  const error = new Error(`数据中心禁止直接修改「${table}」：${access.reason}`);
  error.statusCode = 403;
  error.code = 'business_route_required';
  throw error;
}
const activitySchema = [
  { name: '活动项目表', purpose: '活动基本信息、报名窗口与运营负责人', columns: ['活动ID', '活动名称', '活动类型', '活动简介', '校区', '地点', '报名开始', '报名截止', '活动开始', '活动结束', '容量', '负责人', '状态', '公开范围'] },
  { name: '活动场次表', purpose: '同一活动的具体场次与签到配置', columns: ['场次ID', '活动ID', '开始时间', '结束时间', '地点', '容量', '签到开放', '签到方式', '状态'] },
  { name: '活动报名表', purpose: '参与者报名、候补、签到与授权记录', columns: ['报名ID', '活动ID', '场次ID', '参与者引用', '显示姓名', '南大邮箱', '校区', '报名答案', '同意版本', '报名状态', '候补序号', '签到码摘要', '提交时间', '取消时间', '签到时间'] },
];
const outreachSchema = [
  { name: '宣传项目表', purpose: '宣传主题、征集窗口、受众与发布渠道', columns: ['项目ID', '项目名称', '项目类型', '征集开始', '征集截止', '目标受众', '发布渠道', '状态', '负责人', '授权版本'] },
  { name: '宣传投稿表', purpose: '公众投稿正文与授权，以及对既有内容的审核结论（同一张表按来源区分）', columns: ['投稿ID', '来源', '项目ID', '类别', '标题', '正文', '附件引用', '投稿人引用', '联系人', '联系邮箱', '对外署名', '公开范围', '原创确认', '肖像授权', '同意版本', '审核状态', '审核意见', '审核人', '提交时间', '审核时间'] },
  { name: '宣传发布任务表', purpose: '渠道排期、发布确认、链接与失败重试记录', columns: ['任务ID', '投稿ID', '发布渠道', '计划发布时间', '发布状态', '发布链接', '失败原因', '重试次数', '确认人', '完成时间', '备注', '创建人', '创建时间'] },
];
/**
 * 状态层 Schema。由上面两个领域定义合并而成，每张表只有一份定义：
 * 宣传预览只展示宣传三表，状态预览展示完整存储层。
 */
const communityStateSchema = [
  { name: '温暖连接参加表', purpose: '公众端自愿登记与控制台侧同意记录，状态与处理留痕同一行', columns: ['登记ID', '来源', '项目', '频率', '昵称', '参与者标识', '邮箱', '校区', '生日月日', '生日历法', '备注', '内容模式', '状态', '同意版本', '提交时间', '处理人', '处理时间'] },
  { name: '温暖连接投稿表', purpose: '生日祝福与早安晚安内容投稿及审核结论', columns: ['投稿ID', '项目', '内容', '语气', '提交人', '状态', '审核意见', '审核人', '提交时间', '审核时间', '同意版本', '署名昵称', '投递方式', '目标学号', '投递条件', '附件', '挚友邮箱', '挚友生日', '计划投递日期'] },
  { name: '温暖祝福库表', purpose: '审核通过的生日祝福按投递状态分类入库（祝福仓库 / 一对一随机 / 一对一已发过的 / 已下线的）', columns: ['入库ID', '投稿ID', '项目', '分类', '内容', '署名昵称', '目标学号', '来源投稿人', '状态', '审核人', '入库时间'] },
  { name: '温暖祝福投递表', purpose: '生日当天自动投递（邮件 + 站内）留痕', columns: ['投递ID', '投稿ID', '收件人标识', '收件人学号', '触发日期', '触发年份', '来源', '邮件状态', '站内状态', '投递时间', '失败原因'] },
  { name: '温暖祝福举报表', purpose: '收件人举报已送达祝福的理由与处理结论（举报人只存账号标识，学号按需解析）', columns: ['举报ID', '投稿ID', '举报人标识', '原因', '状态', '处理人', '处理意见', '处理时间', '提交时间', '举报人确认时间'] },
  { name: '温暖连接黑名单表', purpose: '被拉黑的成员（拉黑同时踢出计划）', columns: ['黑名单ID', '参与者标识', '学号', '原因', '状态', '操作人', '拉黑时间', '解除时间'] },
  { name: '温暖连接操作锁表', purpose: '生日祝福写入、审核与投递的跨进程租约锁', columns: ['锁ID', '锁键', '持有者', '令牌', '状态', '过期时间', '创建时间', '更新时间'] },
  { name: '操作审计表', purpose: '登录、审批、出入库、签到核验、内容审核与公众端提交的操作留痕', columns: ['审计ID', '时间', '操作人', '角色', '动作', '对象', '结果', 'IP', '备注'] },
];
const stateSchema = [
  ...outreachSchema,
  ...communityStateSchema,
];
/**
 * Compares a declared schema against the live Base so the console can show what
 * is actually provisioned. Read-only: never creates or alters anything.
 */
async function schemaPreview(client, definitions) {
  const metadata = await client.getMetadata();
  const currentTables = new Map((metadata?.tables || []).map((table) => [table.name, table]));
  return definitions.map((definition) => {
    const table = currentTables.get(definition.name);
    const existingColumns = new Set((table?.columns || []).map((column) => column.name));
    return {
      ...definition,
      exists: Boolean(table),
      tableId: table?._id || null,
      matchedColumns: definition.columns.filter((column) => existingColumns.has(column)),
      missingColumns: definition.columns.filter((column) => !existingColumns.has(column)),
      extraColumns: table ? (table.columns || []).map((column) => column.name).filter((column) => !definition.columns.includes(column)) : [],
    };
  });
}
function toFiniteNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function shanghaiDay(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
}
/** Ordered list of the last `days` calendar days in Asia/Shanghai. */
function recentDays(days = 14) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' });
  const out = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    out.push(formatter.format(new Date(Date.now() - offset * 86400000)));
  }
  return out;
}
/** Counts rows per day for a set of named date accessors. */
function dailySeries(rows, accessors, days = 14) {
  const labels = recentDays(days);
  const index = new Map(labels.map((label, position) => [label, position]));
  const series = {};
  for (const [name, accessor] of Object.entries(accessors)) {
    const values = new Array(labels.length).fill(0);
    for (const row of rows) {
      const result = accessor(row);
      if (!result) continue;
      const [dateValue, amount = 1] = Array.isArray(result) ? result : [result, 1];
      const position = index.get(shanghaiDay(dateValue));
      if (position === undefined) continue;
      values[position] += amount;
    }
    series[name] = values;
  }
  return { labels, ...series };
}
function materialCode(row) { return `NJU-RC-${row._id}`; }
function parsedDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function daysLate(value) {
  const due = parsedDate(value);
  if (!due) return 0;
  due.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today - due) / 86400000));
}
function maskedApplicant(value) {
  const name = String(value || '').trim();
  return name ? `${name.slice(0, 1)}${name.length > 1 ? '＊'.repeat(Math.min(name.length - 1, 3)) : ''}` : '未填写';
}
function maskedEmail(value) {
  const email = String(value || '').trim();
  const at = email.indexOf('@');
  if (at < 1) return email ? '已隐藏' : '未填写';
  const local = email.slice(0, at);
  return `${local.slice(0, 2)}${'＊'.repeat(Math.max(1, Math.min(local.length - 2, 4)))}@${email.slice(at + 1)}`;
}
function isFlagOn(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  return /^(true|是|yes|y|1|开启|成功|通过|已报名|已核对|已录入)$/i.test(String(value).trim());
}
function isFlagOff(value) {
  if (value === false) return true;
  return /^(false|否|no|n|0|禁用|关闭)$/i.test(String(value ?? '').trim());
}
function cellText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value)) {
    const text = value.map((item) => cellText(item, '')).filter(Boolean).join('、');
    return text || fallback;
  }
  if (typeof value === 'object') {
    const candidate = value.display_value ?? value.name ?? value.title ?? value.label ?? value.value;
    return candidate === value ? fallback : cellText(candidate, fallback);
  }
  const text = String(value).trim();
  return text || fallback;
}
function inventorySummary(row, config = {}) {
  const initial = toFiniteNumber(row['初始数量']);
  const baselineQuantity = toFiniteNumber(row['现有数量']);
  const quantity = baselineQuantity + toFiniteNumber(config.__ledgerDelta);
  const configuredThreshold = toFiniteNumber(config['预警阈值']);
  const fallbackThreshold = initial > 0 ? Math.min(initial, Math.max(1, Math.ceil(initial * 0.2))) : 0;
  const threshold = isFlagOff(config['阈值启用'])
    ? null
    : Math.min(initial > 0 ? initial : Number.POSITIVE_INFINITY, configuredThreshold > 0 ? configuredThreshold : fallbackThreshold);
  const flow = config.__flowStats || {};
  const difference = initial - quantity;
  const baselineBorrowed = toFiniteNumber(row['借出数量']);
  const baselineReturned = toFiniteNumber(row['归还数量']);
  const baselineOutstanding = Math.max(0, baselineBorrowed - baselineReturned);
  const untrackedDifference = Math.max(0, Math.abs(initial - baselineQuantity) - baselineOutstanding - Math.max(0, toFiniteNumber(flow.outbound) - toFiniteNumber(flow.returned)));
  const thresholdStatus = threshold !== null && quantity <= threshold
    ? (quantity < initial ? 'critical' : 'notice')
    : null;
  return {
    id: row._id, code: materialCode(row), name: String(row['物资名称'] || '未命名物资'), center: String(row['中心'] || '未分类'), unit: String(row['单位'] || '件'), cabinet: String(row['柜号'] || '未标注'), level: String(row['层数'] || '未标注'), initial, baselineQuantity, quantity, difference, baselineDifference: initial - baselineQuantity, baselineBorrowed, baselineReturned, baselineOutstanding, untrackedDifference, threshold,
    outbound: toFiniteNumber(flow.outbound), returned: toFiniteNumber(flow.returned), inbound: toFiniteNumber(flow.inbound), loss: toFiniteNumber(flow.loss), adjustment: toFiniteNumber(flow.adjustment), destinations: flow.destinations || [], sourceStatuses: Array.isArray(row['物资管理']) ? row['物资管理'].map(String) : [],
    lowStock: thresholdStatus === 'critical', thresholdStatus,
  };
}
function applicationSummary(row) {
  const linked = materialLinkedIds(row['可借用物资']);
  const returned = Boolean(row['实际归还日期']) || String(row['归还状态'] || '').includes('已全部归还') || String(row['状态'] || '').includes('已归还');
  const overdueDays = returned ? 0 : daysLate(row['拟归还日期']);
  const status = String(row['状态'] || '未填写');
  const approval = String(row['借出审批'] || '待审核');
  return {
    requestedAssetCode: linked?.length === 1 ? `NJU-RC-${linked[0]}` : null,
    needsVerification: linked?.length !== 1,
    id: row._id, code: `REQ-${row._id}`, applicant: maskedApplicant(row['姓名']), purpose: String(row['借用用途'] || '未填写'), items: String(row['借用物资名及数量'] || row['借用物资类型'] || '未填写'), quantity: toFiniteNumber(row['借用件数']), status, approval, returnStatus: String(row['归还状态'] || ''),
    plannedBorrowDate: row['拟借用日期'] || null, plannedReturnDate: row['拟归还日期'] || null, actualBorrowDate: row['实际借用日期'] || null, actualReturnDate: row['实际归还日期'] || null, returned, overdueDays,
  };
}
function eventIdentifier(prefix = 'EVT') { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`; }
function requiredText(value, label, max = 200) {
  const text = String(value || '').trim();
  if (!text) { const error = new Error(`${label}不能为空`); error.statusCode = 400; throw error; }
  if (text.length > max) { const error = new Error(`${label}长度不能超过${max}个字符`); error.statusCode = 400; throw error; }
  return text;
}
function cleanText(value, label, max = 200, { allowNewlines = false } = {}) {
  if (typeof value !== 'string') {
    const error = new Error(`${label}格式不正确`); error.statusCode = 400; throw error;
  }
  let text = value.trim();
  if (!text) { const error = new Error(`${label}不能为空`); error.statusCode = 400; throw error; }
  const control = allowNewlines ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  text = text.replace(control, '').replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
  if (text.length > max) { const error = new Error(`${label}长度不能超过${max}个字符`); error.statusCode = 400; throw error; }
  return text;
}
function optionalCleanText(value, label, max = 200, options) {
  if (value === undefined || value === null || value === '') return '';
  return cleanText(value, label, max, options);
}
function eventPayload(body, session) {
  const title = requiredText(body.title || body.name, '活动名称', 120);
  const capacity = Math.max(1, Math.floor(Number(body.capacity || 0)));
  if (!Number.isInteger(capacity) || capacity <= 0) { const error = new Error('活动容量必须是正整数'); error.statusCode = 400; throw error; }
  return {
    活动ID: eventIdentifier(), 活动名称: title, 活动类型: String(body.type || '公益活动').trim(), 活动简介: String(body.description || '').trim(),
    校区: String(body.campus || '').trim(), 地点: String(body.location || '').trim(), 报名开始: String(body.registrationStart || '').trim(), 报名截止: String(body.registrationEnd || '').trim(),
    活动开始: String(body.startAt || '').trim(), 活动结束: String(body.endAt || '').trim(), 容量: String(capacity), 负责人: session.username, 状态: '草稿', 公开范围: String(body.visibility || '内部成员').trim(),
  };
}
function eventSummary(row, sessions = [], registrations = []) {
  const eventId = String(row['活动ID'] || '');
  const relatedSessions = sessions.filter((item) => String(item['活动ID'] || '') === eventId);
  const relatedRegistrations = registrations.filter((item) => String(item['活动ID'] || '') === eventId && !String(item['报名状态'] || '').includes('已取消'));
  return {
    id: row._id, eventId, name: String(row['活动名称'] || '未命名活动'), type: String(row['活动类型'] || ''), description: String(row['活动简介'] || ''), campus: String(row['校区'] || ''), location: String(row['地点'] || ''),
    registrationStart: row['报名开始'] || null, registrationEnd: row['报名截止'] || null, startAt: row['活动开始'] || null, endAt: row['活动结束'] || null, capacity: toFiniteNumber(row['容量']), owner: maskedApplicant(row['负责人']), status: String(row['状态'] || '草稿'), visibility: String(row['公开范围'] || ''),
    sessions: relatedSessions.map((item) => ({ id: item._id, sessionId: item['场次ID'] || '', startAt: item['开始时间'] || null, endAt: item['结束时间'] || null, location: item['地点'] || '', capacity: toFiniteNumber(item['容量']), checkinOpen: item['签到开放'] || null, checkinMethod: item['签到方式'] || '', status: item['状态'] || '' })),
    registrations: relatedRegistrations.length, confirmed: relatedRegistrations.filter((item) => String(item['报名状态'] || '') === '已确认').length, waitlisted: relatedRegistrations.filter((item) => String(item['报名状态'] || '') === '候补').length, checkedIn: relatedRegistrations.filter((item) => String(item['签到时间'] || '').trim()).length,
  };
}
function eventCheckinToken(registrationId, code) {
  return `${registrationId}.${code}`;
}
function eventCheckinHash(token) { return hash(token).toString('hex'); }
function randomCheckinCode() { return randomBytes(5).toString('hex').toUpperCase(); }
async function volunteerRows(client, tableName, maxRows = 5000) {
  return listAllRows(client, tableName, { maxRows });
}
function volunteerStatus(value) {
  const text = String(value || '').trim();
  if (/通过|成功|已完成|已核对|已解决/.test(text)) return 'success';
  if (/拒绝|失败|未通过|问题/.test(text)) return 'danger';
  return 'warning';
}
async function getVolunteerOverview(client, { notificationsOnly = false } = {}) {
  const [registrations, checkins, approvals, profiles, hours] = await Promise.all([
    volunteerRows(client, '活动报名总表'),
    volunteerRows(client, '活动签到'),
    notificationsOnly ? [] : volunteerRows(client, '登记审批'),
    notificationsOnly ? [] : volunteerRows(client, '个人主页（编辑版）'),
    notificationsOnly ? [] : volunteerRows(client, '活动及时长汇总表'),
  ]);
  assertCompleteRows(
    registrations,
    checkins,
    approvals,
    profiles,
    hours,
  );
  const workflow = notificationsOnly ? { groups: [] } : summarizeVolunteerWorkflow(registrations, checkins);
  const events = workflow.groups;
  const registrationsById = new Map(registrations.map(row => [row._id, row]));
  const checkinsById = new Map(checkins.map(row => [row._id, row]));
  const approvalQueue = approvals.slice(-8).reverse().map((row) => ({
    activity: cellText(row['活动名称'], '未命名活动'), type: cellText(row['活动类别'], '活动'), date: row['活动日期'] || null,
    owner: maskedApplicant(cellText(row['负责人'])), status: isFlagOn(row['审批通过']) ? '已通过' : cellText(row['进程'], '待处理'), progress: cellText(row['进程']),
  }));
  const recentCheckins = checkins.slice(-8).reverse().map(row => ({
    activity: cellText((Array.isArray(row['活动名称']) ? row['活动名称'] : []).map(link => registrationsById.get(link?.row_id || link)?.['活动名称']).filter(Boolean), '关联待核验'),
    name: maskedApplicant(cellText(row['姓名'])), time: row['活动时间'] || row['创建时间'] || null, verified: row['已核对并录入'] === '已核对并录入',
  }));
  const pendingHours = registrations.map(row => ({ row, readiness: registrationReadiness(row, checkinsById) }))
    .filter(item => ['待录入', '待核定时长', '需核验'].includes(item.readiness.state));
  const hoursQueue = pendingHours.slice(-50).reverse().map(({ row, readiness }) => ({
    id: row._id,
    activity: cellText(row['活动名称'], '未命名活动'), date: row['报名日期'] || null,
    slot: cellText(row['报名时段']), position: cellText(row['岗位']),
    name: maskedApplicant(cellText(row['姓名'])), hours: readiness.hours == null ? '待核定' : String(readiness.hours),
    status: readiness.state, entryStatus: cellText(row['录入状态'], '未填写'),
    statusSource: 'derived', problems: readiness.problems,
  }));
  if (notificationsOnly) return { hoursQueue };
  return {
    ok: true, source: { baseUuid: volunteerBaseUuid, readOnly: true, tables: ['活动报名总表', '活动签到', '登记审批', '个人主页（编辑版）', '活动及时长汇总表'], reads: { registrations: readMeta(registrations), checkins: readMeta(checkins), approvals: readMeta(approvals), profiles: readMeta(profiles), hours: readMeta(hours) } },
    stats: { memberProfiles: profiles.length, registrations: registrations.length, checkins: checkins.length, approvals: approvals.length, eventCount: events.length, hoursQueue: pendingHours.length },
    workflow: { states: workflow.states, orphanCheckins: workflow.orphanCheckins, complete: ![registrations, checkins].some(rows => readMeta(rows).truncated), evidence: '报名记录ID与签到关联双向核验；录入状态来自活动报名总表', queueShown: hoursQueue.length, verifiedCheckins: workflow.registrationsWithVerifiedCheckin },
    events: events.sort((a, b) => b.registrations - a.registrations).slice(0, 12), approvalQueue, recentCheckins, hoursQueue,
  };
}
async function safeRows(client, tableName, maxRows = 5000) {
  return listAllRows(client, tableName, {
    maxRows,
    requireComplete: true,
  });
}
/**
 * Collects the legacy content sources into one review queue. Extracted so
 * that writing a review conclusion can snapshot the source title without
 * re-deriving the whole overview. 课程反馈投稿模块已于 v2 彻底移除。
 */
async function buildCampaignRows(client) {
  const [planning, submissions] = await Promise.all([
    safeRows(client, '博爱青春策划案 线下答辩'),
    safeRows(client, '博爱青春纪念品大赛'),
  ]);
  return {
    counts: { planning: planning.length, creative: submissions.length },
    rows: [
      ...planning.map((row) => ({ id: `planning:${row._id}`, type: '策划案', title: String(row['策划案名称'] || row['团队名称'] || '未命名策划'), status: '已收集', source: '博爱青春策划案 线下答辩', author: maskedApplicant(row['负责人'] || row['团队负责人'] || row['答辩人姓名'] || row['姓名']), submittedAt: row['提交时间'] || row['创建时间'] || row._ctime || row._mtime || null, summary: String(row['策划案简介'] || row['项目简介'] || row['策划案内容'] || '暂无摘要'), authorization: String(row['授权'] || row['是否同意公开'] || '未采集') })),
      ...submissions.map((row) => ({ id: `creative:${row._id}`, type: '文创征集', title: String(row['文创名称'] || row['参赛类别'] || '未命名作品'), status: '已收集', source: '博爱青春纪念品大赛', author: maskedApplicant(row['作者'] || row['姓名'] || row['学号'] || row['负责人']), submittedAt: row['提交时间'] || row['创建时间'] || row._ctime || row._mtime || null, summary: String(row['作品简介'] || row['设计理念'] || row['参赛说明'] || '暂无摘要'), authorization: String(row['授权'] || row['是否同意公开'] || '未采集') })),
    ],
  };
}

async function getOutreachOverview(client, { notificationsOnly = false } = {}) {
  const [{ counts, rows: campaignRows }, notices, reviews, publications, assigneeRows, submissionRows] = await Promise.all([
    buildCampaignRows(client),
    !notificationsOnly && volunteerBase ? getVolunteerBase().then(base => safeRows(base, process.env.SEATABLE_VOLUNTEER_NOTICE_TABLE || '报名通知')) : Promise.resolve([]),
    readOutreachReviews(client),
    readOutreachPublications(client),
    readOutreachAssignees(client).catch(() => []),
    readOutreachSubmissionRows(client).catch(() => []),
  ]);
  // v3：把「宣传投稿表」里的内容资产也并进看板，并带上多级审核视图。
  const submissionCampaigns = submissionRows.map((row) => {
    const shape = reviewShapeOf(row);
    const chain = reviewChainView(row, assigneeRows);
    return {
      id: String(row['投稿ID'] || row._id),
      type: shape.category || '内容投稿',
      kind: chain.kind,
      title: shape.title || '未命名投稿',
      status: chain.done ? '已通过' : chain.status,
      source: '公众端内容投稿',
      author: shape.author || '',
      submittedAt: shape.submittedAt || null,
      summary: shape.summary || '',
      authorization: shape.authorization || '已采集',
      reviewLevel: shape.reviewLevel,
      reviewTrail: shape.reviewTrail,
      publishForm: shape.publishForm,
      chain,
      review: reviews[String(row['投稿ID'] || '')] || (chain.passed > 0 || chain.done ? { decision: chain.done ? 'approve' : 'return', reviewer: '', note: chain.status, reviewedAt: shape.submittedAt } : null),
      publication: publications[String(row['投稿ID'] || '')] || null,
    };
  });
  const reviewedCampaigns = [...campaignRows, ...submissionCampaigns].map((item) => (submissionCampaigns.includes(item) ? item : { ...item, review: reviews[item.id] || null, publication: publications[item.id] || null, status: reviews[item.id]?.decision === 'approve' ? '已通过' : reviews[item.id]?.decision === 'return' ? '待修改' : item.status }));
  return {
    ok: true,
    stats: { contentCount: reviewedCampaigns.length, planningCount: counts.planning, creativeCount: counts.creative, submissionCount: submissionCampaigns.length, noticeCount: notices.length, reviewPending: reviewedCampaigns.filter((item) => !item.review).length, reviewApproved: reviewedCampaigns.filter((item) => item.review?.decision === 'approve').length, reviewReturned: reviewedCampaigns.filter((item) => item.review?.decision === 'return').length, publicationPending: reviewedCampaigns.filter((item) => item.publication?.status === '待人工发布').length },
    // The console must be able to reach every item counted by contentCount.
    // Client-side filters can narrow the list without silently hiding rows.
    campaigns: reviewedCampaigns,
    notices: notices.slice(-12).reverse().map((row) => ({ type: String(row['活动类别'] || '活动'), title: String(row['活动名称'] || '未命名活动'), status: String(row['审批进程'] || row['隐藏'] || '待发布'), group: String(row['QQ群号'] || '') })),
    sources: ['博爱青春策划案 线下答辩', '博爱青春纪念品大赛', '公众端内容投稿', ...(volunteerBase ? ['报名通知（志愿服务 Base）'] : [])],
  };
}
async function getConsoleSearch(query, permissions) {
  return searchBusinessRecords({
    query,
    permissions,
    providers: [
      {
        scope: 'materials',
        load: async () => {
          const data = await getMaterialsOverview(await getBase());
          return {
            complete: !Object.values(data.reads || {})
              .some((read) => read.truncated),
            items: [
              ...data.inventory.map((item) => ({
                id: `inventory:${item.id}`,
                title: item.name,
                detail: `${item.code} · ${item.center} · ${item.cabinet} · 当前 ${item.quantity}`,
                view: 'materials',
                target: { kind: 'inventory', id: item.id },
              })),
              ...data.applications.map((item) => ({
                id: `application:${item.id}`,
                title: item.purpose,
                detail: `${item.code} · ${item.applicant} · ${item.items} · ${item.status}`,
                view: 'materials',
                target: { kind: 'application', id: item.id },
              })),
            ],
          };
        },
      },
      {
        scope: 'events',
        load: async () => {
          const data = await (await getWorkflow()).publicRead();
          return {
            complete: false,
            items: data.events
              .filter((item) => !item.sourceSuperseded)
              .map((item) => ({
                id: `event:${item._id}`,
                title: String(item['活动名称'] || '未命名活动'),
                detail: [
                  item['报名日期'],
                  item['报名时段'],
                  item['地点'],
                  item['状态'],
                ].filter(Boolean).join(' · '),
                view: 'activities',
                target: {
                  kind: 'event',
                  id: item._id,
                  mode: item['状态'] === '已归档' ? 'trash' : 'all',
                },
              })),
          };
        },
      },
      {
        scope: 'outreach',
        load: async () => {
          const client = await getBase();
          const [data, submissions] = await Promise.all([
            getOutreachOverview(client),
            readPublicSubmissions(client),
          ]);
          return {
            complete: false,
            items: [
              ...data.campaigns.map((item) => ({
                id: `campaign:${item.id}`,
                title: item.title,
                detail: `${item.type} · ${item.author} · ${item.status}`,
                view: 'outreach',
                target: { kind: 'campaign', id: item.id },
              })),
              ...submissions.slice(0, 60).map((item) => ({
                id: `submission:${item.id}`,
                title: item.title,
                detail: `${item.category} · ${item.status}`,
                view: 'outreach',
                target: { kind: 'submission', id: item.id },
              })),
            ],
          };
        },
      },
      {
        scope: 'community',
        load: async () => {
          const client = await getBase();
          const [interests, submissions] = await Promise.all([
            readWarmthInterests(client),
            readCommunitySubmissions(client),
          ]);
          return {
            complete: false,
            items: [
              ...interests.slice(0, 60).map((item) => ({
                id: `interest:${item.id}`,
                title: `${item.program === 'birthday' ? '生日祝福' : '早安晚安'} · ${item.nickname || '参加登记'}`,
                detail: `${item.status} · ${item.submittedAt || ''}`,
                view: 'community',
                target: {
                  kind: 'interest',
                  id: item.id,
                  program: item.program,
                },
              })),
              ...submissions.slice(0, 60).map((item) => ({
                id: `submission:${item.id}`,
                title: String(item.content || '内建投稿').slice(0, 80),
                detail: `${item.program === 'birthday' ? '生日祝福' : '早安晚安'} · ${item.tone || ''} · ${item.status}`,
                view: 'community',
                target: {
                  kind: 'submission',
                  id: item.id,
                  program: item.program,
                },
              })),
            ],
          };
        },
      },
    ],
  });
}

async function getNotificationsOverview(client, permissionValue = CONSOLE_PERMISSION_SCOPES, session = null) {
  const allowed = new Set(normalizePermissions(permissionValue, 'platform_admin'));
  const when = (scope, task, fallback = null) => allowed.has(scope) ? task() : Promise.resolve(fallback);
  const [materialsResult, eventsResult, outreachResult, volunteerResult, communityResult, publicSubmissionResult, warmthResult] = await Promise.allSettled([
    when('materials', () => getMaterialsOverview(client, { notificationsOnly: true })),
    when('events', () => getEventsOverview(client, { notificationsOnly: true })),
    when('outreach', () => getOutreachOverview(client, { notificationsOnly: true })),
    when('events', () => volunteerBase ? getVolunteerBase().then(base => getVolunteerOverview(base, { notificationsOnly: true })) : Promise.resolve(null)),
    when('community', () => readCommunitySubmissions(client), []),
    when('outreach', () => readPublicSubmissions(client), []),
    when('community', () => readWarmthInterests(client), []),
   ]);

  // Failed sources must not be presented as an empty notification queue.
  for (const result of [
    materialsResult,
    eventsResult,
    outreachResult,
    volunteerResult,
    communityResult,
    publicSubmissionResult,
    warmthResult,
  ]) {
    if (result.status === 'rejected') throw result.reason;
  }

  const items = [];
  const materials = materialsResult.status === 'fulfilled' ? materialsResult.value : null;
  const events = eventsResult.status === 'fulfilled' ? eventsResult.value : null;
  const outreach = outreachResult.status === 'fulfilled' ? outreachResult.value : null;
  const volunteer = volunteerResult.status === 'fulfilled' ? volunteerResult.value : null;
  const communitySubmissions = communityResult.status === 'fulfilled' ? communityResult.value : [];
  const publicSubmissions = publicSubmissionResult.status === 'fulfilled' ? publicSubmissionResult.value : [];
  const warmthInterests = warmthResult.status === 'fulfilled' ? warmthResult.value : [];
  (materials?.overdue || []).slice(0, 8).forEach((item) => items.push({
    type: '物资逾期',
    priority: 'high',
    title: `${item.purpose} · ${item.overdueDays} 天`,
    detail: item.items,
    view: 'materials',
    target: { kind: 'application', id: item.id },
  }));

  (materials?.lowStock || []).slice(0, 8).forEach((item) => items.push({
    type: '库存预警',
    priority: 'high',
    title: item.name,
    detail: `当前 ${item.quantity}，阈值 ${item.threshold}`,
    view: 'materials',
    target: { kind: 'inventory', id: item.id },
  }));

  (materials?.pending || []).slice(0, 8).forEach((item) => items.push({
    type: '物资审批',
    priority: 'medium',
    title: item.purpose,
    detail: `${item.applicant} · ${item.items}`,
    view: 'materials',
    target: { kind: 'application', id: item.id },
  }));
  (events?.events || [])
    .filter((event) => event.status === '草稿')
    .slice(0, 6)
    .forEach((event) => items.push({
      type: '活动待发布',
      priority: 'medium',
      title: event.name,
      detail: '草稿状态，发布前请确认场次和容量',
      view: 'activities',
      target: {
        kind: 'source',
        id: event.eventId ? `managed:${event.eventId}` : '',
      },
    }));
  (volunteer?.hoursQueue || [])
    .slice(0, 8)
    .forEach((item) => items.push({
      type: '时长待核对',
      priority: 'medium',
      title: item.activity,
      detail: `${item.name} · ${item.hours}`,
      view: 'services',
      target: { kind: 'hours', id: item.id },
    }));
  (outreach?.campaigns || [])
    .filter((item) => item.status === '已收集' || item.status === '待补充')
    .slice(0, 8)
    .forEach((item) => items.push({
      type: '内容待审核',
      priority: 'low',
      title: item.title,
      detail: `${item.type} · ${item.authorization}`,
      view: 'outreach',
      target: { kind: 'campaign', id: item.id },
    }));

  (outreach?.campaigns || [])
    .filter((item) => item.publication?.status === '待人工发布')
    .slice(0, 8)
    .forEach((item) => items.push({
      type: '内容待发布',
      priority: 'medium',
      title: item.title,
      detail: `${item.publication.channel} · ${item.publication.plannedAt}`,
      view: 'outreach',
      target: { kind: 'campaign', id: item.id },
    }));
  communitySubmissions
    .filter((item) => item.status === '待审核')
    .slice(0, 8)
    .forEach((item) => items.push({
      type: '温暖连接待审核',
      priority: 'medium',
      title: item.program === 'birthday' ? '生日祝福投稿' : '早安晚安投稿',
      detail: `${item.tone} · ${item.submittedAt}`,
      view: 'community',
      target: {
        kind: 'submission',
        id: item.id,
        program: item.program,
      },
    }));
  publicSubmissions
    .filter(item => item.status === '待审核')
    .slice(0, 10)
    .forEach(item => items.push({
      type: '公众投稿待审核',
      priority: 'high',
      title: item.title,
      detail: `${item.category} · 来自公众端`,
      view: 'outreach',
      target: {
        kind: 'submission',
        id: item.id,
      },
    }));
  warmthInterests
    .filter((item) => item.status === enrollmentStatusPending)
    .slice(0, 10)
    .forEach((item) => items.push({
      type: '温暖连接待确认',
      priority: 'medium',
      title: item.program === 'birthday'
        ? `生日祝福 · ${item.nickname}`
        : `早安晚安 · ${item.nickname}`,
      detail: '公众端自愿登记，需人工确认后才进入队列',
      view: 'community',
      target: {
        kind: 'interest',
        id: item.id,
        program: item.program,
      },
    }));
  if(session&&allowed.has('events')){
    try{
      const [data,roster]=await Promise.all([(await getWorkflow()).catalog(),getWorkspaceRoster()]);
      items.push(...await workspaceNotificationItems({drafts:await getWorkspaceDraftStore().read(),events:data.events,actor:businessAccountRef(session),roster}));
    }catch(error){
      // Activity tasks fail closed without their trusted roster, but the rest of
      // the notification centre must remain available.
      if(error.statusCode!==503)throw error;
    }
  }
  const scopeByView = { materials: 'materials', activities: 'events', services: 'events', outreach: 'outreach', community: 'community' };
  const visibleItems = items.filter((item) => allowed.has(scopeByView[item.view]));
  const priority = { high: 0, medium: 1, low: 2 };
  visibleItems.sort((a, b) => priority[a.priority] - priority[b.priority]);
  return { ok: true, stats: { total: visibleItems.length, high: visibleItems.filter((item) => item.priority === 'high').length, medium: visibleItems.filter((item) => item.priority === 'medium').length, low: visibleItems.filter((item) => item.priority === 'low').length }, items: visibleItems.slice(0, 24), sources: { materials: allowed.has('materials') && Boolean(materials), events: allowed.has('events') && Boolean(events), outreach: allowed.has('outreach') && Boolean(outreach), volunteer: allowed.has('events') && Boolean(volunteer), community: allowed.has('community'), portal: true } };
}
async function getEventsOverview(client, { notificationsOnly = false } = {}) {
  const [projects, sessions, registrations] = await Promise.all([
    listAllRows(client, eventProjectTable),
    notificationsOnly ? [] : listAllRows(client, eventSessionTable),
    notificationsOnly ? [] : listAllRows(client, eventRegistrationTable),
  ]);
  assertCompleteRows(projects, sessions, registrations);
  if (notificationsOnly) return { events: projects.map(row => eventSummary(row)) };
  return {
    ok: true, source: { table: eventProjectTable, mode: 'managed-events', reads: { projects: readMeta(projects), sessions: readMeta(sessions), registrations: readMeta(registrations) } },
    stats: { projects: projects.length, sessions: sessions.length, registrations: registrations.length, confirmed: registrations.filter((row) => row['报名状态'] === '已确认').length, waitlisted: registrations.filter((row) => row['报名状态'] === '候补').length, checkedIn: registrations.filter((row) => String(row['签到时间'] || '').trim()).length },
    series: dailySeries(registrations, {
      registrations: (row) => row['提交时间'] || null,
      checkins: (row) => row['签到时间'] || null,
      cancellations: (row) => row['取消时间'] || null,
    }),
    events: projects.map((row) => eventSummary(row, sessions, registrations)),
  };
}

/**
 * Shared registration pipeline used by both the console and the public portal.
 * Capacity, duplicate detection and waitlist ordering are always evaluated on
 * the server so the browser cannot bypass them.
 */
async function registerForEvent(client, { eventKey, body, participantRef, restrictEmailDomain = false }) {
  const name = requiredText(body.name, '姓名', 60);
  const email = requiredText(body.email, '邮箱', 160);
  if (restrictEmailDomain) assertPublicEmail(email);
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, '邮箱格式不正确');
  if (body.consent !== true) throw httpError(400, '必须确认报名授权');

  const [projects, sessions, registrations] = await Promise.all([
    listAllRows(client, eventProjectTable),
    listAllRows(client, eventSessionTable),
    listAllRows(client, eventRegistrationTable),
  ]);
  assertCompleteRows(projects, sessions, registrations);
  const project = projects.find((row) => row._id === eventKey || row['活动ID'] === eventKey);
  if (!project) throw httpError(404, '活动不存在');
  if (String(project['状态'] || '') !== '报名中') throw httpError(409, '当前活动尚未发布报名或报名已关闭');

  const sessionId = String(body.sessionId || '').trim();
  const selectedSession = sessionId ? sessions.find((row) => row._id === sessionId || row['场次ID'] === sessionId) : null;
  if (sessionId && (!selectedSession || selectedSession['活动ID'] !== project['活动ID'])) throw httpError(400, '所选活动场次不存在');

  const active = registrations.filter((row) => row['活动ID'] === project['活动ID'] && row['报名状态'] !== '已取消');
  if (active.some((row) => String(row['南大邮箱'] || '').toLowerCase() === email.toLowerCase())) throw httpError(409, '该邮箱已经报名，不能重复提交');

  const scopedActive = selectedSession ? active.filter((row) => String(row['场次ID'] || '') === String(selectedSession['场次ID'] || selectedSession._id)) : active;
  const capacity = Math.max(1, Math.floor(toFiniteNumber(selectedSession?.['容量'] || project['容量'])));
  const confirmed = scopedActive.filter((row) => ['已确认', '已签到'].includes(row['报名状态'])).length;
  const status = confirmed < capacity ? '已确认' : '候补';
  const waitlist = status === '候补' ? scopedActive.filter((row) => row['报名状态'] === '候补').length + 1 : 0;

  const registrationCode = eventIdentifier('REG');
  const checkinCode = randomCheckinCode();
  const row = {
    报名ID: registrationCode, 活动ID: project['活动ID'], 场次ID: String(selectedSession?.['场次ID'] || sessionId),
    参与者引用: participantRef, 显示姓名: name, 南大邮箱: email, 校区: String(body.campus || selectedSession?.['地点'] || project['校区'] || '').trim(),
    报名答案: JSON.stringify({ note: String(body.note || '').trim() }), 同意版本: 'v1', 报名状态: status, 候补序号: String(waitlist),
    签到码摘要: eventCheckinHash(eventCheckinToken(registrationCode, checkinCode)),
    提交时间: new Date().toISOString(), 取消时间: '', 签到时间: '',
  };
  const result = await client.appendRow(eventRegistrationTable, row);
  const token = eventCheckinToken(registrationCode, checkinCode);
  const qrDataUrl = await QRCode.toDataURL(`NJU-RC-CHECKIN:${token}`, { errorCorrectionLevel: 'M', margin: 1, color: { dark: '#520d2e', light: '#fffdfb' } });
  return { project, session: selectedSession, row, result, status, waitlist, token, qrDataUrl, capacity };
}

/* --------------------------------------------------------------------------
   Public projections — never include personal data
   -------------------------------------------------------------------------- */
function isPubliclyListed(project) {
  const status = String(project['状态'] || '');
  const visibility = String(project['公开范围'] || '');
  if (!['报名中', '进行中', '已结束'].includes(status)) return false;
  return !/不公开|仅管理员|内部限定/.test(visibility);
}

function publicEventProjection(project, sessions, registrations) {
  const eventId = String(project['活动ID'] || '');
  const related = registrations.filter((row) => String(row['活动ID'] || '') === eventId && row['报名状态'] !== '已取消');
  const capacity = Math.max(0, Math.floor(toFiniteNumber(project['容量'])));
  const confirmed = related.filter((row) => row['报名状态'] === '已确认').length;
  const waitlisted = related.filter((row) => row['报名状态'] === '候补').length;
  return {
    eventId,
    name: String(project['活动名称'] || '未命名活动'),
    type: String(project['活动类型'] || '公益活动'),
    description: String(project['活动简介'] || ''),
    campus: String(project['校区'] || ''),
    location: String(project['地点'] || ''),
    registrationStart: project['报名开始'] || null,
    registrationEnd: project['报名截止'] || null,
    startAt: project['活动开始'] || null,
    endAt: project['活动结束'] || null,
    status: String(project['状态'] || ''),
    capacity,
    confirmed,
    waitlisted,
    remaining: Math.max(0, capacity - confirmed),
    full: capacity > 0 && confirmed >= capacity,
    sessions: sessions
      .filter((row) => String(row['活动ID'] || '') === eventId)
      .map((row) => {
        const sessionKey = String(row['场次ID'] || row._id);
        const scoped = related.filter((item) => String(item['场次ID'] || '') === sessionKey);
        const sessionCapacity = Math.max(0, Math.floor(toFiniteNumber(row['容量'] || project['容量'])));
        const sessionConfirmed = scoped.filter((item) => item['报名状态'] === '已确认').length;
        return {
          sessionId: sessionKey,
          startAt: row['开始时间'] || null,
          endAt: row['结束时间'] || null,
          location: String(row['地点'] || project['地点'] || ''),
          capacity: sessionCapacity,
          confirmed: sessionConfirmed,
          remaining: Math.max(0, sessionCapacity - sessionConfirmed),
          full: sessionCapacity > 0 && sessionConfirmed >= sessionCapacity,
          checkinMethod: String(row['签到方式'] || ''),
        };
      })
      .sort((a, b) => String(a.startAt || '').localeCompare(String(b.startAt || ''))),
  };
}

const publicReadCache = createReadCache({ ttlMs: 10_000, staleMs: 20_000 });

/**
 * 公共快照的表级依赖。写操作只失效真正依赖被写表的快照：
 * 宣传投稿、物资申请等无关表写入不再清空活动目录。
 * 未列出的表不会触发失效，投影最多陈旧到自身 TTL（10s 新鲜 + 20s 陈旧窗口）。
 */
function publicSnapshotTables() {
  // 数据源未配置时 workflowMode 会抛错；失效逻辑不能因此让成功的写入变成失败。
  let bloodSourceTable = null;
  try { bloodSourceTable = workflowMode(process.env).bloodSourceTable; } catch { bloodSourceTable = null; }
  return {
    workflow: [...Object.values(WF), ORDINARY_GROUP_TABLE, bloodSourceTable].filter(Boolean),
    events: [eventProjectTable, eventSessionTable, eventRegistrationTable],
    overview: [inventoryTable],
  };
}

function invalidatePublicSnapshots(tables) {
  const changed = tables instanceof Set ? tables : new Set(tables || []);
  if (!changed.size) return;
  const deps = publicSnapshotTables();
  const touches = names => names.some(name => changed.has(name));
  const drop = keys => { for (const key of keys) publicReadCache.delete(key); };

  if (touches(deps.workflow)) return drop(['workflow', 'events', 'overview']);
  if (touches(deps.events)) return drop(['events', 'overview']);
  if (touches(deps.overview)) return drop(['overview']);
  return undefined;
}

function invalidateWrittenSnapshots(table) {
  try {
    if (table === ACCOUNT_TABLE) { invalidateAccountRefresh(); invalidateAccountsSnapshot(); }
    if ([ACCOUNT_TABLE, '个人主页（编辑版）'].includes(table)) invalidateEventDirectory();
    invalidateDisplayReads([table]);
    invalidatePublicSnapshots([table]);
  } catch {
    invalidateDisplayReads();
    publicReadCache.clear();
  }
}

// Shared by the activity catalogue and calendar; never used to approve a write.
function getPublicWorkflowData() {
  return publicReadCache.get('workflow', () => withDisplayReads(async () => (await getWorkflow()).publicRead()));
}

function getPublicEvents(client) {
  return publicReadCache.get('events', () => loadPublicEvents(client));
}

async function loadPublicEvents(client) {
  const [projects, sessions, registrations, workflow] = await Promise.all([
    listAllRows(client, eventProjectTable),
    listAllRows(client, eventSessionTable),
    listAllRows(client, eventRegistrationTable),
    ['production','test'].includes(process.env.PLATFORM_WORKFLOW_MODE) || process.env.PLATFORM_TEST_WORKFLOW === 'true'
      ? getPublicWorkflowData() : { events: [], registrations: [] },
  ]);
  return [...projects.filter(isPubliclyListed).map((project) => publicEventProjection(project, sessions, registrations)),
    ...projectWorkflowEvents(workflow.events, workflow.registrations)]
    .sort((a, b) => {
      const rank = (event) => (event.status === '报名中' ? 0 : event.status === '进行中' ? 1 : 2);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return String(a.startAt || '9999').localeCompare(String(b.startAt || '9999'));
    });
}
async function getMaterialsOverview(client, { notificationsOnly = false } = {}) {
  const [applicationsRaw, inventoryRaw, configRaw, flowRaw] = await Promise.all([
    listAllRows(client, materialsTable),
    listAllRows(client, inventoryTable),
    listAllRows(client, '物资配置表'),
    notificationsOnly ? Promise.resolve([]) : listAllRows(client, '物资流水表'),
  ]);

  assertCompleteRows(
    applicationsRaw,
    inventoryRaw,
    configRaw,
    ...(notificationsOnly ? [] : [flowRaw]),
  );

  const applications = applicationsRaw.map(applicationSummary);
  const applicationMap = new Map(applicationsRaw.map((row) => [row._id, row]));
  const configMap = new Map(configRaw.map((row) => [String(row['资产编码'] || ''), row]));
  const flowDelta = new Map();
  const flowStats = new Map();
  for (const flow of flowRaw) {
    const code = String(flow['资产编码'] || '');
    const quantity = toFiniteNumber(flow['数量']);
    const lossQuantity = Math.max(0, toFiniteNumber(flow['损耗数量']));
    const operation = String(flow['操作类型'] || '');
    const delta = ['入库', '归还', '盘点增加'].includes(operation) ? quantity : ['出库', '报损', '盘点减少'].includes(operation) ? -quantity : 0;
    if (code) flowDelta.set(code, (flowDelta.get(code) || 0) + delta);
    if (code) {
      const stats = flowStats.get(code) || { inbound: 0, outbound: 0, returned: 0, loss: 0, adjustment: 0, destinations: [] };
      if (operation === '入库') stats.inbound += quantity;
      if (operation === '出库') stats.outbound += quantity;
      if (operation === '归还') stats.returned += quantity;
      if (operation === '报损') stats.loss += quantity;
      stats.loss += operation === '归还' ? lossQuantity : 0;
      if (operation === '盘点增加') stats.adjustment += quantity;
      if (operation === '盘点减少') stats.adjustment -= quantity;
      const application = applicationMap.get(String(flow['申请单ID'] || ''));
      const flowDestination = String(flow['流转去向'] || '').trim();
      if (application || flowDestination) {
        const destination = { applicationId: application?._id || '', applicant: application ? maskedApplicant(application['姓名']) : '', purpose: application ? String(application['借用用途'] || '未填写') : '', label: flowDestination || `${maskedApplicant(application['姓名'])} · ${String(application['借用用途'] || '未填写')}`, quantity, date: flow['操作时间'] || null };
        if (!stats.destinations.some((item) => item.applicationId === destination.applicationId && item.purpose === destination.purpose)) stats.destinations.push(destination);
      }
      flowStats.set(code, stats);
    }
  }
  const inventory = inventoryRaw.map((row) => inventorySummary(row, { ...(configMap.get(materialCode(row)) || {}), __ledgerDelta: flowDelta.get(materialCode(row)) || 0, __flowStats: flowStats.get(materialCode(row)) || {} }));
  const pending = applications.filter((item) => item.status.includes('待审批') || item.approval === '待审核');
  const overdue = applications.filter((item) => item.overdueDays > 0);
  const abnormalReturns = applications.filter((item) => item.returnStatus.includes('物品缺失'));
  const lowStock = inventory.filter((item) => item.lowStock);
  const thresholdNotices = inventory.filter((item) => item.thresholdStatus === 'notice');
  const totalInitialQuantity = inventory.reduce((sum, item) => sum + item.initial, 0);
  const totalCurrentQuantity = inventory.reduce((sum, item) => sum + item.quantity, 0);
  const totalDifference = inventory.reduce((sum, item) => sum + item.difference, 0);
  const totalUntrackedDifference = inventory.reduce((sum, item) => sum + item.untrackedDifference, 0);
  const totalLossQuantity = inventory.reduce((sum, item) => sum + item.loss, 0);
  const recentFlows = flowRaw.slice().sort((a, b) => String(b['操作时间'] || b._mtime || '').localeCompare(String(a['操作时间'] || a._mtime || ''))).slice(0, 8).map((flow) => ({
    id: flow._id,
    operation: String(flow['操作类型'] || '未标注'),
    material: String(flow['物资名称'] || '未标注'),
    assetCode: String(flow['资产编码'] || ''),
    quantity: toFiniteNumber(flow['数量']),
    loss: toFiniteNumber(flow['损耗数量']),
    before: toFiniteNumber(flow['操作前数量']),
    after: toFiniteNumber(flow['操作后数量']),
    operator: String(flow['操作人'] || '未标注'),
    date: flow['操作时间'] || null,
    note: String(flow['异常说明'] || ''),
    destination: (() => { const direct = String(flow['流转去向'] || '').trim(); if (direct) return direct; const application = applicationMap.get(String(flow['申请单ID'] || '')); return application ? `${maskedApplicant(application['姓名'])} · ${String(application['借用用途'] || '未填写')}` : ''; })(),
  }));
  return {
    ok: true,
    policy: { thresholdRule: '优先采用配置表阈值；未配置时采用初始数量的 20%（至少 1，且不高于初始数量）', source: '物资配置表 + 物资流水表' },
    reads: { applications: readMeta(applicationsRaw), inventory: readMeta(inventoryRaw), config: readMeta(configRaw), flows: readMeta(flowRaw) },
    stats: { categoryCount: inventory.length, totalInventoryItems: inventory.length, totalInitialQuantity, totalCurrentQuantity, totalDifference, totalUntrackedDifference, totalLossQuantity, lowStockCount: lowStock.length, thresholdNoticeCount: thresholdNotices.length, pendingCount: pending.length, borrowedCount: applications.filter((item) => !item.returned && item.status.includes('借出')).length, overdueCount: overdue.length, abnormalReturnCount: abnormalReturns.length, flowCount: flowRaw.length },
    series: dailySeries(flowRaw, {
      inbound: (row) => (['入库', '归还', '盘点增加'].includes(String(row['操作类型'] || '')) ? [row['操作时间'], toFiniteNumber(row['数量'])] : null),
      outbound: (row) => (['出库', '报损', '盘点减少'].includes(String(row['操作类型'] || '')) ? [row['操作时间'], toFiniteNumber(row['数量'])] : null),
    }),
    inventory, applications: applications.sort((a, b) => b.overdueDays - a.overdueDays), pending, overdue, abnormalReturns, lowStock, thresholdNotices, recentFlows,
  };
}

function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()); }
const withEventMutation = createMutationQueue();
const withOutreachReview = createMutationQueue();
const materialLocks = new Map();
async function withMaterialLock(assetCode, task) {
  const previous = materialLocks.get(assetCode) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  materialLocks.set(assetCode, current);
  await previous;
  try {
    assertRequestActive();
    return await task();
  } finally {
    release();
    if (materialLocks.get(assetCode) === current) {
      materialLocks.delete(assetCode);
    }
  }
}
function operationDelta(operation, quantity) {
  if (['入库', '归还', '盘点增加'].includes(operation)) return quantity;
  if (['出库', '盘点减少', '报损'].includes(operation)) return -quantity;
  return 0;
}
async function materialBundle(client) {
  const [inventory, configs, flows] = await Promise.all([
    listAllRows(client, inventoryTable),
    listAllRows(client, '物资配置表'),
    listAllRows(client, '物资流水表'),
  ]);
  assertCompleteRows(inventory, configs, flows);
  const configMap = new Map(configs.map((row) => [String(row['资产编码'] || ''), row]));
  const deltaMap = new Map();
  for (const flow of flows) {
    const code = String(flow['资产编码'] || '');
    const qty = toFiniteNumber(flow['数量']);
    const delta = operationDelta(String(flow['操作类型'] || ''), qty);
    if (code) deltaMap.set(code, (deltaMap.get(code) || 0) + delta);
  }
  const summaries = inventory.map((row) => inventorySummary(row, { ...(configMap.get(materialCode(row)) || {}), __ledgerDelta: deltaMap.get(materialCode(row)) || 0 }));
  return { inventory, configs, flows, summaries, summaryByCode: new Map(summaries.map((item) => [item.code, item])) };
}

async function sendOverdueReminders() {
  return withRequestBudget(
    () => withSharedWriteLock(() => sendOverdueRemindersUnlocked()),
  );
}

async function sendOverdueRemindersUnlocked() {
  if (!smtpHost || !smtpUser || !smtpPassword || !reminderFrom) return { skipped: true, reason: 'SMTP is not configured' };
  const client = await getBase();
  const [applications, flows] = await Promise.all([
    listAllRows(client, materialsTable),
    listAllRows(client, '物资流水表'),
  ]);
  assertCompleteRows(applications, flows);

  let sent = 0;
  for (const application of applications) {
    assertRequestActive();
    const email = String(application['邮箱'] || '').trim();
    const overdueDays = daysLate(application['拟归还日期']);
    const returned = Boolean(application['实际归还日期']) || String(application['归还状态'] || '').includes('已全部归还') || String(application['状态'] || '').includes('已归还');
    if (!email || !overdueDays || returned) continue;
    const key = `OVERDUE:${application._id}:${today()}`;
    if (flows.some((flow) => flow['幂等键'] === key)) continue;
    const delivery = await sendMail({
      to: email,
      subject: `南京大学红十字会物资归还提醒：已逾期 ${overdueDays} 天`,
      text: `您好，您借用的物资“${application['借用物资名及数量'] || ''}”已逾期 ${overdueDays} 天。请联系物资管理员尽快归还。借用用途：${application['借用用途'] || ''}。`,
      kind: 'overdue',
      idempotencyKey: key,
    });

    if (!delivery.ok) continue;
    await client.appendRow('物资流水表', {
      '流水编号': `REM-${randomBytes(7).toString('hex').toUpperCase()}`,
      '申请单ID': application._id,
      '资产编码': '',
      '物资名称': String(application['借用物资名及数量'] || '借用申请'),
      '操作类型': '逾期提醒',
      '数量': 0,
      '操作前数量': 0,
      '操作后数量': 0,
      '操作人': 'system-reminder',
      '操作时间': today(),
      '异常说明': `邮件已发送至 ${email}`,
      '幂等键': key,
    });
    sent += 1;
  }
  return { skipped: false, sent };
}
function transactionPayload(body, session, item) {
  const operation = String(body.operation || '').trim();
  const allowed = ['入库', '出库', '归还', '盘点增加', '盘点减少', '报损'];
  if (!allowed.includes(operation)) { const error = new Error('Unsupported material operation'); error.statusCode = 400; throw error; }
  const quantity = Math.round(toFiniteNumber(body.quantity));
  if (!Number.isInteger(quantity) || quantity <= 0) { const error = new Error('Quantity must be a positive integer'); error.statusCode = 400; throw error; }
  const lossQuantity = Math.round(toFiniteNumber(body.lossQuantity));
  if (!Number.isInteger(lossQuantity) || lossQuantity < 0 || lossQuantity > quantity) { const error = new Error('Loss quantity must be between 0 and the transaction quantity'); error.statusCode = 400; throw error; }
  const after = item.quantity + operationDelta(operation, quantity);
  if (after < 0) { const error = new Error(`Insufficient stock: available ${item.quantity} ${item.unit}`); error.statusCode = 409; throw error; }
  const idempotencyKey = String(body.idempotencyKey || '').trim() || randomBytes(16).toString('hex');
  return {
    row: { '流水编号': `TX-${randomBytes(7).toString('hex').toUpperCase()}`, '申请单ID': String(body.applicationId || ''), '资产编码': item.code, '物资名称': item.name, '操作类型': operation, '数量': quantity, '操作前数量': item.quantity, '操作后数量': after, '操作人': session.username, '操作时间': today(), '异常说明': String(body.note || '').trim(), '流转去向': String(body.destination || '').trim(), '损耗数量': lossQuantity, '幂等键': idempotencyKey },
    idempotencyKey,
  };
}

function materialRequestPayload(body) {
  const required = ['name', 'studentId', 'email', 'purpose', 'items', 'plannedBorrowDate', 'plannedReturnDate'];
  for (const key of required) {
    if (!String(body[key] || '').trim()) { const error = new Error(`Missing required field: ${key}`); error.statusCode = 400; throw error; }
  }
  const borrowDate = parsedDate(body.plannedBorrowDate);
  const returnDate = parsedDate(body.plannedReturnDate);
  if (!borrowDate || !returnDate || returnDate < borrowDate) { const error = new Error('Planned return date must be on or after the planned borrow date'); error.statusCode = 400; throw error; }
  return {
    '姓名': String(body.name).trim(), '学号': String(body.studentId).trim(), '邮箱': String(body.email).trim(), '借用用途': String(body.purpose).trim(), '借用物资名及数量': String(body.items).trim(), '借用件数': Math.max(1, Math.round(toFiniteNumber(body.quantity) || 1)),
    '拟借用日期': body.plannedBorrowDate, '拟归还日期': body.plannedReturnDate, '状态': '待审批',
  };
}

function hash(value) { return createHash('sha256').update(String(value)).digest(); }
function safeEqual(left, right) { return timingSafeEqual(hash(left), hash(right)); }
function sign(value) { return createHmac('sha256', sessionSecret).update(value).digest('base64url'); }

function cookieValue(req, name) {
  const prefix = `${name}=`;
  const value = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function makeSession(account) {
  const claims = { username: account.username, role: account.role, exp: Date.now() + sessionTtlSeconds * 1000, csrf: randomBytes(32).toString('base64url') };
  // Table accounts carry identity attributes that outlive a restart-less
  // registration, so they travel inside the signed token itself.
  claims.authVersion = sign(credentialVersion(account));
  if (account.memberCode) claims.memberCode = account.memberCode;
  if (account.email) claims.email = account.email;
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function getSession(req) {
  const token = cookieValue(req, 'nju_redcross_session');
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const account = accountsByUsername.get(session.username);
    // A disabled/retired account invalidates its existing session immediately
    // in this process; it cannot keep operating until the cookie expires.
    if (!canAuthenticate(account) || session.role !== account.role || !session.csrf || !Number.isFinite(session.exp) || session.exp <= Date.now() || revokedSessions.has(session.csrf) || session.authVersion !== sign(credentialVersion(account))) return null;
    return session;
  } catch { return null; }
}

function sessionCookie(value, maxAge = sessionTtlSeconds) {
  // Lax keeps the session when a link is opened from WeChat, mail or another
  // app; cross-site writes stay blocked by SameSite plus the CSRF token.
  return `nju_redcross_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
}

function clientIp(req) {
  const peer = req.socket.remoteAddress || 'unknown';
  // Only the local reverse proxy may supply client identity.
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) {
    const forwarded = String(req.headers['x-real-ip'] || '');
    if (/^[0-9a-fA-F:.]+$/.test(forwarded) && forwarded.length <= 45) return forwarded;
  }
  return peer;
}
const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
// Guessing one password must stop early, while a shared campus egress must not
// lock out everyone behind it after a handful of typos from one device.
const LOGIN_ACCOUNT_FAIL_LIMIT = 5;
const LOGIN_IP_FAIL_LIMIT = 25;
function loginAttemptKey(scope, value) { return `${scope}:${String(value || '').trim().toLowerCase()}`; }
function currentAttempt(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry) return { now, entry: null };
  if (entry.resetAt <= now) { loginAttempts.delete(key); return { now, entry: null }; }
  return { now, entry };
}
function loginStatus(ip, username = '') {
  const { now, entry: accountEntry } = currentAttempt(loginAttemptKey('account', `${ip}|${username}`));
  const ipState = currentAttempt(loginAttemptKey('ip', ip));
  const blocked = [accountEntry, ipState.entry].filter(entry => entry && entry.blockedUntil > now);
  if (!blocked.length) return { allowed: true };
  return {
    allowed: false,
    retryAfter: Math.ceil((Math.max(...blocked.map(entry => entry.blockedUntil)) - now) / 1000),
  };
}
function recordFailedLogin(ip, username = '') {
  const now = Date.now();
  const targets = [
    { key: loginAttemptKey('account', `${ip}|${username}`), limit: LOGIN_ACCOUNT_FAIL_LIMIT },
    { key: loginAttemptKey('ip', ip), limit: LOGIN_IP_FAIL_LIMIT },
  ];
  for (const { key, limit } of targets) {
    const { entry } = currentAttempt(key);
    const next = entry || { attempts: 0, resetAt: now + LOGIN_FAIL_WINDOW_MS, blockedUntil: 0 };
    next.attempts += 1;
    if (next.attempts >= limit) next.blockedUntil = now + LOGIN_FAIL_WINDOW_MS;
    loginAttempts.set(key, next);
  }
}
/** A correct password for this mailbox clears only its own counter. */
function clearLoginFailures(ip, username = '') {
  loginAttempts.delete(loginAttemptKey('account', `${ip}|${username}`));
}

function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { ok: false, code: 'login_required', message: '请先登录平台。' });
    return null;
  }
  return session;
}

/**
 * Console guard. A signed-in member is told plainly that this surface is not
 * theirs, instead of being bounced to a login form they have already passed.
 */
function requireConsoleAccess(req, res, requiredScope = null) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { ok: false, code: 'login_required', message: '请先登录管理平台。' });
    return null;
  }
  if (!consoleRoles.has(session.role)) {
    json(res, 403, { ok: false, code: 'console_forbidden', message: '当前账号属于活动平台，没有管理平台权限。' });
    return null;
  }
  const account = accountsByUsername.get(session.username);
  if (requiredScope && !hasPermission(account, requiredScope)) {
    json(res, 403, { ok: false, code: 'permission_denied', requiredScope, message: `当前账号没有 ${requiredScope} 模块权限。` });
    return null;
  }
  return session;
}

/** Portal guard. Any signed-in account may use the student surface. */
function requirePortalSession(req, res) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { ok: false, code: 'login_required', message: '该操作需要先登录活动平台。' });
    return null;
  }
  return session;
}

function requireCsrf(req, res, session) {
  const csrf = req.headers['x-csrf-token'];
  if (typeof csrf !== 'string' || !safeEqual(csrf, session.csrf)) {
    json(res, 403, { ok: false, code: 'csrf_failed', message: 'CSRF 校验失败，请刷新页面后重试。' });
    return false;
  }
  return true;
}

/** Combined guard for student-surface writes: signed in, then CSRF checked. */
function requirePortalWrite(req, res) {
  const session = requirePortalSession(req, res);
  if (!session) return null;
  if (!requireCsrf(req, res, session)) return null;
  return session;
}

function businessAccountRef(session) {
  return accountsByUsername.get(session.username)?.accountId || session.username;
}
function ownsBusinessRef(session, value) {
  return [session.username,businessAccountRef(session)].includes(String(value || ''));
}

function sessionPayload(session) {
  const account = accountsByUsername.get(session.username);
  const role = roleDefinitions[session.role];
  return {
    ok: true,
    authenticated: true,
    user: {
      username: session.username,
      accountId: account?.accountId || null,
      label: account?.label || session.username,
      role: session.role,
      roleLabel: role?.label || session.role,
      surfaces: role?.surfaces || [],
      consoleAccess: consoleRoles.has(session.role),
      reimbursementsEnabled: reimbursementFeatureEnabled(reimbursementConfig),
      financePermissions: productionFinancePermissions(account, currentFinanceBindings()),
      activityWorkspaceV2: true,
      permissions: normalizePermissions(account?.permissions, session.role),
      memberCode: account?.memberCode || session.memberCode || null,
      email: account?.email || session.email || null,
      realName: account?.realName || null,
      studentId: account?.studentId || null,
      phone: account?.phone || null,
      // v3 第 3/12 项：笔名（首次填写即绑定，绑定后不可改）
      penName: account?.penName || null,
      skillLevel: account?.skillLevel || null,
    },
    csrfToken: session.csrf,
    expiresAt: session.exp,
  };
}

async function eventSessionPayload(session){
 const payload=sessionPayload(session);
 if(!organizationEvents)return payload;
 let access,unavailable=false;
 try{access=await eventAuthority(session);}catch{unavailable=true;}
 return projectEventSessionAccess(payload,access,{unavailable});
}

async function authApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const session = getSession(req);
    return json(res, 200, session ? await eventSessionPayload(session) : { ok: true, authenticated: false });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const ip = clientIp(req);
    const status = loginStatus(ip);
    // The pre-flight gate cannot know the mailbox yet; the post-check below
    // applies the stricter per-account limit once the identifier is read.
    if (!status.allowed) return json(res, 429, { ok: false, message: `登录尝试过多，请 ${status.retryAfter} 秒后重试。` }, { 'Retry-After': String(status.retryAfter) });
    const body = await readJson(req);
    const username = String(body.username || '').trim().toLowerCase();
    if (username.length > 160 || typeof body.password !== 'string' || body.password.length > 72) return json(res, 400, { ok: false, message: '账号或密码格式不正确。' });
    let account;
    if (accountLoad.source.startsWith('seatable:')) {
      // Always reload the authoritative record; password and status changes cannot
      // fall back to stale cached credentials when SeaTable is unavailable.
      const resolved = await resolveSignInAccount(await getIdentityBase(), username);
      if (resolved.ambiguous) {
        recordFailedLogin(ip, username);
        return json(res,409,{ok:false,code:'ambiguous_login',message:'姓名或学号对应多个账号，请使用校园邮箱或唯一学号登录。'});
      }
      account = resolved.account;
      if (account) accountsByUsername.set(account.username, account);
    } else {
      account = accountsByUsername.get(username);
    }
    return withIdentityAccountLock(account?.email || account?.username || username, async () => {
    // A concurrent reset may finish while resolving a login alias. Reload under
    // the same mailbox lock used by reset/verification before checking secrets.
    if (account && accountLoad.source.startsWith('seatable:')) {
      account = await findAccountByLogin(await getIdentityBase(), account.username);
      if (account) accountsByUsername.set(account.username, account);
    }
    // Table accounts carry a scrypt hash; file-bootstrap accounts still hold a
    // plaintext password, so both paths must be accepted during the migration.
    const supplied = String(body.password || '');
    const passwordOk = Boolean(account) && (account.passwordHash
      ? await verifyPassword(supplied, account.passwordHash)
      : safeEqual(supplied, account.password));
    const active = Boolean(account) && (!account.status || account.status === '启用');
    if (!account || !passwordOk || !active) {
      // Recheck after async lookup/password work: concurrent failures must not
      // bypass the limit, while concurrent legitimate users behind NAT can enter.
      const latest = loginStatus(ip, username);
      if (!latest.allowed) return json(res, 429, { ok: false, message: `登录尝试过多，请 ${latest.retryAfter} 秒后重试。`, retryAfter: latest.retryAfter }, { 'Retry-After': String(latest.retryAfter) });
      recordFailedLogin(ip, username);
      return json(res, 401, { ok: false, message: '用户名或密码错误。' });
    }
    if (!canAuthenticate(account)) return json(res, 403, { ok: false, code: 'email_verification_required', email: account.email, message: '请先完成校园邮箱验证，再登录。' });
    if (account.rowId) await (await getIdentityBase()).updateRow(ACCOUNT_TABLE, account.rowId, { 最近登录: new Date().toISOString() });
    await recordAudit(req, account, 'identity.login', account.username, 'success', {});
    clearLoginFailures(ip, username);
    const token = makeSession(account);
    const session = getSession({ headers: { cookie: `nju_redcross_session=${token}` } });
    return json(res, 200, await eventSessionPayload(session), { 'Set-Cookie': sessionCookie(token) });
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const session = requireSession(req, res);
    if (!session || !requireCsrf(req, res, session)) return;
    try {
      await revokedSessions.revoke(session.csrf, session.exp);
    } catch {
      return json(res, 503, {
        ok: false,
        code: 'session_revocation_unavailable',
        message: '退出登录记录保存失败，请稍后重试。',
      });
    }
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  return false;
}

const publicPrograms = [
  { id: 'events', name: '活动报名与现场签到', summary: '急救培训、无偿献血宣传、生命教育课程与校园公益活动的统一报名入口，报名后生成个人签到凭证。', action: '/events', iconName: 'calendar' },
  { id: 'materials', name: '物资借用申请', summary: '面向班级、社团与校园活动的急救箱、宣传物料与器材借用；申请提交后由物资管理员审批并登记出入库。', action: '/materials', iconName: 'box' },
  { id: 'outreach', name: '宣传内容征集', summary: '投递稿件、摄影、设计与活动记录。所有内容均经过人工审核，并在你授权的范围内使用。', action: '/submit', iconName: 'megaphone' },
  { id: 'warmth', name: '温暖连接', summary: '生日祝福与早安晚安同行计划。完全自愿加入、随时退出，内容先经人工审核后再转达。', action: '/warmth', iconName: 'heart' },
];

function getPublicOverview(client) {
  return publicReadCache.get('overview', () => loadPublicOverview(client));
}

async function loadPublicOverview(client) {
  const [events, inventory] = await Promise.all([
    getPublicEvents(client),
    listAllRows(client, inventoryTable),
  ]);
  assertCompleteRows(events, inventory);
  const open = events.filter((event) => event.status === '报名中');
  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    stats: {
      openEvents: open.length,
      openSeats: open.reduce((sum, event) => sum + event.remaining, 0),
      totalRegistrations: events.reduce((sum, event) => sum + event.confirmed + event.waitlisted, 0),
      inventoryCategories: inventory.length,
      volunteerRecords: null,
    },
    featured: open.slice(0, 6),
    recent: events.filter((event) => event.status !== '报名中').slice(0, 4),
    programs: publicPrograms,
    emailDomains: publicEmailDomains,
  };
}

/**
 * Student surface. Reading is open so anyone can browse activities, materials
 * and the warmth programme before deciding to take part; creating a record, or
 * reading back one's own records, requires a signed-in account. Every write is
 * additionally rate limited, consent gated and never echoes personal data.
 */
async function publicRoutes(req, res, url) {
  if (!url.pathname.startsWith('/api/public/')) return false;
  if (req.method === 'GET' && url.pathname === '/api/public/warmth/capabilities') {
    return json(res, 200, { ok: true, ...await warmthCapabilities() });
  }
  const client = await getBase();
  if (url.pathname === '/api/public/cranes') {
    const session = req.method === 'POST' ? requirePortalWrite(req, res) : null;
    if (req.method === 'POST' && !session) return;
    if (req.method === 'POST') enforcePublicLimit(req, 'crane-message', 5, session.username);
    return await craneRoutes(req, res, url, { base: client, session, json, readJson, audit: recordAudit });
  }
  if (birthdayRollout.enabled && url.pathname.startsWith('/api/public/warmth/')) await assertBirthdayReady(client);
  if (url.pathname.startsWith('/api/public/materials/') && await publicMaterialRoutes(req, res, url, { portal: publicMaterialsPortal, client, json,
    actorFor: materialPortalActor, requirePortalSession, requirePortalWrite,
    enforceLimit: enforcePublicLimit, readJson, recordAudit }) !== false) return;

  if (req.method === 'GET' && url.pathname === '/api/public/overview') {
    return json(res, 200, await getPublicOverview(client));
  }

  if (req.method === 'GET' && url.pathname === '/api/public/events') {
    const all = await getPublicEvents(client);
    const status = String(url.searchParams.get('status') || '').trim();
    const region = String(url.searchParams.get('region') || '').trim();
    const kind = String(url.searchParams.get('kind') || '').trim();
    const campus = String(url.searchParams.get('campus') || '').trim();
    const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const filtered = all.filter((event) => {
      if (region && activityRegion(event) !== region) return false;
      if (kind && activityKind(event) !== kind) return false;
      if (status && event.status !== status) return false;
      if (campus && event.campus !== campus) return false;
      if (query && !`${event.name} ${event.type} ${event.description} ${event.location}`.toLowerCase().includes(query)) return false;
      return true;
    });
    return json(res, 200, {
      ok: true,
      stats: { total: all.length, open: all.filter((event) => event.status === '报名中').length, closed: all.filter((event) => event.status === '已结束').length },
      facets: {
        regions: ['nanjing', 'suzhou'],
        categories: categoryFacets(all),
        campuses: [...new Set(all.map((event) => event.campus).filter(Boolean))],
        types: [...new Set(all.map((event) => event.type).filter(Boolean))],
        statuses: [...new Set(all.map((event) => event.status).filter(Boolean))],
      },
      events: filtered,
    });
  }

  const eventDetail = url.pathname.match(/^\/api\/public\/events\/([^/]+)$/);
  if (eventDetail && req.method === 'GET') {
    const key = decodeURIComponent(eventDetail[1]);
    const events = await getPublicEvents(client);
    const event = events.find((item) => item.eventId === key);
    if (!event) return json(res, 404, { ok: false, message: '活动不存在或尚未公开。' });
    return json(res, 200, { ok: true, event, related: events.filter((item) => item.eventId !== key && item.status === '报名中').slice(0, 3), emailDomains: publicEmailDomains });
  }

  const publicRegistration = url.pathname.match(/^\/api\/public\/events\/([^/]+)\/registrations$/);
  if (publicRegistration && req.method === 'POST') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    enforcePublicLimit(req, 'register', 6);
    const body = await readJson(req);
    const account=accountsByUsername.get(session.username);
    if(!account?.emailVerified||!account.realName)return json(res,403,{ok:false,message:'请先在会员中心完善真实姓名并完成邮箱验证。'});
    const outcome = await registerForEvent(client, {
      eventKey: decodeURIComponent(publicRegistration[1]),
      body:{...body,name:account.realName,email:account.email},
      participantRef: businessAccountRef(session),
      restrictEmailDomain: true,
    });
    await recordAudit(req, session, 'public.event.registration', outcome.row['报名ID'], 'success', { eventId: outcome.project['活动ID'], status: outcome.status });
    return json(res, 201, {
      ok: true,
      registration: {
        code: outcome.row['报名ID'],
        status: outcome.status,
        waitlist: outcome.waitlist,
        eventName: outcome.project['活动名称'],
        sessionStartAt: outcome.session?.['开始时间'] || outcome.project['活动开始'] || null,
        location: outcome.session?.['地点'] || outcome.project['地点'] || '',
        checkinToken: outcome.token,
        qrDataUrl: outcome.qrDataUrl,
      },
      message: outcome.status === '已确认' ? '报名成功，请保存签到凭证。' : `活动名额已满，你目前是候补第 ${outcome.waitlist} 位。`,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/public/registrations/lookup') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    enforcePublicLimit(req, 'lookup', 30);
    const body = await readJson(req);
    const code = requiredText(body.code, '报名编号', 60);
    const email = String(body.email || '').trim().toLowerCase();
    const [registrations, projects, sessions] = await Promise.all([
      safeRows(client, eventRegistrationTable),
      safeRows(client, eventProjectTable),
      safeRows(client, eventSessionTable),
    ]);
    const record = registrations.find((row) => {
      if (String(row['报名ID'] || '').toUpperCase() !== code.toUpperCase()) return false;
      // Either the record belongs to the signed-in account, or the caller
      // proved ownership with the exact mailbox used at registration time.
      if (ownsBusinessRef(session,row['参与者引用'])) return true;
      return Boolean(email) && email === String(accountsByUsername.get(session.username)?.email || '').toLowerCase() && String(row['南大邮箱'] || '').toLowerCase() === email;
    });
    if (!record) return json(res, 404, { ok: false, message: '没有找到匹配的报名记录，请核对报名编号与邮箱。' });
    const project = projects.find((row) => row['活动ID'] === record['活动ID']);
    const eventSession = sessions.find((row) => String(row['场次ID'] || '') === String(record['场次ID'] || ''));
    return json(res, 200, {
      ok: true,
      registration: {
        code: String(record['报名ID'] || ''),
        status: String(record['报名状态'] || ''),
        waitlist: toFiniteNumber(record['候补序号']),
        submittedAt: record['提交时间'] || null,
        checkedInAt: record['签到时间'] || null,
        cancelledAt: record['取消时间'] || null,
        eventName: String(project?.['活动名称'] || '未命名活动'),
        eventStatus: String(project?.['状态'] || ''),
        startAt: eventSession?.['开始时间'] || project?.['活动开始'] || null,
        location: String(eventSession?.['地点'] || project?.['地点'] || ''),
      },
    });
  }

  // ---- 文字稿件投稿（实名制）：姓名/学号由统一身份认证自动绑定，服务端强制 ----
  if (req.method === 'POST' && url.pathname === '/api/public/submissions/article') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    enforcePublicLimit(req, 'submissions', 8);
    const account = accountsByUsername.get(session.username);
    if (!account?.realName || !account?.studentId) {
      return json(res, 403, { ok: false, code: 'identity_incomplete', message: '账号实名信息不完整（缺少姓名或学号），请联系管理员补全后再投稿。' });
    }
    const body = await readJson(req);
    const title = requiredText(body.title, '标题', 120);
    const content = requiredText(body.content, '正文', 4000);
    // 联系邮箱强绑定账号本身（要求5）：忽略前端传入值，缺失即拒。
    if (!account.email) {
      return json(res, 403, { ok: false, code: 'email_missing', message: '账号未绑定联系邮箱，请联系管理员补全后再投稿。' });
    }
    const contactEmail = assertPublicEmail(String(account.email));
    // v3 第 15 项：推文栏目必选，且必须在 11 栏目字典内（决定审核对接人）。
    const articleCategory = String(body.articleCategory || '').trim();
    if (!articleCategory) {
      return json(res, 400, { ok: false, code: 'article_category_required', message: '请选择推文栏目。' });
    }
    if (!ARTICLE_CATEGORIES.includes(articleCategory)) {
      return json(res, 400, { ok: false, code: 'article_category_invalid', message: '推文栏目不在可选范围内。' });
    }
    if (body.originalConfirm !== true) return json(res, 400, { ok: false, message: '请确认内容为原创或已获得授权。' });
    if (body.consent !== true) return json(res, 400, { ok: false, message: '请确认内容使用范围与审核规则。' });
    const submission = {
      id: eventIdentifier('SUB'),
      title,
      content,
      category: '文字稿件',
      // 实名三要素：姓名与学号只认身份库，签名固定实名（禁止笔名/匿名）。
      signature: '实名署名',
      contactName: account.realName,
      contactEmail,
      studentId: account.studentId,
      designCategory: '',
      workTitle: '',
      articleCategory,
      submitterRef: businessAccountRef(session),
      originalConfirm: true,
      portraitConfirm: body.portraitConfirm === true,
      status: submissionStatusPending,
      submittedAt: new Date().toISOString(),
      consentVersion: 'v2',
      review: null,
      attachmentIds: [],
    };
    let boundAttachments = [];
    if (Array.isArray(body.attachmentIds) && body.attachmentIds.length) {
      const attachmentRows = await client.listRows(SUBMISSION_ATTACHMENT_TABLE, '', '', false, '', 1000);
      boundAttachments = attachmentApi.validateAttachmentBinding(session, body, attachmentRows, { ownsBusinessRef });
      submission.attachmentIds = boundAttachments.map(({ record }) => record.id);
    }
    await client.appendRow(outreachSubmissionTable, publicSubmissionRow(submission));
    const boundAt = new Date().toISOString();
    for (const { row } of boundAttachments) {
      await client.updateRow(SUBMISSION_ATTACHMENT_TABLE, row._id, { 投稿ID: submission.id, 绑定时间: boundAt });
    }
    await recordAudit(req, session, 'public.submission.article', submission.id, 'success', { length: content.length, attachments: boundAttachments.length, realName: account.realName });
    return json(res, 201, { ok: true, submission: { id: submission.id, status: submission.status, submittedAt: submission.submittedAt, title, attachmentCount: boundAttachments.length }, message: '投稿已提交，进入人工审核队列。' });
  }

  // ---- 文创设计投稿（笔名匿名）：不绑定实名与薪酬，对外仅展示笔名 ----
  if (req.method === 'POST' && url.pathname === '/api/public/submissions/design') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    enforcePublicLimit(req, 'submissions', 8);
    const body = await readJson(req);
    const title = requiredText(body.title, '文创名称', 120);
    const content = requiredText(body.content, '作品简介', 4000);
    const designCategory = requiredText(body.designCategory, '文创类别', 40);
    const penName = requiredText(body.penName, '笔名', 40);
    if (body.originalConfirm !== true) return json(res, 400, { ok: false, message: '请确认作品为原创或已获得授权。' });
    if (body.consent !== true) return json(res, 400, { ok: false, message: '请确认投稿规则与对外匿名展示方式。' });
    const submission = {
      id: eventIdentifier('DSN'),
      title,
      content,
      category: '文创设计',
      // 笔名匿名：对外署名=笔名；联系人/联系邮箱/学号一律不落表。
      // 投稿人引用保留 accountId 仅作内部审计与附件归属，不进入对外展示。
      signature: penName,
      contactName: '',
      contactEmail: '',
      studentId: '',
      designCategory,
      workTitle: title,
      submitterRef: businessAccountRef(session),
      originalConfirm: true,
      portraitConfirm: body.portraitConfirm === true,
      status: submissionStatusPending,
      submittedAt: new Date().toISOString(),
      consentVersion: 'v2',
      review: null,
      attachmentIds: [],
    };
    let boundAttachments = [];
    if (Array.isArray(body.attachmentIds) && body.attachmentIds.length) {
      const attachmentRows = await client.listRows(SUBMISSION_ATTACHMENT_TABLE, '', '', false, '', 1000);
      boundAttachments = attachmentApi.validateAttachmentBinding(session, body, attachmentRows, { ownsBusinessRef });
      submission.attachmentIds = boundAttachments.map(({ record }) => record.id);
    }
    await client.appendRow(outreachSubmissionTable, publicSubmissionRow(submission));
    const boundAt = new Date().toISOString();
    for (const { row } of boundAttachments) {
      await client.updateRow(SUBMISSION_ATTACHMENT_TABLE, row._id, { 投稿ID: submission.id, 绑定时间: boundAt });
    }
    await recordAudit(req, session, 'public.submission.design', submission.id, 'success', { designCategory, attachments: boundAttachments.length });
    return json(res, 201, { ok: true, submission: { id: submission.id, status: submission.status, submittedAt: submission.submittedAt, title, attachmentCount: boundAttachments.length }, message: '文创作品已提交，将以笔名对外展示。' });
  }

  if (!birthdayRollout.enabled && url.pathname.startsWith('/api/public/warmth/')) {
  if (req.method === 'POST' && url.pathname === '/api/public/warmth/interest') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    enforcePublicLimit(req, 'warmth', 5);
    const body = await readJson(req);
    const program = String(body.program || '').trim();
    if (!['birthday', 'morning'].includes(program)) return json(res, 400, { ok: false, message: '暂不支持该温暖连接项目。' });
    const frequency = String(body.frequency || '').trim();
    if (!['once', 'weekly'].includes(frequency)) return json(res, 400, { ok: false, message: '请选择有效的接收频率。' });
    const nickname = requiredText(body.nickname, '显示昵称', 40);
    const email = assertPublicEmail(requiredText(body.email, '联系邮箱', 160));
    if (body.consent !== true) return json(res, 400, { ok: false, message: '必须确认自愿参加、可随时退出与人工审核规则。' });
    const interests = await readWarmthInterests(client);
    if (interests.some((item) => item.email === email && item.program === program && item.status !== '已退出')) {
      return json(res, 409, { ok: false, message: '该邮箱已经登记过这个项目，无需重复提交。' });
    }
    const interest = {
      id: eventIdentifier('WARM'),
      program, frequency, nickname, email,
      campus: String(body.campus || '').trim(),
      birthdayMonthDay: program === 'birthday' ? String(body.birthdayMonthDay || '').trim().slice(0, 5) : '',
      note: String(body.note || '').trim().slice(0, 300),
      status: '待人工确认',
      consentVersion: 'v1',
      submittedAt: new Date().toISOString(),
    };
    await saveEnrollment(client, interest.id, {
      来源: portalEnrollmentSource,
      项目: interest.program,
      频率: interest.frequency,
      昵称: interest.nickname,
      参与者标识: businessAccountRef(session),
      邮箱: interest.email,
      校区: interest.campus,
      生日月日: interest.birthdayMonthDay,
      备注: interest.note,
      内容模式: 'reviewed',
      状态: interest.status,
      同意版本: interest.consentVersion,
      提交时间: interest.submittedAt,
      处理人: '',
      处理时间: '',
    });
    await recordAudit(req, session, 'public.warmth.interest', interest.id, 'success', { program, frequency });
    return json(res, 201, {
      ok: true,
      interest: { id: interest.id, program, frequency, status: interest.status },
      message: '已记录你的参加意愿。平台不会自动发送内容，所有内容都会先经人工审核。',
    });
  }

    return json(res, 503, { ok: false, code: 'birthday_disabled', message: '生日祝福升级尚未启用。' });
  }

  // ---- v3 第 5/15 项：文创/推文类型字典下发（公开只读，无需登录）----
  if (req.method === 'GET' && url.pathname === '/api/public/writing-types') {
    return json(res, 200, {
      ok: true,
      categories: [...DESIGN_CATEGORIES_DICT],
      articleCategories: [...ARTICLE_CATEGORIES],
      showcaseGroups: [...SHOWCASE_GROUPS],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/public/warmth/blessings') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    const actorRef = businessAccountRef(session);
    if (await isWarmthBlacklisted(client, actorRef)) return json(res, 403, { ok: false, message: '你已被移出生日祝福计划，无法继续投稿。' });
    enforcePublicLimit(req, 'warmth-blessing', 30, actorRef);
    const body = await readJsonObject(req);
    const nickname = cleanText(body.nickname, '昵称', 40);
    const content = cleanText(body.content, '祝福内容', 200, { allowNewlines: true });
    const delivery = cleanText(body.delivery, '投递方式', 20);
    if (!Object.hasOwn(WARMTH_DELIVERY_LABELS, delivery)) return json(res, 400, { ok: false, message: '请选择祝福的投递方式。' });
    if (body.consent !== true) return json(res, 400, { ok: false, message: '请确认祝福由本人撰写并接受人工审核。' });
    const friendTarget = delivery === 'friend' ? friendBlessingTarget(body) : null;
    if (friendTarget) await assertFriendSchema(client);
    // 按账号加锁：把「额度 / 仓库唯一性检查 + 写入」放进同一临界区，避免并发或重试绕过上限
    const outcome = await withWarmthLock(client, `warmth-submit:${actorRef}`, async () => {
      const enrollments = await readWarmthInterests(client, { 参与者标识: [actorRef] });
      const enrolled = enrollments.some((item) => item.program === 'birthday' && item.participantRef === actorRef && isConfirmedEnrollmentStatus(item.status));
      if (!enrolled) return { code: 403, payload: { ok: false, message: '请先加入生日祝福计划，再写祝福。' } };
      // 上限只由「进行中 + 已通过」占用；审核不通过的（已拒绝）不占额度，可重写。
      const myActiveSubmissions = (await readWarmthBlessings(client, { 提交人: session.username })).filter((item) => item.actor === session.username && item.status !== submissionStatusRejected && item.deliveryKey !== 'friend' && item.delivery !== '写给挚友');
      if (delivery !== 'friend' && myActiveSubmissions.length >= WARMTH_SUBMISSION_LIMIT) {
        return { code: 409, payload: { ok: false, message: `随机匹配与祝福仓库合计最多 ${WARMTH_SUBMISSION_LIMIT} 条；你已达到上限，仍可选择「写给挚友」（不占额度）。` } };
      }
      if (delivery === 'repository' && myActiveSubmissions.some((item) => item.deliveryKey === 'repository')) {
        return { code: 409, payload: { ok: false, message: '祝福仓库每人只能写一条；如需调整，请在会员中心「我写的生日祝福」里修改并重新提交。' } };
      }
      const resolvedDelivery = resolveWarmthDelivery();
      if (!resolvedDelivery.ok) return { code: 400, payload: { ok: false, message: resolvedDelivery.message } };
      const { targetStudentId, deliveryState, status } = resolvedDelivery;
      const blessingId = eventIdentifier('CARE');
      const submittedAt = new Date().toISOString();
      await client.appendRow(communitySubmissionTable, {
        投稿ID: blessingId,
        项目: 'birthday',
        内容: content,
        语气: '温暖',
        提交人: session.username,
        状态: status,
        审核意见: '',
        审核人: '',
        提交时间: submittedAt,
        审核时间: '',
        同意版本: 'v1',
        投递方式: WARMTH_DELIVERY_LABELS[delivery],
        目标学号: targetStudentId,
        投递条件: deliveryState,
        署名昵称: nickname,
        ...(friendTarget ? { 挚友邮箱: friendTarget.friendEmail, 挚友生日: friendTarget.friendBirthday, 计划投递日期: friendTarget.scheduledDate } : {}),
        附件: '',
      });
      await recordAudit(req, session, 'public.warmth.blessing.create', blessingId, 'success', { delivery });
      return { code: 201, payload: {
        ok: true,
        blessing: { id: blessingId, nickname, status, delivery: WARMTH_DELIVERY_LABELS[delivery], deliveryState, ...(friendTarget || {}) },
        message: '祝福已提交，等待管理员审核。',
      } };
    });
    return json(res, outcome.code, outcome.payload);
  }

  if (req.method === 'GET' && url.pathname === '/api/public/warmth/blessings/mine') {
    const session = requirePortalSession(req, res);
    if (!session) return;
    const actorRef = businessAccountRef(session);
    const actorAccount = accountsByUsername.get(session.username);
    const actorKeys = new Set([actorRef, session.username, actorAccount?.studentId].filter(Boolean).map(String));
    const [mine, enrollments] = await Promise.all([
      readWarmthBlessings(client, { 提交人: session.username }),
      readWarmthInterests(client, { 参与者标识: [...actorKeys] }),
    ]);
    const myBlessings = mine.filter((item) => item.actor === session.username);
    const friendIds = myBlessings.filter(item => item.deliveryKey === 'friend').map(item => item.id);
    const friendReceipts = friendIds.length ? await scopedWarmthRows(client, blessingDeliveryTable, { 投稿ID: friendIds }) : [];
    const myBirthdayEnrollment = enrollments.find((item) => item.program === 'birthday' && actorKeys.has(String(item.participantRef || '')));
    const approved = myBlessings.filter((item) => item.status === submissionStatusApproved).length;
    const approvedEarn = myBlessings.filter((item) => item.status === submissionStatusApproved && (item.deliveryKey === 'random' || item.deliveryKey === 'repository')).length;
    return json(res, 200, {
      ok: true,
      stats: { total: myBlessings.length, used: myBlessings.filter((item) => item.status !== submissionStatusRejected && item.deliveryKey !== 'friend' && item.delivery !== '写给挚友').length, limit: WARMTH_SUBMISSION_LIMIT, pending: myBlessings.filter((item) => item.status === submissionStatusPending).length, approved, revision: myBlessings.filter((item) => item.status === submissionStatusReturned).length, rejected: myBlessings.filter((item) => item.status === submissionStatusRejected).length, oneOnOneQuota: approvedEarn },
      blessings: myBlessings.map((item) => ({ ...item, campus: myBirthdayEnrollment?.campus || '', excerpt: item.content.slice(0, 60),
        ...(item.deliveryKey === 'friend' ? { friendDeliveryStatus:
          friendReceipts.some(row => row['投稿ID'] === item.id && row['来源'] === '写给挚友' && row['邮件状态'] === '已发送') ? '已发送'
            : friendReceipts.some(row => row['投稿ID'] === item.id && row['来源'] === '写给挚友' && row['邮件状态'] === '发送失败') ? '邮件待核对'
            : item.scheduledDate && item.scheduledDate < friendDeliveryDate() ? '已过期'
              : item.status === submissionStatusRejected ? '未通过审核'
              : item.status === submissionStatusApproved ? '等待生日投递' : '等待审核' } : {}),
      })),
    });
  }

  // 站内投递：只返回投递给本人的祝福（不是祝福库本身，公众端不展示祝福库）。
  if (req.method === 'GET' && url.pathname === '/api/public/warmth/blessings/delivered') {
    const session = requirePortalSession(req, res);
    if (!session) return;
    const account = accountsByUsername.get(session.username);
    const myStudentId = String(account?.studentId || '').trim();
    // 姓名自动取自个人资料（与同步到「个人主页（编辑版）」的姓名同源），无需任何填写
    const recipientName = String(account?.realName || '').trim();
    const actorRef = businessAccountRef(session);
    const deliveries = myStudentId ? await readWarmthDeliveries(client,
      { 收件人学号: myStudentId, 站内状态: DELIVERY_SITE_DONE }) : [];
    const submissionIds = [...new Set(deliveries.map(item => item.submissionId).filter(Boolean))];
    const [library, reports, submissions] = await Promise.all([
      readBlessingLibrary(client, { 投稿ID: submissionIds }, { classifySent: false }),
      readWarmthReports(client, { 投稿ID: submissionIds, 举报人标识: actorRef }),
      readWarmthBlessings(client, { 投稿ID: submissionIds }),
    ]);
    const authorRefs = [...new Set(library.flatMap(item => {
      const author = accountsByUsername.get(String(item.submitter || ''));
      return [author?.accountId, author?.username, item.submitter, author?.studentId].filter(Boolean).map(String);
    }))];
    const enrollments = await readWarmthInterests(client, { 参与者标识: authorRefs, 项目: 'birthday' });
    const bySubmission = new Map(library.map((item) => [item.submissionId, item]));
    // 写信时间：投稿表里的提交时间 → 只对外给「年月日 + 早/下/晚」，不下发精确时间戳
    const writtenLabelById = new Map(submissions.map((item) => [item.id, shanghaiOriginLabel(item.submittedAt)]));
    // 写信人的校区：投稿人账号 → 其生日祝福登记里填写的校区
    const campusOfSubmitter = (submitter) => {
      const account = accountsByUsername.get(String(submitter || ''));
      const refs = new Set([account?.accountId, account?.username, submitter, account?.studentId].filter(Boolean).map(String));
      return enrollments.find((item) => item.program === 'birthday'
        && (refs.has(String(item.participantRef || '')) || (item.studentId && refs.has(String(item.studentId)))))?.campus || '';
    };
    const mine = myStudentId
      ? deliveries.filter((row) => row.siteStatus === DELIVERY_SITE_DONE && row.studentId === myStudentId)
      : [];
    // 同一份祝福可能因多次触发（例如不同年份的生日）留下多条投递记录；
    // 收件列表与置顶举报横幅都按祝福（submissionId）去重，只保留最近一次送达，
    // 避免同一份祝福重复展示、同一条举报确认一次却消失多行。
    const latestBySubmission = new Map();
    for (const row of mine) {
      const previous = latestBySubmission.get(row.submissionId);
      if (!previous || String(row.deliveredAt || '') >= String(previous.deliveredAt || '')) latestBySubmission.set(row.submissionId, row);
    }
    const blessings = [...latestBySubmission.values()].map((row) => {
      const myReport = reports.find((report) => report.submissionId === row.submissionId && report.reporterRef === actorRef);
      return {
        id: row.id,
        submissionId: row.submissionId,
        content: bySubmission.get(row.submissionId)?.content || '',
        nickname: bySubmission.get(row.submissionId)?.nickname || '',
        senderCampus: campusOfSubmitter(bySubmission.get(row.submissionId)?.submitter),
        writtenLabel: writtenLabelById.get(row.submissionId) || '',
        // 管理员受理举报后会把祝福从祝福库撤下：收件列表据此隐藏，置顶举报状态仍保留
        withdrawn: String(bySubmission.get(row.submissionId)?.status || '') === LIBRARY_STATUS_WITHDRAWN,
        source: row.source,
        reported: Boolean(myReport),
        reportId: myReport?.id || '',
        reportStatus: myReport?.status || '',
        reportResolution: myReport?.resolutionNote || '',
        reportAcknowledged: Boolean(myReport?.acknowledgedAt),
        deliveredAt: row.deliveredAt,
      };
    }).filter((item) => item.content);
    return json(res, 200, { ok: true, recipientName, blessings });
  }

  // 举报：只有收到该祝福的人可以举报，必须填写理由；同一人对同一条只允许一次待处理举报。
  // 作者端：我写出的祝福已送出哪些（只暴露对方昵称，其他信息不公开）
  if (req.method === 'GET' && url.pathname === '/api/public/warmth/blessings/sent') {
    const session = requirePortalSession(req, res);
    if (!session) return;
    const library = await readBlessingLibrary(client, { 来源投稿人: session.username }, { classifySent: false });
    const deliveries = await readWarmthDeliveries(client, { 投稿ID: library.map(item => item.submissionId).filter(Boolean) });
    const enrollments = await readWarmthInterests(client,
      { 参与者标识: [...new Set(deliveries.map(item => item.recipientRef).filter(Boolean))] });
    const myIds = new Set(library.filter((item) => item.submitter === session.username).map((item) => item.submissionId));
    // 只暴露对方自己选择公开的昵称；没有昵称时固定显示「一位同学」，不回退账号显示名（避免泄露真实姓名）
    const nicknameOf = (ref) => {
      const enrollment = enrollments.find((item) => item.participantRef === ref);
      return String(enrollment?.nickname || '一位同学');
    };
    return json(res, 200, {
      ok: true,
      sent: deliveries
        .filter((row) => row.siteStatus === DELIVERY_SITE_DONE && myIds.has(row.submissionId))
        .map((row) => ({ submissionId: row.submissionId, recipientNickname: nicknameOf(row.recipientRef), source: row.source, deliveredAt: row.deliveredAt })),
    });
  }

  const warmthBlessingReport = url.pathname.match(/^\/api\/public\/warmth\/blessings\/([^/]+)\/report$/);
  if (warmthBlessingReport && req.method === 'POST') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    const actorRef = businessAccountRef(session);
    enforcePublicLimit(req, 'warmth-report', 5, actorRef);
    const blessingId = decodeURIComponent(warmthBlessingReport[1]);
    const body = await readJsonObject(req);
    const reason = cleanText(body.reason, '举报理由', 500, { allowNewlines: true });
    const account = accountsByUsername.get(session.username);
    const myStudentId = String(account?.studentId || '').trim();
    const outcome = await withWarmthLock(client, `warmth-report:${blessingId}:${actorRef}`, async () => {
      const received = (await readWarmthDeliveries(client, { 投稿ID: blessingId, 收件人学号: myStudentId })).some((row) => row.submissionId === blessingId
        && row.siteStatus === DELIVERY_SITE_DONE
        && myStudentId
        && row.studentId === myStudentId);
      if (!received) return { code: 403, payload: { ok: false, message: '只能举报已经送达给你的祝福。' } };
      const existing = (await readWarmthReports(client, { 投稿ID: blessingId, 举报人标识: actorRef })).find((row) => row.submissionId === blessingId && row.reporterRef === actorRef && row.status === REPORT_STATUS_PENDING);
      if (existing) return { code: 409, payload: { ok: false, message: '你已经举报过这条祝福，管理员正在处理。' } };
      const reportId = eventIdentifier('RPT');
      await client.appendRow(blessingReportTable, {
        举报ID: reportId,
        投稿ID: blessingId,
        举报人标识: actorRef,
        原因: reason,
        状态: REPORT_STATUS_PENDING,
        处理人: '',
        处理意见: '',
        处理时间: '',
        提交时间: new Date().toISOString(),
      });
      await recordAudit(req, session, 'public.warmth.blessing.report', reportId, 'success', { blessingId });
      return { code: 201, payload: { ok: true, report: { id: reportId, status: REPORT_STATUS_PENDING }, message: '举报已提交，管理员会尽快处理。' } };
    });
    return json(res, outcome.code, outcome.payload);
  }

  // 举报人确认处理结果：确认后该条不再在「内建广场」置顶横幅显示，举报记录本身保留。
  const warmthReportAck = url.pathname.match(/^\/api\/public\/warmth\/reports\/([^/]+)\/acknowledge$/);
  if (warmthReportAck && req.method === 'POST') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    const actorRef = businessAccountRef(session);
    const reportId = decodeURIComponent(warmthReportAck[1]);
    const row = (await scopedWarmthRows(client, blessingReportTable, { 举报ID: reportId })).find((item) => String(item['举报ID'] || '') === reportId);
    if (!row) return json(res, 404, { ok: false, message: '举报记录不存在' });
    if (String(row['举报人标识'] || '') !== actorRef) return json(res, 403, { ok: false, message: '只有举报人本人可以确认处理结果。' });
    const status = String(row['状态'] || '');
    if (status !== REPORT_STATUS_HANDLED && status !== REPORT_STATUS_DISMISSED) {
      return json(res, 409, { ok: false, message: '举报还在处理中，暂时不能确认。' });
    }
    let acknowledgedAt = row['举报人确认时间'] || '';
    if (!acknowledgedAt) {
      acknowledgedAt = new Date().toISOString();
      await client.updateRow(blessingReportTable, row._id, { 举报人确认时间: acknowledgedAt });
      await recordAudit(req, session, 'public.warmth.blessing.report.acknowledge', reportId, 'success', { status });
    }
    return json(res, 200, { ok: true, report: { id: reportId, status, acknowledgedAt }, message: '已确认，这条举报不再置顶显示。' });
  }

  const warmthBlessingResubmit = url.pathname.match(/^\/api\/public\/warmth\/blessings\/([^/]+)\/resubmit$/);
  if (warmthBlessingResubmit && req.method === 'POST') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    const actorRef = businessAccountRef(session);
    if (await isWarmthBlacklisted(client, actorRef)) return json(res, 403, { ok: false, message: '你已被移出生日祝福计划，无法继续投稿。' });
    const blessingId = decodeURIComponent(warmthBlessingResubmit[1]);
    const body = await readJsonObject(req);
    const nickname = cleanText(body.nickname, '昵称', 40);
    const content = cleanText(body.content, '祝福内容', 200, { allowNewlines: true });
    const delivery = cleanText(body.delivery, '投递方式', 20);
    if (!Object.hasOwn(WARMTH_DELIVERY_LABELS, delivery)) return json(res, 400, { ok: false, message: '请选择祝福的投递方式。' });
    if (body.consent !== true) return json(res, 400, { ok: false, message: '请确认祝福由本人撰写并接受人工审核。' });
    const friendTarget = delivery === 'friend' ? friendBlessingTarget(body) : null;
    if (friendTarget) await assertFriendSchema(client);
    const outcome = await withWarmthLock(client, `warmth-submit:${actorRef}`, async () => {
      const rows = await scopedWarmthRows(client, communitySubmissionTable, { 投稿ID: blessingId });
      const row = rows.find((item) => String(item['投稿ID'] || '') === blessingId);
      if (!row) return { code: 404, payload: { ok: false, message: '祝福不存在。' } };
      if (String(row['提交人'] || '') !== session.username) return { code: 403, payload: { ok: false, message: '只能修改自己的祝福。' } };
      const currentStatus = String(row['状态'] || '');
      const editableStatuses = [submissionStatusPending, submissionStatusReturned];
      if (!editableStatuses.includes(currentStatus)) {
        return { code: 409, payload: { ok: false, message: currentStatus === submissionStatusApproved ? '已通过的祝福不支持修改，只能删除。' : '这条祝福当前不能修改。' } };
      }
      const confirmedEnrollments = await readWarmthInterests(client, { 参与者标识: [actorRef] });
      const stillJoined = confirmedEnrollments.some((item) => item.program === 'birthday' && item.participantRef === actorRef && isConfirmedEnrollmentStatus(item.status));
      if (!stillJoined) return { code: 403, payload: { ok: false, message: '请先加入生日祝福计划，再重新提交祝福。' } };
      if (delivery !== 'friend') {
        const occupied = (await readWarmthBlessings(client, { 提交人: session.username })).filter(item =>
          item.actor === session.username && item.id !== blessingId && item.status !== submissionStatusRejected
          && item.deliveryKey !== 'friend' && item.delivery !== '写给挚友');
        if (occupied.length >= WARMTH_SUBMISSION_LIMIT) return { code: 409, payload: { ok: false, message: '随机匹配与祝福仓库的投稿名额已满，不能改为该类型；写给挚友不占额度。' } };
      }
      if (delivery === 'repository') {
        const otherRepository = (await readWarmthBlessings(client, { 提交人: session.username })).filter((item) => item.actor === session.username && item.id !== blessingId && item.status !== submissionStatusRejected && item.deliveryKey === 'repository');
        if (otherRepository.length) return { code: 409, payload: { ok: false, message: '祝福仓库每人只能写一条。' } };
      }
      const resolvedDelivery = resolveWarmthDelivery();
      if (!resolvedDelivery.ok) return { code: 400, payload: { ok: false, message: resolvedDelivery.message } };
      const { targetStudentId, deliveryState, status } = resolvedDelivery;
      const patch = {
        内容: content,
        署名昵称: nickname,
        ...(friendTarget ? { 挚友邮箱: friendTarget.friendEmail, 挚友生日: friendTarget.friendBirthday, 计划投递日期: friendTarget.scheduledDate }
          : row['挚友邮箱'] ? { 挚友邮箱: '', 挚友生日: '', 计划投递日期: '' } : {}),
        投递方式: WARMTH_DELIVERY_LABELS[delivery],
        目标学号: targetStudentId,
        投递条件: deliveryState,
        状态: status,
      };
      // 被退回后重新提交 → 刷新提交时间，重新进入审核序列；未审核时修改 → 保留原时间，不改变审核序列位置
      if (currentStatus === submissionStatusReturned) patch.提交时间 = new Date().toISOString();
      await client.updateRow(communitySubmissionTable, row._id, patch);
      await recordAudit(req, session, 'public.warmth.blessing.resubmit', blessingId, 'success', { delivery, from: currentStatus, to: status });
      const message = currentStatus === submissionStatusReturned
        ? '已重新提交，重新进入审核序列。'
        : '已保存修改，不改变审核顺序。';
      return { code: 200, payload: { ok: true, blessing: { id: blessingId, status, delivery: WARMTH_DELIVERY_LABELS[delivery], deliveryState, ...(friendTarget || {}) }, message } };
    });
    return json(res, outcome.code, outcome.payload);
  }

  // 删除自己的祝福：已通过的标记为「作者已删除」（退出匹配/投递，但已送达的收件人仍能看到内容）；已拒绝的直接重写即可，不提供删除
  const warmthBlessingDelete = url.pathname.match(/^\/api\/public\/warmth\/blessings\/([^/]+)\/delete$/);
  if (warmthBlessingDelete && req.method === 'POST') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    const blessingId = decodeURIComponent(warmthBlessingDelete[1]);
    const outcome = await withWarmthLock(client, `warmth-blessing:${blessingId}`, async () => {
      const row = (await scopedWarmthRows(client, communitySubmissionTable, { 投稿ID: blessingId })).find((item) => String(item['投稿ID'] || '') === blessingId);
      if (!row) return { code: 404, payload: { ok: false, message: '祝福不存在。' } };
      if (String(row['提交人'] || '') !== session.username) return { code: 403, payload: { ok: false, message: '只能删除自己的祝福。' } };
      const status = String(row['状态'] || '');
      if (status === submissionStatusRejected) return { code: 409, payload: { ok: false, message: '已拒绝的祝福无需删除，可直接「重写」一条。' } };
      if (status === submissionStatusApproved) {
        const entry = (await scopedWarmthRows(client, blessingLibraryTable, { 投稿ID: blessingId })).find((item) => String(item['投稿ID'] || '') === blessingId);
        if (entry && String(entry['状态'] || '') === LIBRARY_STATUS_ACTIVE) await client.updateRow(blessingLibraryTable, entry._id, { 状态: LIBRARY_STATUS_DELETED });
      }
      await client.deleteRow(communitySubmissionTable, row._id);
      await recordAudit(req, session, 'public.warmth.blessing.delete', blessingId, 'success', { status });
      return { code: 200, payload: { ok: true, message: '祝福已删除。' } };
    });
    return json(res, outcome.code, outcome.payload);
  }

  if (req.method === 'POST' && url.pathname === '/api/public/warmth/interest') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    const actorRef = businessAccountRef(session);
    enforcePublicLimit(req, 'warmth-join', 10, actorRef);
    const body = await readJsonObject(req);
    const program = cleanText(body.program, '项目', 20);
    if (!['birthday', 'morning'].includes(program)) return json(res, 400, { ok: false, message: '暂不支持该温暖连接项目。' });
    // Contact details always come from the verified account, never from the body.
    const account = accountsByUsername.get(session.username);
    const email = assertPublicEmail(String(account?.email || '').trim());
    if (body.consent !== true) return json(res, 400, { ok: false, message: '必须确认自愿参加、可随时退出与人工审核规则。' });
    const isBirthdayProgram = program === 'birthday';
    let nickname = '';
    let frequency = '';
    let campus = '';
    let birthdayMonthDay = '';
    let birthdayCalendar = 'solar';
    let note = '';
    if (isBirthdayProgram) {
      // Birthday is picked as month + day; the year is never collected or stored.
      birthdayMonthDay = cleanText(body.birthdayMonthDay, '生日月日', 5);
      birthdayCalendar = validateBirthdayCalendar(birthdayMonthDay, body.birthdayCalendar ?? 'solar');
      campus = cleanText(body.campus, '校区', 10);
      if (!WARMTH_CAMPUS_OPTIONS.includes(campus)) return json(res, 400, { ok: false, message: '请选择鼓楼、仙林、苏州或浦口校区。' });
    } else {
      nickname = cleanText(body.nickname, '显示昵称', 40);
      frequency = cleanText(body.frequency, '接收频率', 10);
      if (!['once', 'weekly'].includes(frequency)) return json(res, 400, { ok: false, message: '请选择有效的接收频率。' });
      campus = optionalCleanText(body.campus, '校区', 20);
      note = optionalCleanText(body.note, '备注', 300, { allowNewlines: true });
    }
    const outcome = await withWarmthLock(client, `warmth-interest:${actorRef}:${program}`, async () => {
      // 拉黑校验放进锁内，避免并发「拉黑 + 加入」的竞态
      if (await isWarmthBlacklisted(client, actorRef)) return { code: 403, payload: { ok: false, message: '你已被移出生日祝福计划，如有疑问请联系管理员。' } };
      const interests = await readWarmthInterests(client, { 参与者标识: [actorRef] });
      const active = interests.find((item) => item.participantRef === actorRef && item.program === program && isActiveEnrollmentStatus(item.status));
      if (active && (!isBirthdayProgram || isConfirmedEnrollmentStatus(active.status))) {
        return {
          code: 409,
          payload: {
            ok: false,
            message: isBirthdayProgram
              ? '你已报名生日祝福计划，请在会员中心修改或退出。'
              : '该账号已经登记过这个项目，无需重复提交。',
          },
        };
      }
      const submittedAt = new Date().toISOString();
      const inactive = interests.find((item) => item.participantRef === actorRef && item.program === program && (!isActiveEnrollmentStatus(item.status) || (isBirthdayProgram && item.status === enrollmentStatusPending)));
      // Joining the birthday programme is a self-service opt-in: the member is
      // active immediately, and only submitted content goes through review.
      const enrollmentStatus = isBirthdayProgram ? enrollmentStatusConfirmed : enrollmentStatusPending;
      const rowPatch = {
        频率: frequency,
        昵称: nickname,
        邮箱: email,
        校区: campus,
        生日月日: birthdayMonthDay,
        ...(isBirthdayProgram ? await birthdayCalendarPatch(client, birthdayCalendar) : {}),
        备注: note,
        内容模式: 'reviewed',
        参与者标识: actorRef,
        状态: enrollmentStatus,
        同意版本: 'v1',
        提交时间: submittedAt,
        处理人: isBirthdayProgram ? '系统自动确认' : '',
        处理时间: isBirthdayProgram ? submittedAt : '',
      };
      if (inactive) {
        await updateEnrollment(client, inactive.id, rowPatch);
        await recordAudit(req, session, 'public.warmth.interest.rejoin', inactive.id, 'success', { program });
        return { code: 200, payload: { ok: true, interest: { id: inactive.id, program, frequency, status: enrollmentStatus }, message: isBirthdayProgram ? '已重新加入生日祝福计划，可以直接写祝福了。' : '已重新提交参加意愿，等待人工确认。' } };
      }
      const interestId = eventIdentifier('WARM');
      await saveEnrollment(client, interestId, { 来源: portalEnrollmentSource, 项目: program, ...rowPatch });
      await recordAudit(req, session, 'public.warmth.interest', interestId, 'success', { program, frequency });
      return { code: 201, payload: { ok: true, interest: { id: interestId, program, frequency, status: enrollmentStatus }, message: isBirthdayProgram ? '已加入生日祝福计划，可以直接写祝福了；内容仍会先经人工审核。' : '已记录你的参加意愿。平台不会自动发送内容，所有内容都会先经人工审核。' } };
    });
    return json(res, outcome.code, outcome.payload);
  }

  const warmthInterestUpdate = url.pathname.match(/^\/api\/public\/warmth\/interests\/([^/]+)\/update$/);
  if (warmthInterestUpdate && req.method === 'POST') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    const actorRef = businessAccountRef(session);
    if (await isWarmthBlacklisted(client, actorRef)) return json(res, 403, { ok: false, message: '你已被移出生日祝福计划，无法修改登记。' });
    enforcePublicLimit(req, 'warmth-update', 30, actorRef);
    const interestId = decodeURIComponent(warmthInterestUpdate[1]);
    const body = await readJsonObject(req);
    const birthdayMonthDay = cleanText(body.birthdayMonthDay, '生日月日', 5);
    const campus = cleanText(body.campus, '校区', 10);
    if (!WARMTH_CAMPUS_OPTIONS.includes(campus)) return json(res, 400, { ok: false, message: '请选择鼓楼、仙林、苏州或浦口校区。' });
    const outcome = await withWarmthLock(client, `warmth-enrollment:${interestId}`, async () => {
      const rows = await readEnrollmentRows(client, { 登记ID: interestId });
      const row = rows.find((item) => String(item['登记ID'] || '') === interestId);
      if (!row) return { code: 404, payload: { ok: false, message: '参加登记不存在。' } };
      if (String(row['来源'] || '') !== portalEnrollmentSource || String(row['参与者标识'] || '') !== actorRef) {
        return { code: 403, payload: { ok: false, message: '只能修改自己的登记。' } };
      }
      if (String(row['项目'] || '') !== 'birthday') return { code: 400, payload: { ok: false, message: '该登记不是生日祝福计划。' } };
      if (!isActiveEnrollmentStatus(row['状态'])) return { code: 409, payload: { ok: false, message: '已退出的登记不能修改，请重新报名。' } };
      const birthdayCalendar = validateBirthdayCalendar(birthdayMonthDay, body.birthdayCalendar ?? String(row['生日历法'] || 'solar'));
      await updateEnrollment(client, interestId, { 校区: campus, 生日月日: birthdayMonthDay, ...await birthdayCalendarPatch(client, birthdayCalendar) });
      await recordAudit(req, session, 'public.warmth.interest.update', interestId, 'success', { campus });
      return { code: 200, payload: { ok: true, interest: { id: interestId, program: 'birthday', status: String(row['状态'] || ''), campus, birthdayMonthDay, birthdayCalendar }, message: '生日资料已更新。' } };
    });
    return json(res, outcome.code, outcome.payload);
  }

  const warmthInterestWithdraw = url.pathname.match(/^\/api\/public\/warmth\/interests\/([^/]+)\/withdraw$/);
  if (warmthInterestWithdraw && req.method === 'POST') {
    const session = requirePortalWrite(req, res);
    if (!session) return;
    const actorRef = businessAccountRef(session);
    enforcePublicLimit(req, 'warmth-withdraw', 10, actorRef);
    const interestId = decodeURIComponent(warmthInterestWithdraw[1]);
    const outcome = await withWarmthLock(client, `warmth-enrollment:${interestId}`, async () => {
      const rows = await readEnrollmentRows(client, { 登记ID: interestId });
      const row = rows.find((item) => String(item['登记ID'] || '') === interestId);
      if (!row) return { code: 404, payload: { ok: false, message: '参加登记不存在。' } };
      if (String(row['来源'] || '') !== portalEnrollmentSource || String(row['参与者标识'] || '') !== actorRef) {
        return { code: 403, payload: { ok: false, message: '只能退出自己的登记。' } };
      }
      if (String(row['状态'] || '') !== enrollmentStatusWithdrawn) {
        await updateEnrollment(client, interestId, { 状态: enrollmentStatusWithdrawn, 处理人: session.username, 处理时间: new Date().toISOString() });
        await recordAudit(req, session, 'public.warmth.interest.withdraw', interestId, 'success', {});
      }
      return { code: 200, payload: { ok: true, message: '已退出该计划，之后不会再进入匹配或发送队列。' } };
    });
    return json(res, outcome.code, outcome.payload);
  }

  return json(res, 404, { ok: false, message: 'Not found' });
}

/**
 * Signed-in student surface. Everything is scoped to the session account, so a
 * member can only ever read back their own records — there is no code path here
 * that accepts another person's identifier.
 */
async function portalRoutes(req, res, url) {
  if (!url.pathname.startsWith('/api/portal/')) return false;
  const session = requirePortalSession(req, res);
  if (!session) return;
  const client = await getBase();

  // ---- v3 第 3/12 项：笔名绑定（首次填写即绑定，绑定后不可改）----
  // v3 S5：会员技能（提交 + 查看本人）——委托给任务与技能模块。
  if (url.pathname === '/api/portal/skills' || url.pathname.startsWith('/api/portal/skills/')) {
    return await taskApi.portalSkillRoutes(req, res, url, taskCtx);
  }

  if (url.pathname === '/api/portal/pen-name' && (req.method === 'GET' || req.method === 'POST')) {
    const session = requirePortalSession(req, res);
    if (!session) return;
    const account = accountsByUsername.get(session.username);
    const current = String(account?.penName || '').trim();

    if (req.method === 'GET') {
      return json(res, 200, { ok: true, penName: current || null, bound: Boolean(current) });
    }

    requireCsrf(req, session);
    // 已绑定：一律拒绝（无改名审核流，D1）
    if (current) {
      return json(res, 409, { ok: false, code: 'pen_name_locked', penName: current, message: `笔名已绑定为「${current}」，绑定后不可更改。` });
    }
    const body = await readJson(req);
    const penName = normalizePenName(body.penName);
    if (!penName) {
      return json(res, 400, { ok: false, code: 'pen_name_invalid', message: `请填写 ${PEN_NAME_MIN}-${PEN_NAME_MAX} 个字符的笔名（可用中英文、数字）。` });
    }
    if (!account?.rowId) {
      return json(res, 409, { ok: false, message: '账号记录不完整，无法绑定笔名，请联系管理员。' });
    }
    // 并发保护：写入前重读一次，避免两个请求同时通过「尚未绑定」检查
    const identity = await getIdentityBase();
    const fresh = await loadAccountsFromTable(identity).catch(() => null);
    const freshPen = fresh?.get?.(session.username)?.penName;
    if (freshPen && String(freshPen).trim()) {
      return json(res, 409, { ok: false, code: 'pen_name_locked', penName: String(freshPen).trim(), message: `笔名已绑定为「${String(freshPen).trim()}」，绑定后不可更改。` });
    }
    await identity.updateRow(ACCOUNT_TABLE, account.rowId, { 笔名: penName });
    if (account) account.penName = penName;
    await recordAudit(req, session, 'portal.penName.bind', penName, 'success', {});
    return json(res, 201, { ok: true, penName, bound: true, message: `笔名「${penName}」绑定成功，绑定后不可更改。` });
  }

  // ---- v3 第 5/15 项：文创/推文类型字典已移至 publicRoutes（公开只读）----

  if (req.method === 'GET' && url.pathname === '/api/portal/me') {
    const warmthOnly = url.searchParams.get('view') === 'warmth';
    const [registrations, projects, sessions, submissions, enrollments] = await Promise.all([
      warmthOnly ? [] : safeRows(client, eventRegistrationTable),
      warmthOnly ? [] : safeRows(client, eventProjectTable),
      warmthOnly ? [] : safeRows(client, eventSessionTable),
      warmthOnly ? [] : readPublicSubmissions(client),
      readWarmthInterests(client, { 参与者标识: [session.username, businessAccountRef(session)] }),
    ]);

    const myRegistrations = registrations
      .filter((row) => ownsBusinessRef(session,row['参与者引用']))
      .map((row) => {
        const project = projects.find((item) => item['活动ID'] === row['活动ID']);
        const eventSession = sessions.find((item) => String(item['场次ID'] || '') === String(row['场次ID'] || ''));
        return {
          code: String(row['报名ID'] || ''),
          status: String(row['报名状态'] || ''),
          waitlist: toFiniteNumber(row['候补序号']),
          eventName: String(project?.['活动名称'] || '未命名活动'),
          eventStatus: String(project?.['状态'] || ''),
          startAt: eventSession?.['开始时间'] || project?.['活动开始'] || null,
          location: String(eventSession?.['地点'] || project?.['地点'] || ''),
          submittedAt: row['提交时间'] || null,
          checkedInAt: row['签到时间'] || null,
          cancelledAt: row['取消时间'] || null,
        };
      })
      .sort(byDateDesc('submittedAt'));

    const mySubmissions = submissions
      .filter((item) => ownsBusinessRef(session,item.submitterRef))
      .map((item) => ({ id: item.id, title: item.title, category: item.category, status: item.status, submittedAt: item.submittedAt, reviewNote: item.review?.note || '', attachmentCount: item.attachmentIds.length }));

    const myEnrollments = enrollments
      .filter((item) => ownsBusinessRef(session,item.participantRef))
      .map((item) => ({ id: item.id, program: item.program, frequency: item.frequency, status: item.status, submittedAt: item.submittedAt, campus: item.campus, birthdayMonthDay: item.birthdayMonthDay, birthdayCalendar: item.birthdayCalendar }));

    if (warmthOnly) return json(res, 200, { ok: true, enrollments: myEnrollments });
    return json(res, 200, {
      ok: true,
      account: sessionPayload(session).user,
      stats: { registrations: myRegistrations.length, submissions: mySubmissions.length, enrollments: myEnrollments.length },
      registrations: myRegistrations,
      submissions: mySubmissions,
      enrollments: myEnrollments,
    });
  }

  return json(res, 404, { ok: false, message: 'Not found' });
}

/**
 * Wiring for the two development workstreams (identity, event operations).
 * Each module owns its own URL prefix and returns false for anything it does
 * not handle, so every original route keeps working untouched.
 */
configureMailer({
  smtpHost,
  smtpPort,
  smtpSecure,
  smtpUser,
  smtpPassword,
  from: reminderFrom,
  isProduction,
  getClient: getIdentityBase,
  deliveryStore: mailDeliveryStore,
  deliverySecret: sessionSecret,
  retryStore: mailRetryStore,
});

let repairingMailRecords = false;

async function repairStoredMailRecords() {
  if (repairingMailRecords) return;
  repairingMailRecords = true;

  try {
    return await withRequestBudget(() =>
      withSharedWriteLock(async () => {
        const records = await repairMailRecords({ limit: 5 });
        await retryQueuedMail({ limit: 5 });
        return records;
      }),
    );
  } catch {
    console.error('Mail background processing failed; queued jobs retained.');
    return { ok: false };
  } finally {
    repairingMailRecords = false;
  }
}

const identityCtx = {
  // Background password resets use the same maintenance gate as foreground auth.
  withSharedWriteLock: withIdentityAccess,
  ...(profileAccess?{getProfileBase}:{}),
  json,
  readJson,
  getBase: getIdentityBase,
  requireCsrf,
  requireSession,
  getSession,
  makeSession,
  sessionCookie,
  sessionPayload,
  recordAudit,
  clientIp,
  identifier: eventIdentifier,
  sendMail,
  accounts: accountsByUsername,
  accountStore: { tableName: ACCOUNT_TABLE, generateMemberCode },
  config: {
    isProduction,
    privateIdentity: Boolean(identityApiToken),
    businessBaseUuid: process.env.SEATABLE_BUSINESS_BASE_UUID || '',
    volunteerBaseUuid,
    profileBaseUuid,
    registrationAvailable: mailerStatus().configured,
    codeSecret: sessionSecret,
    minimumPasswordLength,
    sessionTtlSeconds,
    // Strong binding: student self-registration only accepts campus mail.
    smailDomains: ['smail.nju.edu.cn', 'nju.edu.cn'],
    publicEmailDomains,
    publicWriteLimit,
    root,
  },
};

const eventsCtx = {
  json,
  readJson,
  getBase,
  requireConsoleAccess,
  requireCsrf,
  recordAudit,
  clientIp,
  identifier: eventIdentifier,
  getEventsOverview,
  njubox,
  tables: { project: eventProjectTable, session: eventSessionTable, registration: eventRegistrationTable },
  config: {
    root,
    njuboxServerUrl: process.env.NJUBOX_SERVER_URL?.trim() || 'https://box.nju.edu.cn',
    njuboxToken: process.env.NJUBOX_API_TOKEN?.trim() || '',
    njuboxRepoId: process.env.NJUBOX_REPO_ID?.trim() || '',
    njuboxUploadDir: process.env.NJUBOX_UPLOAD_DIR?.trim() || '/红十字会/活动策划案',
  },
};

const attachmentCtx = {
  json,
  readJson,
  getBase,
  requirePortalSession,
  requireCsrf,
  requireConsoleAccess,
  recordAudit,
  enforceLimit: enforcePublicLimit,
  ownsBusinessRef,
  businessAccountRef,
  tables: { attachment: SUBMISSION_ATTACHMENT_TABLE, submission: outreachSubmissionTable, project: eventProjectTable },
  config: {
    // v3 主路线：NJU Box（Seafile）「资料库级令牌」接入，Table 只存元数据（双备份架构）。
    //   njuboxToken      → 主库「平台文件存储」资料库令牌（Bearer）
    //   njuboxPicksToken → 精选库「南大红会图片素材库」资料库令牌（Bearer）
    // 令牌自带库身份，不再需要 NJUBOX_REPO_ID。
    njuboxServerUrl: process.env.NJUBOX_SERVER_URL?.trim() || 'https://box.nju.edu.cn',
    njuboxToken: process.env.NJUBOX_MAIN_TOKEN?.trim() || process.env.NJUBOX_API_TOKEN?.trim() || '',
    njuboxPicksToken: process.env.NJUBOX_PICKS_TOKEN?.trim() || '',
    njuboxSubmissionsDir: process.env.NJUBOX_SUBMISSIONS_DIR?.trim() || '/内容投稿',
    njuboxMediaDir: process.env.NJUBOX_MEDIA_DIR?.trim() || '/影像素材',
    njuboxShowcaseDir: process.env.NJUBOX_SHOWCASE_DIR?.trim() || '/宣传展示',
    // 以下 OSS 配置仅用于读侧兼容历史 aliyun-oss 行；v2 不再产生新的 OSS 附件。
    aliyunOssAccessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID?.trim() || '',
    aliyunOssAccessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET?.trim() || '',
    aliyunOssBucket: process.env.ALIYUN_OSS_BUCKET?.trim() || '',
    aliyunOssRegion: process.env.ALIYUN_OSS_REGION?.trim() || '',
    aliyunOssEndpoint: process.env.ALIYUN_OSS_ENDPOINT?.trim() || '',
    aliyunOssUploadPrefix: process.env.ALIYUN_OSS_UPLOAD_PREFIX?.trim() || 'submissions/',
    aliyunOssLinkTtlSeconds: process.env.ALIYUN_OSS_LINK_TTL_SECONDS?.trim() || '',
  },
};

/** 影像模块 ctx：照片元数据落「影像素材表」，活动名候选对「活动项目表」。 */
const mediaCtx = {
  json,
  readJson,
  getBase,
  requirePortalSession,
  requireCsrf,
  recordAudit,
  enforceLimit: enforcePublicLimit,
  ownsBusinessRef,
  businessAccountRef,
  // 摄影师名与实名强绑定：只从身份库取 realName，前端传值一律忽略。
  resolveRealName: (session) => accountsByUsername.get(session?.username)?.realName || '',
  tables: { media: MEDIA_TABLE, project: eventProjectTable },
  config: attachmentCtx.config,
};

/** 任务与技能 ctx（v3 S5）：三端共用同一套表，鉴权在路由层按域裁决。 */
const taskCtx = {
  json,
  readJson,
  getBase,
  recordAudit,
  enforceLimit: enforcePublicLimit,
  requirePortalSession,
  requireCsrf,
  ownsBusinessRef,
  businessAccountRef,
  /** 当前会话账号的技能星级（账号表「技能星级」列）。 */
  accountStars: (session) => Number(accountsByUsername.get(session?.username)?.skillLevel || 0) || 0,
  displayName: (session) => accountsByUsername.get(session?.username)?.displayName
    || accountsByUsername.get(session?.username)?.realName
    || session?.username || '',
  /**
   * 技能审核通过 → 把星级写回**技能提交人**的账号表「技能星级」列。
   * 注意：写回对象由 accountRef 解析，而不是审核人（session）本人——
   * 管理员代为审核他人技能时，session 是管理员，accountRef 才是提交人。
   * 账号来源可能是 SeaTable 身份表（有 rowId）或本地 JSON（无 rowId，仅内存），
   * 两种来源都先更新内存缓存，有 rowId 时再落库。
   */
  applyAccountStars: async (accountRef, stars) => {
    const target = [...accountsByUsername.values()]
      .find((item) => item.accountId === accountRef || item.username === accountRef);
    if (!target) return;
    target.skillLevel = String(stars);
    if (!target.rowId) return;
    await (await getIdentityBase()).updateRow(ACCOUNT_TABLE, target.rowId, { 技能星级: String(stars) });
  },
  /** 申领邮件提醒（SMTP 未配置时返回 false，不阻断）。v3.1：申领阶段先发「已提交申请」。 */
  notifyClaim: async ({ task, session, pending }) => {
    const to = accountsByUsername.get(session?.username)?.email;
    if (!to || typeof sendMail !== 'function') return false;
    await sendMail({
      to,
      subject: pending ? `[南大红会] 已提交任务申领：${task.title}` : `[南大红会] 任务认领成功：${task.title}`,
      text: pending
        ? `你已提交任务「${task.title}」（${task.stars} 星）的申领，等待管理员审核。\n\n任务说明：${task.description || '（无）'}\n\n审核结果会再通知你。`
        : `你已认领任务「${task.title}」（${task.stars} 星）。\n\n任务说明：${task.description || '（无）'}\n\n请按说明完成并在完成后联系发布人。`,
    });
    return true;
  },
  tables: { task: TASK_TABLE, claim: TASK_CLAIM_TABLE, skill: SKILL_TABLE, account: ACCOUNT_TABLE },
  config: attachmentCtx.config,
};

/** 展示板块 ctx：公开读取（无登录），封面 302 到 NJU Box 新鲜直链。
 *  v3 第 14 项：展示墙拆「公众号推文 / 文创展示」双板，文创板读已通过的设计投稿。
 *  v3 S7（N2）：同一 ctx 复用给控制台维护接口（extract / 列表管理）。 */
const showcaseCtx = {
  json,
  readJson,
  getBase,
  recordAudit,
  enforceLimit: enforcePublicLimit,
  tables: { showcase: SHOWCASE_TABLE, submission: outreachSubmissionTable, attachment: SUBMISSION_ATTACHMENT_TABLE },
  config: attachmentCtx.config,
  boxConfig: attachmentCtx.config,
};

const warmthCapabilities = createWarmthCapabilities({ getBase, birthday: birthdayRollout, morningEnabled: process.env.WARMTH_MORNING_ENABLED === 'true' });
async function morningCapability() {
  return (await warmthCapabilities()).morning;
}
async function morningAccount(ref) {
  const base=await getIdentityBase();
  const rows=await readCommunityRows(base, '平台账号表', { 账号ID: String(ref) }, loadAllRows);assertCompleteRows(rows);
  const row=rows.find(row=>String(row['账号ID']||'')===String(ref));
  return row?accountFromRow(row):null;
}
async function recordMorningAudit(...args) {
  // Sensitive moderation cannot report success without an audit record.
  return recordAudit(...args, { strict: true });
}

async function api(req, res, url) {
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const eventWrite = write && (
    /^\/api\/events(?:\/|$)/.test(url.pathname)
    || /^\/api\/public\/events\/[^/]+\/registrations$/.test(url.pathname)
  );

  const dispatch = () => eventWrite
    ? withEventMutation(() => dispatchApi(req, res, url))
    : dispatchApi(req, res, url);

  // Identity owns per-mailbox/per-student mutation locks. Never wait behind
  // business writes or hold the business lock during SMTP/password work.
  if (url.pathname.startsWith('/api/auth/')) return withIdentityAccess(dispatch);
  return write ? withSharedWriteLock(dispatch) : dispatch();
}

/**
 * `/api/*` 派发。顺序即优先级，改动前请先确认不会影响后面的兜底分支。
 *
 *   1. 来源校验 —— 只对带 Origin 的 `POST /api/auth/*` 生效（登录/注册是唯一
 *      接受跨站点表单提交的场景，其余接口都走同源 fetch）。
 *   2. 会话回填 —— 账号托管在 SeaTable 时，每次请求重新读取一次账号行，
 *      使停号、改角色、改权限在下次请求立即生效，而不必等会话过期。
 *   3. 前缀委派 —— workflow / morning / portal / public / auth / events-ops。
 *      每个委派模块对不认识的路径返回 `false`，控制权回到本函数继续匹配；
 *      新增域模块请遵守同一约定。
 *   4. 控制台兜底 —— `scopeForConsolePath()` 由路径反推所需权限范围，随后
 *      统一执行会话、权限与写请求 CSRF 校验。放在最后，是为了让自带守卫的
 *      委派模块（如 workflow 的学生端）先拿到按本人归属判定的机会。
 */
async function dispatchApi(req, res, url) {
  try {
    if (url.pathname.startsWith('/api/auth/') && req.method === 'POST' && req.headers.origin) {
      let trusted = false;
      try { const origin = new URL(req.headers.origin); trusted = origin.host === req.headers.host && ['https:', 'http:'].includes(origin.protocol); } catch {}
      if (!trusted) return json(res, 403, { ok: false, code: 'origin_forbidden', message: '请求来源不受信任。' });
    }
    if (accountLoad.source.startsWith('seatable:') && url.pathname !== '/api/auth/logout' && getSession(req)) {
      const session = getSession(req);
      // 展示读复用最近一次账号行；写请求与登录流程始终直读权威源。
      const fresh = await loadSessionAccount(session.username, {
        allowCache: req.method === 'GET' || req.method === 'HEAD',
      });
      if (fresh) accountsByUsername.set(session.username, fresh);
      else accountsByUsername.delete(session.username);
    }

    if(await mailSettingsRoutes(req,res,url,{store:mailSettingsStore,json,readJson,requireConsoleAccess,requireCsrf,getAccounts:eventDirectory,audit:(action,metadata)=>recordAudit(req,getSession(req),action,'mail-settings','success',metadata)}))return;
    if (await reimbursementApi(req, res, url) !== false) return;

    if(['/api/volunteer/workflow','/api/portal/workflow','/api/public/workflow/events'].some(prefix=>url.pathname===prefix||url.pathname.startsWith(`${prefix}/`))) {
      return await workflowRoutes(req,res,url,{getWorkspaceRoleStore,getWorkspaceDrafts,getWorkspaceSubmissions,getWorkspaceRoster,getWorkspaceProfileData,getWorkspaceBridge,approvalRouting,getWorkflow,getPublicWorkflowData,getWishlist,getManagedSources:async()=>getEventsOverview(await getBase(),{notificationsOnly:true}).then(data=>data.events),requireConsoleAccess,requirePortalSession,requireCsrf,readJson,json,
        ...(organizationEvents?{getEventAuthority:eventAuthority,getAuthorityBase:getVolunteerBase,queueApprovalReminders}:{}),...(process.env.PLATFORM_REGISTRATION_NOTIFICATIONS==='true'?{queueRegistrationNotifications}:{}),notifyRegistrationDecisions,getDirectory:eventDirectory,
        ...(profileAccess?{getParticipantDirectory:async(accounts,registrations)=>participantDirectory(accounts,registrations,await getProfileBase())}:{}),getResultMailStatus:getMailDeliveryStatuses,sendHoursMail:sendMail,queueFinalHoursMail,sendResultMail:async message=>process.env.PLATFORM_REGISTRATION_NOTIFICATIONS==='true'?(await getRegistrationNotifications()).dispatch(message):mailerStatus().configured?sendMail(message):{ok:false},
        actor:businessAccountRef,getAccount:session=>getIdentityBase().then(base=>findAccountByLogin(base,session.username)),getVolunteerPlatformHours,
        audit:(request,account,action,id,details={})=>recordAudit(request,account,action,id,'success',details)});
    }
    if(organizationEvents&&req.method==='GET'&&url.pathname==='/api/health'&&url.searchParams.get('summary')==='true'){
      const session=requirePortalSession(req,res);if(!session)return;
      const account=accountsByUsername.get(session.username);
      if(!consoleRoles.has(session.role)&&!(await eventAuthority(session)).canEnter)return json(res,403,{ok:false,message:'当前账号没有管理平台权限'});
      if(!isAccountActive(account))return json(res,403,{ok:false,message:'账号未启用'});
      return json(res,200,{ok:true});
    }
    // Legacy event endpoints have no object-level scoping. Do not let a saved
    // module permission bypass the organization policy enforced by workflow.
    if(organizationEvents&&scopeForConsolePath(url.pathname)==='events'){
      const session=requirePortalSession(req,res);if(!session)return;
      (await eventAuthority(session)).assertGlobal();
    }
    if (url.pathname.startsWith('/api/morning/') || url.pathname.startsWith('/api/community/morning/')) {
      const access=url.pathname.startsWith('/api/community/')?requireConsoleAccess(req,res,'community'):requirePortalSession(req,res);
      if(!access)return;
      const capability=await morningCapability();
      if(!capability.ready)return json(res,503,{ok:false,code:'morning_unavailable',message:'早安晚安暂未开放，请稍后再试。'});
      const ctx={getBase,listRows:listAllRows,assertCompleteRows,readJsonObject,requirePortalSession,requirePortalWrite,requireConsoleAccess,requireCsrf,enforcePublicLimit,
        morningPlazaSnapshotStore,
        accountForSession:async session=>findAccountByLogin(await getIdentityBase(),session.username), actor:businessAccountRef,
        accountForRef:morningAccount,sendMail,recordAudit:recordMorningAudit,json,
        resolveMorningGrades:async people=>{
          const source=profileAccess?await getProfileBase():volunteerAccess?await getVolunteerBase():null;
          return source?readMorningGrades(source,people):null;
        },
        inviteSecret:process.env.MORNING_INVITE_SECRET?.trim()||sessionSecret,
        publicBaseUrl,
        resolveInviteCoordinators:campus=>getBase().then(client=>readMorningInviteCoordinators(client,campus))};
      for(const handler of [morningRoutes,morningTagRoutes,morningInvitationRoutes,morningPlazaRoutes,morningRevisionRoutes,morningAdminRoutes]){
        const result=await handler(req,res,url,ctx);if(result!==false)return result;
      }
      return json(res,404,{ok:false,message:'早安晚安接口不存在。'});
    }
    if (url.pathname.startsWith('/api/portal/')) {
      return await portalRoutes(req, res, url);
    }
// Content-submission attachments: the module owns the bare prefix and
// everything under it, so it must be checked before the /api/public/ catch-all.
const isAttachmentApi = url.pathname === '/api/public/attachments'
  || url.pathname.startsWith('/api/public/attachments/');
if (isAttachmentApi) {
  return await attachmentApi.attachmentRoutes(req, res, url, attachmentCtx);
}
// Media library (v2): /api/public/media* — portal login + CSRF + rate limits.
const isMediaApi = url.pathname === '/api/public/media'
  || url.pathname.startsWith('/api/public/media/');
if (isMediaApi) {
  return await mediaApi.mediaRoutes(req, res, url, mediaCtx);
}
// Tasks (v3 S5): /api/public/tasks* — 心愿清单（登录读）+ 申领（登录 + CSRF + 限流）。
const isPublicTaskApi = url.pathname === '/api/public/tasks'
  || url.pathname.startsWith('/api/public/tasks/');
if (isPublicTaskApi) {
  return await taskApi.publicTaskRoutes(req, res, url, taskCtx);
}
// Showcase (v2): /api/public/showcase* — public read, covers 302 to Box.
const isShowcaseApi = url.pathname === '/api/public/showcase'
  || url.pathname.startsWith('/api/public/showcase/');
if (isShowcaseApi) {
  return await showcaseApi.showcaseRoutes(req, res, url, showcaseCtx);
}
// Console media (v3 S4): /api/console/media* — 精选确认队列 / 删除审核队列。
// 需要控制台权限 + 写操作 CSRF；本域自行完成鉴权后再交给模块。
const isConsoleMediaApi = url.pathname === '/api/console/media'
  || url.pathname.startsWith('/api/console/media/');
if (isConsoleMediaApi) {
  const mediaSession = requireConsoleAccess(req, res, 'outreach');
  if (!mediaSession) return;
  const isMediaWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (isMediaWrite && !requireCsrf(req, res, mediaSession)) return;
  return await mediaApi.consoleMediaRoutes(req, res, url, { ...mediaCtx, session: mediaSession });
}
// Console tasks/skills (v3 S5): 任务发布 + 技能审核队列（控制台权限 + 写操作 CSRF）。
const isConsoleTaskApi = url.pathname === '/api/console/tasks'
  || url.pathname.startsWith('/api/console/tasks/')
  || url.pathname === '/api/console/skills'
  || url.pathname.startsWith('/api/console/skills/');
if (isConsoleTaskApi) {
  const taskSession = requireConsoleAccess(req, res, 'outreach');
  if (!taskSession) return;
  const isTaskWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (isTaskWrite && !requireCsrf(req, res, taskSession)) return;
  return await taskApi.consoleTaskRoutes(req, res, url, { ...taskCtx, session: taskSession });
}
// Console showcase (v3 S7): 宣传展示半自动导入 + 列表管理（控制台权限 + 写操作 CSRF）。
const isConsoleShowcaseApi = url.pathname === '/api/console/showcase'
  || url.pathname.startsWith('/api/console/showcase/');
if (isConsoleShowcaseApi) {
  const showcaseSession = requireConsoleAccess(req, res, 'outreach');
  if (!showcaseSession) return;
  const isShowcaseWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (isShowcaseWrite && !requireCsrf(req, res, showcaseSession)) return;
  return await showcaseApi.consoleShowcaseRoutes(req, res, url, { ...showcaseCtx, session: showcaseSession });
}
if (url.pathname.startsWith('/api/public/')) {
  return await publicRoutes(req, res, url);
}
    if (url.pathname.startsWith('/api/auth/')) {
      const identity = await identityRoutes(req, res, url, identityCtx);
      if (identity !== false) return identity;
      const handled = await authApi(req, res, url);
      if (handled !== false) return handled;
    }
    // The event-operations module owns both the bare prefixes and everything
    // under them (the smoke suite posts to /api/event-notices without a slash).
    const isEventsOps = ['/api/event-notices', '/api/event-attachments'].some(
      (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    );
    if (isEventsOps) {
      return await eventsOpsRoutes(req, res, url, eventsCtx);
    }
    if (url.pathname.startsWith('/api/console/agent/')) {
      return await agentRoutes(req, res, url, {
        service: agentTaskService,
        requireConsoleAccess,
        requireCsrf,
        readJson,
        json,
        getPermissions: (session) => normalizePermissions(
          accountsByUsername.get(session.username)?.permissions,
          session.role,
        ),
      });
    }

    const requiredScope = scopeForConsolePath(url.pathname);
    const session = requireConsoleAccess(req, res, requiredScope);
    if (!session) return;
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (isWrite && !requireCsrf(req, res, session)) return;

    if (req.method === 'GET' && url.pathname === '/api/audit/status') {
      return json(res, 200, {
        ok: true,
        audit: auditWriteHealth.snapshot(),
        auditReceipts: {
          enabled: Boolean(auditReconciliationStore),
          persistent: Boolean(auditReconciliationStore),
          states: auditReconciliationStore
            ? auditReconciliationStore.summary()
            : null,
        },
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/audit/receipts') {
      if (!auditReconciliationStore) {
        return json(res, 503, {
          ok: false,
          code: 'audit_reconciliation_disabled',
          message: '审计持久化核对尚未启用。',
        });
      }

      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit === null ? 20 : Number(rawLimit);
      const after = url.searchParams.get('after') ?? '';

      if (
        (rawLimit !== null && !/^[1-9]\d{0,2}$/.test(rawLimit))
        || !Number.isInteger(limit)
        || limit < 1
        || limit > 100
        || after.length > 200
      ) {
        return json(res, 400, {
          ok: false,
          code: 'invalid_pagination',
          message: '分页参数不正确。',
        });
      }

      return json(res, 200, {
        ok: true,
        ...auditReconciliationStore.listAttention({ limit, after }),
      });
    }

    const auditReconcileRoute = url.pathname.match(
      /^\/api\/audit\/receipts\/([^/]+)\/reconcile$/,
    );

    if (req.method === 'POST' && auditReconcileRoute) {
      if (!auditReconciliationStore) {
        return json(res, 503, {
          ok: false,
          code: 'audit_reconciliation_disabled',
          message: '审计持久化核对尚未启用。',
        });
      }

      let auditId;
      try {
        auditId = decodeURIComponent(auditReconcileRoute[1]);
      } catch {
        return json(res, 400, {
          ok: false,
          code: 'invalid_audit_id',
          message: '审计编号格式不正确。',
        });
      }

      if (
        !auditId
        || auditId.length > 200
        || /[\u0000-\u001f\u007f]/.test(auditId)
      ) {
        return json(res, 400, {
          ok: false,
          code: 'invalid_audit_id',
          message: '审计编号格式不正确。',
        });
      }

      if (!auditReconciliationStore.get(auditId)) {
        return json(res, 404, {
          ok: false,
          code: 'audit_receipt_not_found',
          message: '未找到本地审计凭据。',
        });
      }

      const reconciliation = await reconcileAuditRecord({
        store: auditReconciliationStore,
        getBase,
        baseUuid: auditBaseUuid,
        auditId,
      });

      return json(res, 200, {
        ok: true,
        auditId,
        ...reconciliation,
      });
    }
    if (url.pathname === '/api/console/search') {
      if (req.method !== 'GET') {
        return json(res, 405, {
          ok: false,
          message: '搜索接口仅支持读取。',
        });
      }
      const permissions = normalizePermissions(
        accountsByUsername.get(session.username)?.permissions,
        session.role,
      );
      return json(
        res,
        200,
        await getConsoleSearch(url.searchParams.get('q'), permissions),
      );
    }

    const client = await getBase();
    if(url.pathname==='/api/community/messages'||url.pathname.startsWith('/api/community/messages/'))return await messageRoutes(req,res,url,{base:client,session,json,readJson,audit:recordAudit});

    if (req.method === 'GET' && url.pathname === '/api/materials/overview') {
      return json(res, 200, await getMaterialsOverview(client));
    }

        const recoveryAction = url.pathname.match(
      /^\/api\/materials\/operations\/([^/]+)\/recover$/,
    );
    if (recoveryAction && req.method === 'POST') {
      const operationKey = decodeURIComponent(recoveryAction[1]);
      const stored = materialReceiptStore.get(operationKey);
      if (!stored) {
        return json(res, 404, {
          ok: false,
          message: '未找到操作恢复凭证。',
        });
      }

      // Only the original operator may resume this operation.
      if (stored.identity.payload.actor !== session.username) {
        return json(res, 403, {
          ok: false,
          message: '请由原操作账号恢复此操作。',
        });
      }

      const { applicationId, assetCode } = stored.identity.payload;
      return await withMaterialLock(assetCode, async () => {
        const receipt = materialReceiptStore.get(operationKey);
        const result = await executeMaterialRecovery({
          receipt,
          incoming: receipt.identity,
          saveReceipt: value => materialReceiptStore.save(value),
          readState: async () => {
            const [rows, flows] = await Promise.all([
              listAllRows(client, materialsTable),
              listAllRows(client, '物资流水表'),
            ]);
            assertCompleteRows(rows, flows);
            return {
              application: rows.find(row => row._id === applicationId),
              flows,
            };
          },
          appendFlow: row => client.appendRow('物资流水表', row),
          updateApplication: (id, patch) =>
            client.updateRow(materialsTable, id, patch),
        });

        await recordAudit(
          req,
          session,
          'materials.operation.recover',
          applicationId,
          'success',
          { assetCode, operationKey },
        );

        return json(res, 200, {
          ok: true,
          result: { _id: result.flowId },
          message: '原操作已核对并完成。',
        });
      });
    }

    const qrMatch = url.pathname.match(/^\/api\/materials\/inventory\/([^/]+)\/qr$/);
    if (qrMatch && req.method === 'GET') {
      const [inventory, configs] = await Promise.all([listAllRows(client, inventoryTable), listAllRows(client, '物资配置表')]);
      const row = inventory.find((item) => item._id === decodeURIComponent(qrMatch[1]));
      if (!row) return json(res, 404, { ok: false, message: 'Inventory item not found' });
      const svg = await QRCode.toString(materialCode(row), { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#520d2e', light: '#fffdfb' } });
      res.writeHead(200, { ...securityHeaders(), 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(svg);
    }
    if (req.method === 'GET' && url.pathname === '/api/materials/scan') {
      const code = String(url.searchParams.get('code') || '').trim();
      if (!/^NJU-RC-[A-Za-z0-9_-]+$/.test(code)) return json(res, 400, { ok: false, message: 'Unsupported inventory QR code' });
      const [inventory, configs] = await Promise.all([listAllRows(client, inventoryTable), listAllRows(client, '物资配置表')]);
      const row = inventory.find((item) => materialCode(item) === code);
      if (!row) return json(res, 404, { ok: false, message: 'Inventory QR code is not registered in this Base' });
      const config = configs.find((item) => item['资产编码'] === code) || {};
      return json(res, 200, { ok: true, item: inventorySummary(row, config) });
    }
    if (req.method === 'POST' && url.pathname === '/api/materials/applications') {
      const body = await readJson(req);
      const row = materialRequestPayload(body);
      const result = await client.appendRow(materialsTable, row);
      await recordAudit(req, session, 'materials.application.create', result?._id || 'new', 'success', { quantity: row['借用件数'], purpose: row['借用用途'] });
      return json(res, 201, { ok: true, result, message: 'Application submitted for approval' });
    }
    const applicationAction = url.pathname.match(/^\/api\/materials\/applications\/([^/]+)\/(approve|reject)$/);
    if (applicationAction && req.method === 'POST') {
      const applicationId = decodeURIComponent(applicationAction[1]);
      const rows = await listAllRows(client, materialsTable);
      const application = rows.find((row) => row._id === applicationId);
      if (!application) return json(res, 404, { ok: false, message: 'Application not found' });
      if (!String(application['状态'] || '').includes('待审批')) return json(res, 409, { ok: false, message: 'Only pending applications can be reviewed' });
      const body = await readJson(req);
      const approved = applicationAction[2] === 'approve';
      if (!approved && !String(body.reason || '').trim()) return json(res, 400, { ok: false, message: 'Rejection reason is required' });
      const patch = approved ? { '借出审批': '审批通过', '状态': '开始' } : { '借出审批': '审批不通过', '状态': '审批不通过', '不通过理由': String(body.reason).trim() };
      const result = await client.updateRow(materialsTable, applicationId, patch);
      await recordAudit(req, session, approved ? 'materials.application.approve' : 'materials.application.reject', applicationId, 'success', { reason: approved ? '' : String(body.reason).trim() });
      return json(res, 200, { ok: true, result, message: approved ? 'Application approved' : 'Application rejected' });
    }
    const transactionAction = url.pathname.match(/^\/api\/materials\/applications\/([^/]+)\/(checkout|return)$/);
        if (transactionAction && req.method === 'POST') {
      const applicationId = decodeURIComponent(transactionAction[1]);
      const { body, photo } = await readMaterialAction(req);
      const assetCode = String(body.assetCode || '').trim();
      const operation = transactionAction[2] === 'checkout' ? '出库' : '归还';

      const incoming = materialOperationIdentity({
        idempotencyKey: String(body.idempotencyKey || '').trim(),
        applicationId,
        assetCode,
        operation,
        quantity: Number(body.quantity),
        lossQuantity: Number(body.lossQuantity || 0),
        actor: session.username,
        destination: String(body.destination || '').trim(),
        note: String(body.note || '').trim(),
        photoHash: photo
          ? createHash('sha256')
            .update(Buffer.from(await photo.arrayBuffer()))
            .digest('hex')
          : '',
      });

      return await withMaterialLock(assetCode, async () => {
        let receipt = materialReceiptStore.get(incoming.key);

        if (!receipt) {
          if (materialReceiptStore.pendingForAsset(assetCode).length) {
            throw httpError(
              409,
              '该物资有未完成操作，请先恢复原操作再开始新操作。',
            );
          }
          const pending = materialReceiptStore.pendingForApplication(
            applicationId,
          );
          if (pending.length) {
            throw httpError(409, '该申请有未完成操作，请先恢复原操作。');
          }

          const [rows, bundle] = await Promise.all([
            listAllRows(client, materialsTable),
            materialBundle(client),
          ]);
          assertCompleteRows(rows);

          if (bundle.flows.some(flow => flow['幂等键'] === incoming.key)) {
            throw httpError(
              409,
              '已有同键流水但缺少恢复凭证，请人工核对，不能自动重复操作。',
            );
          }

          const application = rows.find(row => row._id === applicationId);
          if (!application) {
            throw httpError(404, 'Application not found');
          }
          const item = bundle.summaryByCode.get(assetCode);
          if (!item) {
            throw httpError(404, 'Inventory asset code not found');
          }
          if (operation === '出库') assertMaterialRequestAsset(application, item, incoming.payload.quantity);

          if (
            operation === '出库'
            && String(application['借出审批'] || '') !== '审批通过'
          ) {
            throw httpError(409, 'Application must be approved before checkout');
          }
          if (
            operation === '出库'
            && String(application['状态'] || '').includes('借出')
          ) {
            throw httpError(409, 'Application has already been checked out');
          }
          if (
            operation === '归还'
            && !String(application['状态'] || '').includes('借出')
          ) {
            throw httpError(409, 'Only checked-out applications can be returned');
          }
          if (operation === '出库' && !photo) {
            throw httpError(400, 'Checkout photo is required');
          }

          const destination = incoming.payload.destination
            || `${maskedApplicant(application['姓名'])} · `
              + String(application['借用用途'] || '未填写');
          const transaction = transactionPayload({
            operation: incoming.payload.operation,
            applicationId: incoming.payload.applicationId,
            quantity: incoming.payload.quantity,
            lossQuantity: incoming.payload.lossQuantity,
            note: incoming.payload.note,
            destination,
            idempotencyKey: incoming.key,
          }, session, item);

          const photoPath = await uploadSeaTableImage(photo);
          const plan = materialApplicationPlan({
            application,
            operation,
            quantity: incoming.payload.quantity,
            lossQuantity: incoming.payload.lossQuantity,
            note: incoming.payload.note,
            photoPath,
            date: today(),
          });

          assertRequestActive();
          receipt = materialReceiptStore.create({
            identity: incoming,
            flow: transaction.row,
            ...plan,
            state: 'prepared',
          });
        }

        const result = await executeMaterialRecovery({
          receipt,
          incoming,
          saveReceipt: value => materialReceiptStore.save(value),
          readState: async () => {
            const [rows, flows] = await Promise.all([
              listAllRows(client, materialsTable),
              listAllRows(client, '物资流水表'),
            ]);
            assertCompleteRows(rows, flows);
            return {
              application: rows.find(row => row._id === applicationId),
              flows,
            };
          },
          appendFlow: row => client.appendRow('物资流水表', row),
          updateApplication: (id, patch) =>
            client.updateRow(materialsTable, id, patch),
        });

        await recordAudit(
          req,
          session,
          operation === '出库' ? 'materials.checkout' : 'materials.return',
          applicationId,
          'success',
          { assetCode, operationKey: incoming.key },
        );

        return json(res, 200, {
          ok: true,
          result: { _id: result.flowId },
          recovered: receipt.state !== 'prepared',
          message: operation === '出库'
            ? 'Checkout confirmed'
            : 'Return confirmed',
        });
      });
    }
        if (req.method === 'POST' && url.pathname === '/api/materials/transactions') {
      const body = await readJson(req);
      const assetCode = String(body.assetCode || '').trim();
      return await withMaterialLock(assetCode, async () => {
        if (materialReceiptStore.pendingForAsset(assetCode).length) {
          throw httpError(
            409,
            '该物资有未完成操作，请先恢复原操作再修改库存。',
          );
        }
        const bundle = await materialBundle(client);
        const item = bundle.summaryByCode.get(assetCode);
        if (!item) return json(res, 404, { ok: false, message: 'Inventory asset code not found' });
        const idempotencyKey = String(body.idempotencyKey || '').trim();
        if (idempotencyKey && bundle.flows.some((flow) => flow['幂等键'] === idempotencyKey)) return json(res, 200, { ok: true, duplicate: true, message: 'Operation already recorded' });
        const transaction = transactionPayload(body, session, item);
        const result = await client.appendRow('物资流水表', transaction.row);
        await recordAudit(req, session, `materials.${transaction.row['操作类型']}`, result?._id || 'new', 'success', { assetCode, quantity: transaction.row['数量'] });
        return json(res, 201, { ok: true, result, message: 'Inventory transaction recorded' });
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/events/schema-preview') {
      return json(res, 200, { ok: true, mode: 'dry-run', writes: false, tables: await schemaPreview(client, activitySchema) });
    }
    if (req.method === 'GET' && url.pathname === '/api/outreach/schema-preview') {
      return json(res, 200, { ok: true, mode: 'dry-run', writes: false, tables: await schemaPreview(client, outreachSchema) });
    }
    if (req.method === 'GET' && url.pathname === '/api/state/schema-preview') {
      return json(res, 200, { ok: true, mode: 'dry-run', writes: false, storage: 'seatable', tables: await schemaPreview(client, stateSchema) });
    }
    if (req.method === 'GET' && url.pathname === '/api/events/overview') {
      return json(res, 200, await getEventsOverview(client));
    }
    if (req.method === 'POST' && url.pathname === '/api/events') {
      const body = await readJson(req);
      const row = eventPayload(body, session);
      const result = await client.appendRow(eventProjectTable, row);
      await recordAudit(req, session, 'event.create', row['活动ID'], 'success', { title: row['活动名称'], status: row['状态'] });
      return json(res, 201, { ok: true, result, event: { ...row, id: result?._id || null }, message: '活动已创建，当前为草稿状态' });
    }
    const eventSession = url.pathname.match(/^\/api\/events\/([^/]+)\/sessions$/);
    if (eventSession && req.method === 'POST') {
      const eventKey = decodeURIComponent(eventSession[1]);
      const body = await readJson(req);
      const [projects, sessions] = await Promise.all([
        listAllRows(client, eventProjectTable),
        listAllRows(client, eventSessionTable),
      ]);
      assertCompleteRows(projects, sessions);
      const project = projects.find((row) => row._id === eventKey || row['活动ID'] === eventKey);
      if (!project) return json(res, 404, { ok: false, message: '活动不存在' });
      const startAt = requiredText(body.startAt, '场次开始时间', 80);
      const endAt = String(body.endAt || '').trim();
      const location = String(body.location || project['地点'] || '').trim();
      const capacity = Math.max(1, Math.floor(Number(body.capacity || project['容量'] || 0)));
      if (!Number.isInteger(capacity) || capacity <= 0) return json(res, 400, { ok: false, message: '场次容量必须是正整数' });
      const duplicate = sessions.some((row) => row['活动ID'] === project['活动ID'] && row['开始时间'] === startAt);
      if (duplicate) return json(res, 409, { ok: false, message: '相同开始时间的场次已存在' });
      const row = { 场次ID: eventIdentifier('SES'), 活动ID: project['活动ID'], 开始时间: startAt, 结束时间: endAt, 地点: location, 容量: String(capacity), 签到开放: String(body.checkinOpen || startAt).trim(), 签到方式: '二维码+人工核验', 状态: '待发布' };
      const result = await client.appendRow(eventSessionTable, row);
      await recordAudit(req, session, 'event.session.create', row['场次ID'], 'success', { eventId: project['活动ID'], startAt });
      return json(res, 201, { ok: true, result, session: { ...row, id: result?._id || null }, message: '活动场次已创建' });
    }
    const eventAction = url.pathname.match(/^\/api\/events\/([^/]+)\/(publish|close)$/);
    if (eventAction && req.method === 'POST') {
      const eventRowId = decodeURIComponent(eventAction[1]);
      const projects = await listAllRows(client, eventProjectTable);
      assertCompleteRows(projects);
      const project = projects.find((row) => row._id === eventRowId || row['活动ID'] === eventRowId);
      if (!project) return json(res, 404, { ok: false, message: '活动不存在' });
      const status = eventAction[2] === 'publish' ? '报名中' : '已结束';
      const result = await client.updateRow(eventProjectTable, project._id, { 状态: status });
      await recordAudit(req, session, `event.${eventAction[2]}`, project['活动ID'], 'success', { from: project['状态'] || '草稿', to: status });
      return json(res, 200, { ok: true, result, status, message: eventAction[2] === 'publish' ? '活动已发布' : '活动已关闭' });
    }
    const eventRegistration = url.pathname.match(/^\/api\/events\/([^/]+)\/registrations$/);
    if (eventRegistration && req.method === 'POST') {
      const body = await readJson(req);
      const outcome = await registerForEvent(client, { eventKey: decodeURIComponent(eventRegistration[1]), body, participantRef: session.username });
      await recordAudit(req, session, 'event.registration.create', outcome.row['报名ID'], 'success', { eventId: outcome.project['活动ID'], status: outcome.status, channel: 'console' });
      return json(res, 201, {
        ok: true,
        result: outcome.result,
        registration: { id: outcome.result?._id || null, code: outcome.row['报名ID'], status: outcome.status, waitlist: outcome.waitlist, checkinToken: outcome.token, qrDataUrl: outcome.qrDataUrl },
        message: outcome.status === '已确认' ? '报名成功' : `活动已满，当前为候补第 ${outcome.waitlist} 位`,
      });
    }
    const registrationAction = url.pathname.match(/^\/api\/events\/registrations\/([^/]+)\/(cancel|check-in)$/);
    if (registrationAction && req.method === 'POST') {
      const registrationId = decodeURIComponent(registrationAction[1]);
      const rows = await listAllRows(client, eventRegistrationTable);
      assertCompleteRows(rows);
      const registration = rows.find((row) => row._id === registrationId || row['报名ID'] === registrationId);
      if (!registration) return json(res, 404, { ok: false, message: '报名记录不存在' });
      if (registrationAction[2] === 'cancel') {
        const result = await client.updateRow(eventRegistrationTable, registration._id, { 报名状态: '已取消', 取消时间: new Date().toISOString() });
        await recordAudit(req, session, 'event.registration.cancel', registration['报名ID'], 'success', { eventId: registration['活动ID'] });
        return json(res, 200, { ok: true, result, message: '报名已取消' });
      }
      if (!['已确认', '已签到'].includes(registration['报名状态'])) return json(res, 409, { ok: false, message: '仅已确认的报名可以签到，候补或取消记录不能签到' });
      if (String(registration['报名状态'] || '') === '已签到' || String(registration['签到时间'] || '').trim()) return json(res, 409, { ok: false, message: '该报名已经签到，不能重复签到' });
      const body = await readJson(req);
      const token = String(body.token || '').trim();
      if (registration['签到码摘要'] && (!token || eventCheckinHash(token) !== registration['签到码摘要'])) {
        await recordAudit(req, session, 'event.registration.checkin', registration['报名ID'], 'rejected', { reason: 'invalid-token', eventId: registration['活动ID'] });
        return json(res, 403, { ok: false, message: '签到码无效，请出示报名二维码' });
      }
      const result = await client.updateRow(eventRegistrationTable, registration._id, { 报名状态: '已签到', 签到时间: new Date().toISOString() });
      await recordAudit(req, session, 'event.registration.checkin', registration['报名ID'], 'success', { eventId: registration['活动ID'] });
      return json(res, 200, { ok: true, result, message: '签到成功' });
    }
    if (req.method === 'GET' && url.pathname === '/api/audit/recent') {
      return json(res, 200, { ok: true, source: `seatable:${auditTable}`, entries: await readRecentAudit(Number(url.searchParams.get('limit') || 50)) });
    }
    if (req.method === 'POST' && url.pathname === '/api/volunteer/hours-preview') {
      const body = await readJson(req);
      const source = await getVolunteerBase();
      const [registrations, checkins] = await Promise.all([
        listAllRows(source, '活动报名总表'), listAllRows(source, '活动签到'),
      ]);
      assertCompleteRows(registrations, checkins);
      if (body.exportConfigId !== undefined) {
        if (typeof body.exportConfigId !== 'string' || !body.exportConfigId) return json(res, 400, { ok: false, message: '导出配置标识无效' });
        const configs = await listAllRows(source, '志愿时长录入excel生成');
        assertCompleteRows(configs);
        return json(res, 200, { ok: true, ...previewHoursExport(registrations, checkins, body.registrationIds, configs.find(row => row._id === body.exportConfigId)) });
      }
      return json(res, 200, { ok: true, ...previewHoursEntry(registrations, checkins, body.registrationIds) });
    }
    if (req.method === 'GET' && url.pathname === '/api/volunteer/overview') {
      const volunteerClient = await getVolunteerBase();
      return json(res, 200, await getVolunteerOverview(volunteerClient));
    }
    if (req.method === 'GET' && url.pathname === '/api/outreach/overview') {
      return json(res, 200, await getOutreachOverview(client));
    }
    // GET /api/outreach/assignees?category= —— 按栏目返回对接人 / 审核人（制度分工表）
    if (req.method === 'GET' && url.pathname === '/api/outreach/assignees') {
      const category = String(url.searchParams.get('category') || '').trim();
      const assignees = await readOutreachAssignees(client);
      const picked = reviewFlow.assigneesForCategory(assignees, category);
      return json(res, 200, { ok: true, category, ...picked, directory: assignees, categories: ARTICLE_CATEGORIES });
    }
    // GET /api/outreach/checklist —— 21 项审核清单模板（管理端审核抽屉用）
    if (req.method === 'GET' && url.pathname === '/api/outreach/checklist') {
      return json(res, 200, { ok: true, checklist: await readChecklist(client) });
    }
    // GET /api/outreach/reviews/:contentId/chain —— 审核链定义 + 当前进度
    const reviewChainMatch = url.pathname.match(/^\/api\/outreach\/reviews\/([^/]+)\/chain$/);
    if (reviewChainMatch && req.method === 'GET') {
      const contentId = decodeURIComponent(reviewChainMatch[1]);
      let source = null;
      const submissions = await readOutreachSubmissionRows(client);
      source = submissions.find((row) => String(row['投稿ID'] || '') === contentId);
      if (!source) {
        const { rows: campaignRows } = await buildCampaignRows(client);
        const item = campaignRows.find((campaign) => campaign.id === contentId);
        if (!item) return json(res, 404, { ok: false, message: '内容不存在' });
        source = { 投稿ID: contentId, 标题: item.title, 类别: item.type, 审核状态: '已通过' };
      }
      const assignees = await readOutreachAssignees(client);
      return json(res, 200, { ok: true, chain: reviewChainView(source, assignees) });
    }
    const outreachReview = url.pathname.match(/^\/api\/outreach\/reviews\/([^/]+)$/);
    if (outreachReview && req.method === 'POST') {
      const contentId = decodeURIComponent(outreachReview[1]);
      if (!/^(planning|creative):[A-Za-z0-9_-]+$/.test(contentId)) return json(res, 400, { ok: false, message: '投稿标识格式不正确' });
      const body = await readJson(req);
      const decision = String(body.decision || '').trim();
      if (!['approve', 'return'].includes(decision)) return json(res, 400, { ok: false, message: '审核结果必须是 approve 或 return' });
      const note = String(body.note || '').trim();
      if (decision === 'return' && !note) return json(res, 400, { ok: false, message: '退回修改必须填写审核意见' });
      const { rows: campaignRows } = await buildCampaignRows(client);
      const item = campaignRows.find((campaign) => campaign.id === contentId);
      if (!item) return json(res, 404, { ok: false, message: '内容不存在，无法审核' });
      const review = { decision, note, reviewer: session.username, reviewedAt: new Date().toISOString() };
      await saveOutreachReview(client, contentId, review, item);
      await recordAudit(req, session, `outreach.review.${decision}`, contentId, 'success', { noteLength: note.length });
      return json(res, 200, { ok: true, review, message: decision === 'approve' ? '内容审核通过' : '内容已退回修改' });
    }
    // POST /api/outreach/reviews/:contentId/step —— v3 多级审核推进（含一轮意见限制）
    const reviewStep = url.pathname.match(/^\/api\/outreach\/reviews\/([^/]+)\/step$/);
    if (reviewStep && req.method === 'POST') {
      const contentId = decodeURIComponent(reviewStep[1]);
      const body = await readJson(req);
      const decision = String(body.decision || '').trim();
      if (!['approve', 'return'].includes(decision)) return json(res, 400, { ok: false, message: '审核结果必须是 approve 或 return' });
      return await withOutreachReview(async () => {
        const { existing, shape, assignees, advance } = await applyReviewStep({
          client, table: outreachSubmissionTable, contentId, body: { ...body, decision },
          account: accountsByUsername.get(session.username), reviewer: session.username,
          readRows: readOutreachSubmissionRows, readAssignees: readOutreachAssignees,
          readChecklist, shapeOf: reviewShapeOf,
        });
        const opinions = Array.isArray(body.opinions) ? body.opinions : [];
        let deliver = [];
        if (decision === 'return') {
          deliver = await reviewFlow.deliverOpinion({
            mail: sendMail,
            submission: { id: contentId, title: shape.title, editor: shape.editor, editorEmail: accountsByUsername.get(shape.editor)?.email || '' },
            entry: advance.entry,
            next: advance.next,
            opinions,
            assignees: reviewFlow.assigneesForCategory(assignees, shape.articleCategory || shape.category),
          });
        }
        await recordAudit(req, session, `outreach.review.step.${decision}`, contentId, 'success', {
          level: advance.entry.level, done: advance.done, delivered: deliver.filter((item) => item.ok).length,
        });
        return json(res, 200, {
          ok: true,
          step: advance.entry,
          done: advance.done,
          status: advance.status,
          chain: reviewChainView({ ...existing, 审核状态: advance.status, 审核层级: advance.patch.审核层级, 审核轨迹: advance.patch.审核轨迹 }, assignees),
          delivered: deliver,
          message: decision === 'approve'
            ? (advance.done ? '终审通过，内容可排期发布' : `第 ${advance.entry.level} 级通过，进入「${advance.next?.name || '下一级'}」`)
            : `第 ${advance.entry.level} 级已退回修改（意见已投递）`,
        });
      });
    }
    // POST /api/outreach/reviews/:contentId/opinion —— 生成意见回传 Word（零依赖 OOXML）
    const reviewOpinion = url.pathname.match(/^\/api\/outreach\/reviews\/([^/]+)\/opinion$/);
    if (reviewOpinion && req.method === 'POST') {
      const contentId = decodeURIComponent(reviewOpinion[1]);
      const body = await readJson(req);
      const rows = await readOutreachSubmissionRows(client);
      const existing = rows.find((row) => String(row['投稿ID'] || '') === contentId);
      if (!existing) return json(res, 404, { ok: false, message: '投稿不存在' });
      const shape = reviewShapeOf(existing);
      const assignees = await readOutreachAssignees(client);
      const chain = reviewChainView(existing, assignees);
      const checklist = await readChecklist(client);
      const checked = Array.isArray(body.checklist) ? body.checklist : checklist;
      const entry = {
        level: Number(body.level) || (chain.current?.level || chain.total),
        name: String(body.levelName || chain.current?.name || ''),
        decision: String(body.decision || 'return'),
        reviewer: session.username,
        at: new Date().toISOString(),
        note: String(body.note || '').trim(),
      };
      const docx = reviewFlow.buildOpinionDocx({
        submission: {
          title: shape.title,
          articleCategory: shape.articleCategory || shape.category,
          editor: shape.editor || String(body.editor || ''),
          reviewLevelText: `第 ${entry.level} 级 · ${entry.name}`,
        },
        checklist: checked,
        opinions: Array.isArray(body.opinions) ? body.opinions : [],
      });
      const filename = `审核意见-${String(shape.title || contentId).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}.docx`;
      await recordAudit(req, session, 'outreach.review.opinion', contentId, 'success', { level: entry.level, bytes: docx.length });
      res.writeHead(200, {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'content-length': String(docx.length),
        'cache-control': 'no-store',
      });
      res.end(docx);
      return true;
    }
    const outreachPublication = url.pathname.match(/^\/api\/outreach\/publications\/([^/]+)\/schedule$/);
    if (outreachPublication && req.method === 'POST') {
      const contentId = decodeURIComponent(outreachPublication[1]);
      const submissions = await readOutreachSubmissionRows(client);
      const submissionRow = submissions.find((row) => String(row['投稿ID'] || '') === contentId);
      if (submissionRow) {
        // v3 门禁：必须走完整条审核链（末级通过）才可排期；存量行按已终审兼容。
        const shape = reviewShapeOf(submissionRow);
        const kind = submissionKindFor({ category: shape.category, publishForm: shape.publishForm });
        if (!canSchedule({ kind, reviewLevel: shape.reviewLevel, reviewTrail: shape.reviewTrail, status: shape.status })) {
          const chain = reviewChainView(submissionRow, await readOutreachAssignees(client));
          return json(res, 409, {
            ok: false,
            code: 'outreach_not_fully_reviewed',
            message: `只有走完全部审核（当前 ${chain.passed}/${chain.total} 级）的内容才能排期`,
            chain,
          });
        }
      } else {
        const reviews = await readOutreachReviews(client);
        if (reviews[contentId]?.decision !== 'approve') return json(res, 409, { ok: false, message: '只有审核通过的内容才能排期' });
      }
      const body = await readJson(req);
      const channel = String(body.channel || '').trim();
      if (!['site', 'email', 'wechat', 'qq'].includes(channel)) return json(res, 400, { ok: false, message: '不支持该发布渠道' });
      const plannedAt = parsedDate(body.plannedAt);
      if (!plannedAt) return json(res, 400, { ok: false, message: '请输入有效的计划发布时间' });
      // N3：发布形式必选（大推文 / 小绿书）。
      const publishForm = normalizePublishForm(body.publishForm ?? body.form);
      if (!publishForm) return json(res, 400, { ok: false, code: 'publish_form_required', message: `请选择发布形式（可选：${PUBLISH_FORMS.join(' / ')}）` });
      const task = { taskId: eventIdentifier('PUB'), contentId, channel, publishForm, plannedAt: plannedAt.toISOString(), status: '待人工发布', note: String(body.note || '').trim(), createdBy: session.username, createdAt: new Date().toISOString(), retryCount: 0 };
      if (submissionRow) {
        await client.updateRow(outreachSubmissionTable, submissionRow._id, { 发布形式: publishForm });
      }
      await saveOutreachPublication(client, contentId, task);
      await recordAudit(req, session, 'outreach.publication.schedule', task.taskId, 'success', { contentId, channel, plannedAt: task.plannedAt });
      return json(res, 201, { ok: true, task, message: '发布任务已排期，等待人工确认' });
    }
    const outreachPublicationResult = url.pathname.match(/^\/api\/outreach\/publications\/([^/]+)\/result$/);
    if (outreachPublicationResult && req.method === 'POST') {
      const contentId = decodeURIComponent(outreachPublicationResult[1]);
      const body = await readJson(req);
      const status = String(body.status || '').trim();
      if (!['published', 'failed'].includes(status)) return json(res, 400, { ok: false, message: '发布结果必须是 published 或 failed' });
      const publications = await readOutreachPublications(client);
      const task = publications[contentId];
      if (!task) return json(res, 404, { ok: false, message: '发布任务不存在' });
      const failureReason = String(body.failureReason || '').trim();
      if (status === 'failed' && !failureReason) return json(res, 400, { ok: false, message: '发布失败必须填写原因' });
      const updated = { ...task, status: status === 'published' ? '已发布' : '发布失败待重试', resultAt: new Date().toISOString(), publishedLink: String(body.publishedLink || '').trim(), failureReason, retryCount: status === 'failed' ? Number(task.retryCount || 0) + 1 : Number(task.retryCount || 0), resultBy: session.username };
      await saveOutreachPublication(client, contentId, updated);
      await recordAudit(req, session, `outreach.publication.${status}`, task.taskId, 'success', { contentId, retryCount: updated.retryCount });
      return json(res, 200, { ok: true, task: updated, message: status === 'published' ? '已记录发布结果' : '已记录失败，可人工重试' });
    }
    const submissionAttachmentsMatch = url.pathname.match(/^\/api\/outreach\/public-submissions\/([^/]+)\/attachments$/);
    if (req.method === 'GET' && submissionAttachmentsMatch) {
      return await attachmentApi.outreachSubmissionAttachments(req, res, attachmentCtx, decodeURIComponent(submissionAttachmentsMatch[1]));
    }

    if (req.method === 'GET' && url.pathname === '/api/outreach/public-submissions') {
      const submissions = await readPublicSubmissions(client);      return json(res, 200, {
        ok: true,
        stats: {
          total: submissions.length,
          pending: submissions.filter((item) => item.status === submissionStatusPending).length,
          approved: submissions.filter((item) => item.status === submissionStatusApproved).length,
          returned: submissions.filter((item) => item.status === submissionStatusReturned).length,
        },
        submissions: submissions.slice(0, 60).map((item) => ({
          id: item.id,
          title: item.title,
          category: item.category,
          // 推文栏目（v3）：审核抽屉用它预填「推文栏目」并匹配对接人/审核人。
          articleCategory: item.articleCategory || '',
          kind: submissionKindFor({ category: item.category, publishForm: item.publishForm }),
          signature: item.signature,
          excerpt: String(item.content || '').slice(0, 220),
          content: item.content,
          contact: maskedApplicant(item.contactName),
          contactEmail: maskedEmail(item.contactEmail),
          portraitConfirm: item.portraitConfirm,
          attachmentCount: Array.isArray(item.attachmentIds) ? item.attachmentIds.length : 0,
          status: item.status,
          submittedAt: item.submittedAt,
          review: item.review || null,
        })),
      });
    }
    // v3：公众投稿不再有独立的「单级审核」入口，一律走
    // POST /api/outreach/reviews/:contentId/step（审核链 + 21 项清单必填）。
    // 旧的 /api/outreach/public-submissions/:id/review 已于 v3 移除——
    // 它只写「审核状态」而漏写「审核层级/审核轨迹」，会让看板状态与审核链错位。
    if (url.pathname.startsWith('/api/community/')) {
      if (!birthdayRollout.enabled) {
    if (req.method === 'GET' && url.pathname === '/api/community/interests') {
      const interests = await readWarmthInterests(client);
      return json(res, 200, {
        ok: true,
        source: `seatable:${communityEnrollmentTable}`,
        stats: {
          total: interests.length,
          pending: interests.filter((item) => item.status === '待人工确认').length,
          accepted: interests.filter((item) => item.status === '已确认').length,
          withdrawn: interests.filter((item) => item.status === '已退出').length,
        },
        interests: interests.slice(0, 60).map((item) => ({
          id: item.id,
          program: item.program,
          frequency: item.frequency,
          nickname: item.nickname,
          contactEmail: maskedEmail(item.email),
          campus: item.campus,
          birthdayMonthDay: item.birthdayMonthDay,
          birthdayCalendar: item.birthdayCalendar,
          note: item.note,
          status: item.status,
          submittedAt: item.submittedAt,
          handledBy: item.handledBy || null,
          handledAt: item.handledAt || null,
        })),
      });
    }
    const interestDecision = url.pathname.match(/^\/api\/community\/interests\/([^/]+)\/(confirm|withdraw)$/);
    if (interestDecision && req.method === 'POST') {
      const interestId = decodeURIComponent(interestDecision[1]);
      const action = interestDecision[2];
      const status = action === 'confirm' ? '已确认' : '已退出';
      const result = await updateEnrollment(client, interestId, {
        状态: status,
        处理人: session.username,
        处理时间: new Date().toISOString(),
      });
      if (!result) return json(res, 404, { ok: false, message: '参加登记不存在' });
      await recordAudit(req, session, `community.interest.${action}`, interestId, 'success', { program: result['项目'] || '' });
      return json(res, 200, { ok: true, interest: { id: interestId, status }, message: action === 'confirm' ? '已确认参加，仍需人工确认后才会发送内容。' : '已登记退出，不再进入任何匹配或发送队列。' });
    }
    if (req.method === 'GET' && url.pathname === '/api/notifications/overview') {
      return json(res, 200, await getNotificationsOverview(client, normalizePermissions(accountsByUsername.get(session.username)?.permissions, session.role), session));
    }
    if (req.method === 'GET' && url.pathname === '/api/community/overview') {
      const consents = await readCommunityConsents(client);
      const current = Object.values(consents).filter((item) => item.actor === session.username && item.enabled);
      return json(res, 200, { ok: true, mode: 'admin-pilot', source: `seatable:${communityEnrollmentTable}`, writesToSeaTable: true, stats: { active: Object.values(consents).filter((item) => item.enabled).length, currentUserActive: current.length }, programs: ['birthday', 'morning'], current: current.map(({ program, frequency, contentMode, updatedAt }) => ({ program, frequency, contentMode, updatedAt })) });
    }
    if (req.method === 'GET' && url.pathname === '/api/community/matching-preview') {
      const consents = await readCommunityConsents(client);
      const eligible = Object.values(consents).filter((item) => item.enabled);
      const byProgram = ['birthday', 'morning'].map((program) => ({ program, eligible: eligible.filter((item) => item.program === program).length, weekly: eligible.filter((item) => item.program === program && item.frequency === 'weekly').length }));
      return json(res, 200, { ok: true, mode: 'preview-only', generatedAt: new Date().toISOString(), candidateCount: eligible.length, byProgram, pairs: [], requiresManualApproval: true, message: '当前仅生成候选统计，不创建匹配关系、不发送消息。' });
    }
    if (req.method === 'GET' && url.pathname === '/api/community/submissions') {
      const submissions = await readCommunitySubmissions(client);
      return json(res, 200, { ok: true, source: `seatable:${communitySubmissionTable}`, stats: { total: submissions.length, pending: submissions.filter((item) => item.status === submissionStatusPending).length, approved: submissions.filter((item) => item.status === submissionStatusApproved).length }, submissions: submissions.slice(0, 30).map(({ id, program, content, tone, status, submittedAt, actor, review }) => ({ id, program, content, tone, status, submittedAt, actor: maskedApplicant(actor), review: review || null })) });
    }
    if (req.method === 'POST' && url.pathname === '/api/community/submissions') {
      const body = await readJson(req);
      const program = String(body.program || '').trim();
      if (!['birthday', 'morning'].includes(program)) return json(res, 400, { ok: false, message: '暂不支持该投稿项目' });
      const consents = await readCommunityConsents(client);
      if (!consents[`${session.username}:${program}`]?.enabled) return json(res, 403, { ok: false, message: '请先加入该项目并确认同意规则' });
      const content = requiredText(body.content, '投稿内容', program === 'birthday' ? 200 : 1000);
      const tone = String(body.tone || '温暖').trim();
      const submission = { id: eventIdentifier('CARE'), program, content, tone, actor: session.username, status: submissionStatusPending, submittedAt: new Date().toISOString(), consentVersion: 'v1' };
      await client.appendRow(communitySubmissionTable, {
        投稿ID: submission.id,
        项目: submission.program,
        内容: submission.content,
        语气: submission.tone,
        提交人: submission.actor,
        状态: submission.status,
        审核意见: '',
        审核人: '',
        提交时间: submission.submittedAt,
        审核时间: '',
        同意版本: submission.consentVersion,
      });
      await recordAudit(req, session, 'community.submission.create', submission.id, 'success', { program, contentLength: content.length });
      return json(res, 201, { ok: true, submission: { id: submission.id, program, status: submission.status, submittedAt: submission.submittedAt }, message: '投稿已进入人工审核队列' });
    }
    const communitySubmissionReview = url.pathname.match(/^\/api\/community\/submissions\/([^/]+)\/review$/);
    if (communitySubmissionReview && req.method === 'POST') {
      const submissionId = decodeURIComponent(communitySubmissionReview[1]);
      const body = await readJson(req);
      const decision = String(body.decision || '').trim();
      if (!['approve', 'return'].includes(decision)) return json(res, 400, { ok: false, message: '审核结果必须是 approve 或 return' });
      const note = String(body.note || '').trim();
      if (decision === 'return' && !note) return json(res, 400, { ok: false, message: '退回投稿必须填写审核意见' });
      const review = { decision, note, reviewer: session.username, reviewedAt: new Date().toISOString() };
      const result = await updateCommunitySubmission(client, submissionId, {
        状态: statusFromReviewDecision(decision),
        审核意见: note,
        审核人: review.reviewer,
        审核时间: review.reviewedAt,
      });
      if (!result) return json(res, 404, { ok: false, message: '投稿不存在' });
      await recordAudit(req, session, `community.submission.${decision}`, submissionId, 'success', { noteLength: note.length });
      return json(res, 200, { ok: true, submission: { id: submissionId, status: statusFromReviewDecision(decision), review }, message: decision === 'approve' ? '投稿审核通过' : '投稿已退回修改' });
    }
    if (req.method === 'POST' && url.pathname === '/api/community/consent') {
      const body = await readJson(req);
      const program = String(body.program || '').trim();
      if (!['birthday', 'morning'].includes(program)) return json(res, 400, { ok: false, message: '暂不支持该温暖连接项目' });
      const frequency = String(body.frequency || '').trim();
      if (!['once', 'weekly'].includes(frequency)) return json(res, 400, { ok: false, message: '请选择有效的接收频率' });
      if (body.consent !== true) return json(res, 400, { ok: false, message: '必须确认自愿参加、可随时退出和人工审核规则' });
      const contentMode = String(body.contentMode || 'reviewed').trim();
      const key = `${session.username}:${program}`;
      await saveEnrollment(client, key, {
        来源: consoleEnrollmentSource,
        项目: program,
        频率: frequency,
        昵称: session.username,
        参与者标识: session.username,
        邮箱: '',
        校区: '',
        生日月日: '',
        备注: '',
        内容模式: contentMode,
        状态: '已确认',
        同意版本: 'v1',
        提交时间: new Date().toISOString(),
        处理人: session.username,
        处理时间: '',
      });
      await recordAudit(req, session, 'community.consent.enable', key, 'success', { program, frequency });
      return json(res, 200, { ok: true, consent: { program, frequency, contentMode, enabled: true }, message: '已记录自愿参加意愿；真实发送仍需人工审核' });
    }
    const communityWithdraw = url.pathname.match(/^\/api\/community\/consent\/([^/]+)\/withdraw$/);
    if (communityWithdraw && req.method === 'POST') {
      const program = decodeURIComponent(communityWithdraw[1]);
      const key = `${session.username}:${program}`;
      const withdrawnAt = new Date().toISOString();
      const consents = await readCommunityConsents(client);
      if (consents[key]) {
        await updateEnrollment(client, key, { 状态: '已退出', 处理人: session.username, 处理时间: withdrawnAt });
      }
      await recordAudit(req, session, 'community.consent.withdraw', key, 'success', { program });
      return json(res, 200, { ok: true, message: '已退出该项目，后续不会进入匹配和发送队列' });
    }


        return json(res, 503, { ok: false, code: 'birthday_disabled', message: '生日祝福升级尚未启用。' });
      }
      await assertBirthdayReady(client);
    }
    if (req.method === 'GET' && url.pathname === '/api/community/interests') {
      const [interests, blacklist] = await Promise.all([readWarmthInterests(client), readWarmthBlacklist(client)]);
      return json(res, 200, {
        ok: true,
        source: `seatable:${communityEnrollmentTable}`,
        stats: (() => {
          const keyOf = (item) => {
            const ref = String(item.participantRef || '');
            const account = accountByBusinessRef(ref);
            const keys = [ref, account?.accountId, account?.username, account?.studentId].filter(Boolean).map(String);
            const blacklisted = blacklist.some((entry) => entry.status === BLACKLIST_ACTIVE && (keys.includes(String(entry.participantRef || '')) || (entry.studentId && keys.includes(String(entry.studentId)))));
            if (blacklisted || String(item.status || '') === enrollmentStatusKicked) return 'blacklisted';
            if (String(item.status || '') === enrollmentStatusWithdrawn) return 'withdrawn';
            return 'normal';
          };
          const buckets = interests.map(keyOf);
          return { total: interests.length, normal: buckets.filter((k) => k === 'normal').length, withdrawn: buckets.filter((k) => k === 'withdrawn').length, blacklisted: buckets.filter((k) => k === 'blacklisted').length };
        })(),
        interests: interests.map((item) => {
          const account = accountByBusinessRef(item.participantRef);
          const activeBlacklist = blacklist.find((entry) => entry.participantRef === item.participantRef && entry.status === BLACKLIST_ACTIVE) || null;
          const displayStatus = activeBlacklist || String(item.status || '') === enrollmentStatusKicked
            ? '已拉黑'
            : String(item.status || '') === enrollmentStatusWithdrawn ? '已退出' : '正常';
          return {
            displayStatus,
            blacklisted: Boolean(activeBlacklist),
            kicked: String(item.status || '') === enrollmentStatusKicked,
            blacklistId: activeBlacklist?.id || '',
            id: item.id,
            program: item.program,
            frequency: item.frequency,
            nickname: item.nickname,
            realName: account?.realName || '',
            studentId: item.studentId,
            contactEmail: item.email,
            campus: item.campus,
            department: account?.department || '',
            grade: account?.grade || '',
            gender: account?.gender || '',
            memberCode: account?.memberCode || '',
            birthdayMonthDay: item.birthdayMonthDay,
            birthdayCalendar: item.birthdayCalendar,
            note: item.note,
            status: item.status,
            submittedAt: item.submittedAt,
            handledBy: item.handledBy || null,
            handledAt: item.handledAt || null,
          };
        }),
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/community/warmth-reports') {
      const reports = await readWarmthReports(client);
      const reportSubmissionIds = [...new Set(reports.map(item => item.submissionId).filter(Boolean))];
      const [library, submissions] = await Promise.all([
        readBlessingLibrary(client, { 投稿ID: reportSubmissionIds }),
        scopedWarmthRows(client, communitySubmissionTable, { 投稿ID: reportSubmissionIds }),
      ]);
      const libraryById = new Map(library.map((item) => [item.submissionId, item]));
      const submissionById = new Map(submissions.map((row) => [String(row['投稿ID'] || ''), row]));
      const countOf = (status) => reports.filter((item) => item.status === status).length;
      const enriched = reports.map((report) => {
        // 处理举报需要看到原文：优先取祝福库，其次回落到投稿表。
        const entry = libraryById.get(report.submissionId);
        const submission = submissionById.get(report.submissionId);
        const author = entry?.submitter || String(submission?.['提交人'] || '');
        return {
          ...report,
          content: entry?.content || String(submission?.['内容'] || ''),
          nickname: entry?.nickname || String(submission?.['署名昵称'] || ''),
          author,
          authorRef: accountByBusinessRef(author)?.accountId || '',
          category: entry?.category || String(submission?.['投递方式'] || ''),
          blessingStatus: entry?.status || String(submission?.['状态'] || ''),
        };
      });
      const countByAuthor = new Map();
      for (const item of enriched) {
        if (!item.authorRef) continue;
        countByAuthor.set(item.authorRef, (countByAuthor.get(item.authorRef) || 0) + 1);
      }
      return json(res, 200, {
        ok: true,
        source: `seatable:${blessingReportTable}`,
        stats: { total: reports.length, pending: countOf(REPORT_STATUS_PENDING), handled: countOf(REPORT_STATUS_HANDLED), dismissed: countOf(REPORT_STATUS_DISMISSED) },
        reports: enriched.slice(0, 60).map((item) => ({ ...item, authorReportCount: countByAuthor.get(item.authorRef) || 0 })),
      });
    }

    const warmthReportDecision = url.pathname.match(/^\/api\/community\/warmth-reports\/([^/]+)\/(handle|dismiss)$/);
    if (warmthReportDecision && req.method === 'POST') {
      const reportId = decodeURIComponent(warmthReportDecision[1]);
      const action = warmthReportDecision[2];
      const body = await readJsonObject(req);
      const note = optionalCleanText(body.note, '处理意见', 500, { allowNewlines: true });
      if (action === 'handle' && !note) return json(res, 400, { ok: false, message: '受理举报必须填写处理意见。' });
      const outcome = await withWarmthLock(client, `warmth-report:${reportId}`, async () => {
        const report = (await readWarmthReports(client, { 举报ID: reportId })).find((item) => item.id === reportId);
        if (!report) return { code: 404, payload: { ok: false, message: '举报记录不存在' } };
        const isEdit = report.status !== REPORT_STATUS_PENDING;
        const status = action === 'handle' ? REPORT_STATUS_HANDLED : REPORT_STATUS_DISMISSED;
        const rows = await scopedWarmthRows(client, blessingReportTable, { 举报ID: reportId });
        const row = rows.find((item) => String(item['举报ID'] || '') === reportId);
        if (!row) return { code: 404, payload: { ok: false, message: '举报记录不存在' } };
        const handledAt = new Date().toISOString();
        const patch = { 状态: status, 处理人: session.username, 处理意见: note, 处理时间: handledAt };
        if (isEdit) patch['举报人确认时间'] = '';
        await client.updateRow(blessingReportTable, row._id, patch);
        const entry = (await scopedWarmthRows(client, blessingLibraryTable, { 投稿ID: report.submissionId })).find((item) => String(item['投稿ID'] || '') === report.submissionId);
        if (action === 'handle') {
          if (entry && shouldWithdrawReportedBlessing(entry['状态'])) {
            await client.updateRow(blessingLibraryTable, entry._id, { 状态: LIBRARY_STATUS_WITHDRAWN });
          }
        } else if (isEdit && report.status === REPORT_STATUS_HANDLED && entry && String(entry['状态'] || '') === LIBRARY_STATUS_WITHDRAWN) {
          await client.updateRow(blessingLibraryTable, entry._id, { 状态: LIBRARY_STATUS_ACTIVE });
        }
        const reporter = accountByBusinessRef(report.reporterRef);
        const notified = await sendMail({
          to: String(reporter?.email || '').trim(),
          subject: isEdit
            ? '关于你举报的生日祝福：处理结果已更新'
            : action === 'handle' ? '关于你举报的生日祝福：已受理' : '关于你举报的生日祝福：处理结果',
          text: isEdit
            ? `你举报的这条生日祝福，管理员更新了处理结果。\n\n当前处理结果：${status}\n\n处理意见：${note || '—'}\n\n南京大学红十字会`
            : action === 'handle'
              ? `你举报的这条生日祝福已核实并处理。\n\n处理意见：${note || '管理员已受理你的举报。'}\n\n该祝福已从祝福库撤下，不会再被匹配或投递。\n\n南京大学红十字会`
              : `你举报的这条生日祝福经核实后未予受理。\n\n处理意见：${note || '—'}\n\n如有疑问可联系管理员。\n\n南京大学红十字会`,
          kind: 'warmth-report',
          idempotencyKey: isEdit
            ? `WARMTH-REPORT:${reportId}:edited:${handledAt}`
            : `WARMTH-REPORT:${reportId}:${action === 'handle' ? 'handled' : 'dismissed'}`,
        });
        await recordAudit(req, session, isEdit ? `community.warmth.report.edit.${action}` : `community.warmth.report.${action}`, reportId, 'success', { submissionId: report.submissionId, notified: notified.ok });
        return {
          code: 200,
          payload: {
            ok: true,
            report: { id: reportId, status, resolutionNote: note, handledBy: session.username, handledAt },
            notified: notified.ok,
            message: isEdit ? '举报处理已更新，并已通知举报人。' : action === 'handle' ? '举报成立：该祝福已从祝福库撤下，并已通知举报人。' : '举报已驳回，并已通知举报人。',
          },
        };
      });
      return json(res, outcome.code, outcome.payload);
    }

    if (req.method === 'POST' && url.pathname === '/api/community/blessing-delivery/run') {
      const body = await readJsonObject(req);
      const onlyDay = body?.day ? cleanText(body.day, '日期', 5) : null;
      if (onlyDay && !isValidBirthdayMonthDay(onlyDay)) return json(res, 400, { ok: false, message: '日期格式应为 MM-DD。' });
      const summary = await runWarmthBirthdayDelivery(client, { onlyDay });
      await recordAudit(req, session, 'community.blessing.delivery.run', onlyDay || 'today', 'success', { delivered: summary.delivered });
      return json(res, 200, { ok: true, summary });
    }
    const warmthInterestAction = url.pathname.match(/^\/api\/community\/interests\/([^/]+)\/(kick|blacklist)$/);
    if (warmthInterestAction && req.method === 'POST') {
      const interestId = decodeURIComponent(warmthInterestAction[1]);
      const action = warmthInterestAction[2];
      const body = action === 'blacklist' ? await readJsonObject(req) : {};
      const reason = action === 'blacklist' ? cleanText(body.reason, '拉黑原因', 500, { allowNewlines: true }) : '';
      const outcome = await withWarmthLock(client, `warmth-enrollment:${interestId}`, async () => {
        const row = (await readEnrollmentRows(client, { 登记ID: interestId })).find((item) => String(item['登记ID'] || '') === interestId);
        if (!row) return { code: 404, payload: { ok: false, message: '参加登记不存在' } };
        const participantRef = String(row['参与者标识'] || '');
        await updateEnrollment(client, interestId, { 状态: enrollmentStatusKicked, 处理人: session.username, 处理时间: new Date().toISOString() });
        let blacklistEntry = null;
        let notified = false;
        if (action === 'blacklist') {
          const result = await blacklistParticipant(client, { participantRef, reason, operator: session.username });
          blacklistEntry = { id: result.id, status: BLACKLIST_ACTIVE };
          notified = result.notified;
        }
        await recordAudit(req, session, `community.interest.${action}`, interestId, 'success', { program: row['项目'] || '', notified });
        return { code: 200, payload: { ok: true, interest: { id: interestId, status: enrollmentStatusKicked }, blacklist: blacklistEntry, notified, message: action === 'blacklist' ? '已拉黑并踢出生日祝福计划，并已邮件告知本人。' : '已将该成员踢出生日祝福计划。' } };
      });
      return json(res, outcome.code, outcome.payload);
    }
    if (req.method === 'GET' && url.pathname === '/api/community/blessing-library') {
      const items = await readBlessingLibrary(client);
      const active = items.filter((item) => item.status === LIBRARY_STATUS_ACTIVE);
      const countOf = (category) => items.filter((item) => item.category === category).length;
      return json(res, 200, {
        ok: true,
        source: `seatable:${blessingLibraryTable}`,
        stats: {
          total: items.length,
          active: active.length,
          repository: countOf(LIBRARY_CATEGORY_REPOSITORY),
          random: countOf(LIBRARY_CATEGORY_RANDOM),
          sent: countOf(LIBRARY_CATEGORY_SENT),
          offline: countOf(LIBRARY_CATEGORY_OFFLINE),
        },
        items: items.slice(0, 200),
      });
    }
    const warmthMember = url.pathname.match(/^\/api\/community\/warmth-members\/([^/]+)$/);
    if (warmthMember && req.method === 'GET') {
      const ref = decodeURIComponent(warmthMember[1]);
      const account = [...accountsByUsername.values()].find((item) => item.accountId === ref || item.username === ref || String(item.studentId || '') === ref);
      if (!account) return json(res, 404, { ok: false, message: '成员不存在' });
      const participantRef = account.accountId || account.username;
      const [enrollments, library, reports, blacklist, deliveries] = await Promise.all([
        readWarmthInterests(client, { 参与者标识: participantRef }),
        readBlessingLibrary(client, { 来源投稿人: account.username }, { classifySent: false }),
        readWarmthReports(client),
        readWarmthBlacklist(client, { 参与者标识: participantRef }),
        scopedWarmthRows(client, blessingDeliveryTable, { 收件人标识: participantRef, 站内状态: DELIVERY_SITE_DONE }),
      ]);
      const enrollment = enrollments.find((item) => item.participantRef === participantRef) || null;
      const activeBlacklist = blacklist.find((item) => item.participantRef === participantRef && item.status === BLACKLIST_ACTIVE) || null;
      return json(res, 200, {
        ok: true,
        member: {
          accountId: participantRef,
          username: account.username,
          realName: account.realName || '',
          studentId: account.studentId || '',
          email: account.email || '',
          department: account.department || '',
          grade: account.grade || '',
          gender: account.gender || '',
          campus: account.campus || '',
          memberCode: account.memberCode || '',
          emailVerified: account.emailVerified === true,
          registeredAt: account.registeredAt || null,
          warmth: {
            enrollmentStatus: enrollment?.status || '未加入',
            birthdayMonthDay: enrollment?.birthdayMonthDay || '',
            birthdayCalendar: enrollment?.birthdayCalendar || 'solar',
            enrollmentCampus: enrollment?.campus || '',
            joinedAt: enrollment?.submittedAt || null,
            written: library.filter((item) => item.submitter === account.username).length,
            received: deliveries.filter((item) => String(item['收件人标识'] || '') === participantRef && String(item['站内状态'] || '') === DELIVERY_SITE_DONE).length,
            reported: reports.filter((item) => item.author === account.username).length,
            blacklisted: Boolean(activeBlacklist),
            blacklistReason: activeBlacklist?.reason || '',
          },
        },
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/community/warmth-blacklist') {
      const body = await readJsonObject(req);
      const participantRef = cleanText(body.participantRef, '成员标识', 120);
      const reason = cleanText(body.reason, '拉黑原因', 500, { allowNewlines: true });
      const result = await blacklistParticipant(client, { participantRef, reason, operator: session.username });
      await recordAudit(req, session, 'community.warmth.blacklist', result.id, 'success', { participantRef, notified: result.notified });
      return json(res, 200, { ok: true, blacklist: { id: result.id, status: BLACKLIST_ACTIVE }, notified: result.notified, message: '已拉黑该成员（如有生效登记会一并踢出），并已邮件告知本人。' });
    }
    // 按成员解除：解除生效中的黑名单记录，并把被踢出的登记恢复为「已确认」
    if (req.method === 'POST' && url.pathname === '/api/community/warmth-blacklist/release') {
      const body = await readJsonObject(req);
      const ref = String(body.participantRef || body.studentId || '').trim();
      if (!ref) return json(res, 400, { ok: false, message: '缺少成员标识' });
      const { released, restored } = await releaseBlacklistForRef(client, ref, session.username);
      await recordAudit(req, session, 'community.warmth.blacklist.release', ref, 'success', { released, restored });
      return json(res, 200, { ok: true, released, restored, message: `已解除黑名单${released ? `（${released} 条）` : ''}${restored ? `，并恢复 ${restored} 条登记` : ''}。` });
    }
    if (req.method === 'GET' && url.pathname === '/api/community/warmth-blacklist') {
      // 只返回生效中的拉黑；已解除的成员从名单移除（记录仍保留在表中供审计）
      const entries = (await readWarmthBlacklist(client)).filter((entry) => entry.status === BLACKLIST_ACTIVE);
      const latest = new Map();
      for (const entry of entries) {
        const key = entry.participantRef || entry.studentId || entry.id;
        const seen = latest.get(key);
        if (!seen || String(entry.createdAt || '') > String(seen.createdAt || '')) latest.set(key, entry);
      }
      const list = [...latest.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      return json(res, 200, { ok: true, source: `seatable:${blacklistTable}`, entries: list.slice(0, 60) });
    }
    const blacklistRelease = url.pathname.match(/^\/api\/community\/warmth-blacklist\/([^/]+)\/release$/);
    if (blacklistRelease && req.method === 'POST') {
      const entryId = decodeURIComponent(blacklistRelease[1]);
      const row = (await scopedWarmthRows(client, blacklistTable, { 黑名单ID: entryId })).find((item) => String(item['黑名单ID'] || '') === entryId);
      if (!row) return json(res, 404, { ok: false, message: '黑名单记录不存在' });
      // 与「按成员解除」同一套逻辑：解除记录并恢复被踢出的登记，避免成员停留在「已拉黑」
      const { released, restored } = await releaseBlacklistForRef(client, String(row['参与者标识'] || row['学号'] || ''), session.username);
      await recordAudit(req, session, 'community.interest.blacklist.release', entryId, 'success', { released, restored });
      return json(res, 200, { ok: true, entry: { id: entryId, status: BLACKLIST_RELEASED }, released, restored, message: '已解除拉黑，该成员可重新加入。' });
    }
    const interestDecision = url.pathname.match(/^\/api\/community\/interests\/([^/]+)\/(confirm|withdraw)$/);
    if (interestDecision && req.method === 'POST') {
      const interestId = decodeURIComponent(interestDecision[1]);
      const action = interestDecision[2];
      const outcome = await withWarmthLock(client, `warmth-enrollment:${interestId}`, async () => {
        const rows = await readEnrollmentRows(client);
        const row = rows.find((item) => String(item['登记ID'] || '') === interestId);
        if (!row) return { code: 404, payload: { ok: false, message: '参加登记不存在' } };
        const status = action === 'confirm' ? enrollmentStatusConfirmed : enrollmentStatusWithdrawn;
        await updateEnrollment(client, interestId, { 状态: status, 处理人: session.username, 处理时间: new Date().toISOString() });
        await recordAudit(req, session, `community.interest.${action}`, interestId, 'success', { program: row['项目'] || '' });
        return { code: 200, payload: { ok: true, interest: { id: interestId, status }, message: action === 'confirm' ? '已确认参加，内容仍需人工审核后才会转达。' : '已登记退出，不再进入任何匹配或发送队列。' } };
      });
      return json(res, outcome.code, outcome.payload);
    }
    if (req.method === 'GET' && url.pathname === '/api/notifications/overview') {
      return json(res, 200, await getNotificationsOverview(client, normalizePermissions(accountsByUsername.get(session.username)?.permissions, session.role), session));
    }
    // 「我的参与」：与公众端同一套登记模型（温暖连接参加表），不再读旧 consent 结构
    if (req.method === 'GET' && url.pathname === '/api/community/overview') {
      const actorRef = businessAccountRef(session);
      const [rows, candidates] = await Promise.all([readEnrollmentRows(client), readConfirmedWarmthCandidates(client)]);
      const mine = rows.filter((row) => [actorRef, session.username].includes(String(row['参与者标识'] || '')));
      const current = mine.map((row) => ({
        id: String(row['登记ID'] || ''),
        program: String(row['项目'] || ''),
        status: String(row['状态'] || ''),
        frequency: String(row['频率'] || ''),
        birthdayMonthDay: String(row['生日月日'] || ''),
        birthdayCalendar: String(row['生日历法'] || 'solar'),
        campus: String(row['校区'] || ''),
        submittedAt: row['提交时间'] || null,
        handledBy: String(row['处理人'] || '') || null,
      }));
      return json(res, 200, {
        ok: true,
        mode: 'admin-pilot',
        source: `seatable:${communityEnrollmentTable}`,
        writesToSeaTable: true,
        stats: { active: candidates.length, currentUserActive: current.filter((item) => isActiveEnrollmentStatus(item.status)).length },
        programs: ['birthday', 'morning'],
        current,
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/community/matching-preview') {
      const preview = await buildWarmthMatchingPreview(client);
      return json(res, 200, {
        ok: true,
        mode: 'preview-only',
        generatedAt: new Date().toISOString(),
        candidateCount: preview.stats.candidates,
        byProgram: preview.byProgram,
        stats: preview.stats,
        pools: preview.pools,
        previewRows: preview.previewRows,
        pairs: [],
        requiresManualApproval: true,
        message: '按候选、已通过投稿额度和可用祝福池生成预计接收量；不创建真实配对关系，确认后才会产生投递记录。',
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/community/submissions') {
      const submissions = await readCommunitySubmissions(client);
      return json(res, 200, { ok: true, source: `seatable:${communitySubmissionTable}`, stats: { total: submissions.length, pending: submissions.filter((item) => item.status === submissionStatusPending).length, approved: submissions.filter((item) => item.status === submissionStatusApproved).length, returned: submissions.filter((item) => item.status === submissionStatusReturned).length, rejected: submissions.filter((item) => item.status === submissionStatusRejected).length }, submissions: submissions.slice(0, 30).map(({ id, program, content, tone, status, submittedAt, actor, nickname, delivery, targetStudentId, deliveryState, friendEmail, friendBirthday, scheduledDate, review }) => ({ id, program, content, tone, status, submittedAt, actor: maskedApplicant(actor), nickname, delivery, targetStudentId, deliveryState, friendEmail, friendBirthday, scheduledDate, review: review || null })) });
    }
    if (req.method === 'POST' && url.pathname === '/api/community/submissions') {
      const body = await readJsonObject(req);
      const program = String(body.program || '').trim();
      if (!['birthday', 'morning'].includes(program)) return json(res, 400, { ok: false, message: '暂不支持该投稿项目' });
      const consents = await readCommunityConsents(client);
      if (!consents[`${session.username}:${program}`]?.enabled) return json(res, 403, { ok: false, message: '请先加入该项目并确认同意规则' });
      const content = requiredText(body.content, '投稿内容', program === 'birthday' ? 200 : 1000);
      const tone = String(body.tone || '温暖').trim();
      const submission = { id: eventIdentifier('CARE'), program, content, tone, actor: session.username, status: submissionStatusPending, submittedAt: new Date().toISOString(), consentVersion: 'v1' };
      await client.appendRow(communitySubmissionTable, {
        投稿ID: submission.id,
        项目: submission.program,
        内容: submission.content,
        语气: submission.tone,
        提交人: submission.actor,
        状态: submission.status,
        审核意见: '',
        审核人: '',
        提交时间: submission.submittedAt,
        审核时间: '',
        同意版本: submission.consentVersion,
      });
      await recordAudit(req, session, 'community.submission.create', submission.id, 'success', { program, contentLength: content.length });
      return json(res, 201, { ok: true, submission: { id: submission.id, program, status: submission.status, submittedAt: submission.submittedAt }, message: '投稿已进入人工审核队列' });
    }
    const communitySubmissionReview = url.pathname.match(/^\/api\/community\/submissions\/([^/]+)\/review$/);
    if (communitySubmissionReview && req.method === 'POST') {
      const submissionId = decodeURIComponent(communitySubmissionReview[1]);
      const body = await readJsonObject(req);
      const decision = cleanText(body.decision, '审核结果', 20);
      if (!['approve', 'return', 'reject', 'reopen'].includes(decision)) return json(res, 400, { ok: false, message: '审核结果必须是 approve、return、reject 或 reopen' });
      const note = decision === 'reopen' ? '' : optionalCleanText(body.note, '审核意见', 500, { allowNewlines: true });
      if (decision !== 'approve' && decision !== 'reopen' && !note) return json(res, 400, { ok: false, message: decision === 'reject' ? '直接拒绝必须填写理由' : '退回投稿必须填写审核意见' });
      const outcome = await withWarmthLock(client, `warmth-blessing:${submissionId}`, async () => {
        const rows = await warmthRows(client, communitySubmissionTable);
        const row = rows.find((item) => String(item['投稿ID'] || '') === submissionId);
        if (!row) return { code: 404, payload: { ok: false, message: '投稿不存在' } };
        const currentStatus = String(row['状态'] || submissionStatusPending);
        if (decision === 'reopen') {
          if (currentStatus !== submissionStatusRejected) return { code: 409, payload: { ok: false, message: '只有「已拒绝」的投稿可以撤销拒绝并重新审核。' } };
          // 撤销拒绝会让该稿重新占用额度：先复检额度与祝福仓库唯一性，避免绕过上限
          const author = String(row['提交人'] || '');
          const authorActive = (await readWarmthBlessings(client)).filter((item) => item.actor === author && item.id !== submissionId && item.status !== submissionStatusRejected && item.deliveryKey !== 'friend' && item.delivery !== '写给挚友');
          if (row['投递方式'] !== WARMTH_DELIVERY_LABELS.friend && authorActive.length >= WARMTH_SUBMISSION_LIMIT) {
            return { code: 409, payload: { ok: false, message: `该账号已达到 ${WARMTH_SUBMISSION_LIMIT} 条上限，撤销拒绝会超出额度；请先让其删除或修改其他祝福。` } };
          }
          if (String(row['投递方式'] || '') === WARMTH_DELIVERY_LABELS.repository && authorActive.some((item) => item.deliveryKey === 'repository')) {
            return { code: 409, payload: { ok: false, message: '该账号已有一条祝福仓库，撤销拒绝会出现两条；请先处理其中一条。' } };
          }
          await client.updateRow(communitySubmissionTable, row._id, { 状态: submissionStatusPending, 审核意见: '', 审核人: '', 审核时间: '' });
          await recordAudit(req, session, 'community.submission.reopen', submissionId, 'success', {});
          await notifyBirthdayReview(row, { 状态: submissionStatusPending, 审核意见: '' }, new Date().toISOString());
          return { code: 200, payload: { ok: true, submission: { id: submissionId, status: submissionStatusPending, review: null }, message: '已撤销拒绝，投稿重新进入待审核。' } };
        }
        if (currentStatus !== submissionStatusPending) return { code: 409, payload: { ok: false, message: '只有「待审核」的投稿可以审核；如需重审已拒绝投稿，请先撤销拒绝。' } };
        const review = { decision, note, reviewer: session.username, reviewedAt: new Date().toISOString() };
        const nextStatus = decision === 'approve' ? submissionStatusApproved : decision === 'reject' ? submissionStatusRejected : submissionStatusReturned;
        await client.updateRow(communitySubmissionTable, row._id, { 状态: nextStatus, 审核意见: note, 审核人: review.reviewer, 审核时间: review.reviewedAt });
        if (decision === 'approve') await ingestApprovedBlessing(client, row, session.username, review.reviewedAt);
        await recordAudit(req, session, `community.submission.${decision}`, submissionId, 'success', { noteLength: note.length });
        const notification = await notifyBirthdayReview(row, { 状态: nextStatus, 审核意见: note }, review.reviewedAt);
        const decisionMessage = decision === 'approve' ? '投稿审核通过' : decision === 'reject' ? '投稿已直接拒绝' : '投稿已退回修改';
        return { code: 200, payload: { ok: true, submission: { id: submissionId, status: nextStatus, review }, notification, message: decisionMessage } };
      });
      return json(res, outcome.code, outcome.payload);
    }
    if (req.method === 'POST' && url.pathname === '/api/community/consent') {
      const body = await readJsonObject(req);
      const program = String(body.program || '').trim();
      if (!['birthday', 'morning'].includes(program)) return json(res, 400, { ok: false, message: '暂不支持该温暖连接项目' });
      const frequency = String(body.frequency || '').trim();
      if (!['once', 'weekly'].includes(frequency)) return json(res, 400, { ok: false, message: '请选择有效的接收频率' });
      if (body.consent !== true) return json(res, 400, { ok: false, message: '必须确认自愿参加、可随时退出和人工审核规则' });
      const contentMode = String(body.contentMode || 'reviewed').trim();
      const key = `${session.username}:${program}`;
      await saveEnrollment(client, key, {
        来源: consoleEnrollmentSource,
        项目: program,
        频率: frequency,
        昵称: session.username,
        参与者标识: businessAccountRef(session),
        邮箱: '',
        校区: '',
        生日月日: '',
        备注: '',
        内容模式: contentMode,
        状态: enrollmentStatusConfirmed,
        同意版本: 'v1',
        提交时间: new Date().toISOString(),
        处理人: session.username,
        处理时间: '',
      });
      await recordAudit(req, session, 'community.consent.enable', key, 'success', { program, frequency });
      return json(res, 200, { ok: true, consent: { program, frequency, contentMode, enabled: true }, message: '已记录自愿参加意愿；真实发送仍需人工审核' });
    }
    const communityWithdraw = url.pathname.match(/^\/api\/community\/consent\/([^/]+)\/withdraw$/);
    if (communityWithdraw && req.method === 'POST') {
      const program = decodeURIComponent(communityWithdraw[1]);
      const key = `${session.username}:${program}`;
      const withdrawnAt = new Date().toISOString();
      const consents = await readCommunityConsents(client);
      if (consents[key]) {
        await updateEnrollment(client, key, { 状态: enrollmentStatusWithdrawn, 处理人: session.username, 处理时间: withdrawnAt });
      }
      await recordAudit(req, session, 'community.consent.withdraw', key, 'success', { program });
      return json(res, 200, { ok: true, message: '已退出该项目，后续不会进入匹配和发送队列' });
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      const metadata = await client.getMetadata();
      const allTables = metadata?.tables || [];
      if (url.searchParams.get('summary') === 'true') return json(res, 200, { ok: true, tableCount: allTables.length });
      const permissions = normalizePermissions(accountsByUsername.get(session.username)?.permissions, session.role);
      const metadataVisible = permissions.includes('data') || permissions.includes('settings');
      const tables = (metadataVisible ? allTables : []).map(({ _id, name, columns = [], views = [] }) => ({
        _id, name,
        columns: columns.map(({ key, name: columnName, type }) => ({ key, name: columnName, type })),
        views: views.map(({ _id: viewId, name: viewName }) => ({ _id: viewId, name: viewName })),
        dataAccess: genericDataAccess(name),
      }));
      const runtime = permissions.includes('settings') ? { cache: displayReadCacheStats(), queue: jobQueue.stats() } : undefined;
      return json(res, 200, { ok: true, server: serverUrl, configuredTable: configuredTable || null, tableCount: allTables.length, metadataVisible, tables, volunteerSourceConfigured: Boolean(volunteerBase), ...(runtime ? { runtime } : {}) });
    }
    if (req.method === 'GET' && url.pathname === '/api/rows') {
      const table = tableFrom(url);
      const rows = await readPagedRows(client, table, {
        pageSize: 100,
        maxRows: 100,
      });
      return json(res, 200, {
        ok: true,
        table,
        rows,
        readMeta: rows.readMeta,
        previewOnly: true,
      });
    }
    if (url.pathname === '/api/rows' && req.method === 'POST') {
      const body = await readJson(req);
      const table = tableFrom(url, body);
      assertGenericWriteAllowed(table);
      if (!body.row || typeof body.row !== 'object' || Array.isArray(body.row)) {
        const error = new Error('row must be a JSON object keyed by SeaTable column names'); error.statusCode = 400; throw error;
      }
      const result = await client.appendRow(table, body.row);
      await recordAudit(req, session, 'data.row.create', result?._id || 'new', 'success', { table });
      return json(res, 201, { ok: true, table, result });
    }
    const rowMatch = url.pathname.match(/^\/api\/rows\/([^/]+)$/);
    if (rowMatch && req.method === 'PUT') {
      const body = await readJson(req); const table = tableFrom(url, body);
      assertGenericWriteAllowed(table);
      const rowId = decodeURIComponent(rowMatch[1]);
      const result = await client.updateRow(table, rowId, body.row || {});
      await recordAudit(req, session, 'data.row.update', rowId, 'success', { table });
      return json(res, 200, { ok: true, table, result });
    }
    if (rowMatch && req.method === 'DELETE') {
      const table = tableFrom(url);
      assertGenericWriteAllowed(table);
      const rowId = decodeURIComponent(rowMatch[1]);
      const result = await client.deleteRow(table, rowId);
      await recordAudit(req, session, 'data.row.delete', rowId, 'success', { table });
      return json(res, 200, { ok: true, table, result });
    }
    return json(res, 404, { ok: false, message: 'Not found' });
  } catch (error) {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const failure = apiFailure(error);
    return json(res, failure.status, failure.payload);
  }
}

const staticFile = createStaticHandler(publicDir);
const pdfAssets = createPdfAssets();
// 后台定时任务与页面请求争用同一个上游；有人操作时后台任务主动让路。
const backgroundGate = createIdleGate();
const server = http.createServer((req, res) => observer.http(req,res,async () => {
  backgroundGate.mark();
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      assertApiRequestPath(url.pathname);
      if(url.pathname==='/api/telemetry/client'){
        return await clientTelemetry(req,res,{json,limit:r=>enforcePublicLimit(r,'telemetry',12000)});
      }
      const display = isDisplayRequest(req.method, url.pathname);

      // 写表记账：请求内记录被写入的表，结束后只失效依赖这些表的投影。
      const journal = createWriteJournal();
      try {
        return await withWriteJournal(journal, () => withHttpRequestBudget(req, res, () =>
          display
            ? withDisplayReads(() => api(req, res, url))
            : api(req, res, url),
        ));
      } finally {
        if (journal.size) for (const table of journal) invalidateWrittenSnapshots(table);
      }
    }
    if (await pdfAssets(req, res, url)) return;
    return await staticFile(req, res, url);
  } catch (error) {
    if(res.destroyed||res.writableEnded)return;
    if (!res.headersSent && !res.destroyed) { const failure = apiFailure(error); json(res, failure.status, failure.payload); }
    else res.destroy();
  }
}));
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Open http://localhost:${port} or set another PORT in .env.`);
  else console.error('HTTP server failed; check service configuration and runtime status.');
  process.exitCode = 1;
});
registerShutdownSignals({
  server,
  shutdown: createHttpShutdown(server, { timeoutMs: 10000 }),
});
registerShutdownCleanup(server, () => morningPlazaSnapshotStore.close());
registerShutdownCleanup(server,async()=>{await decisionMail.close();decisionMailStore.close();});
server.listen(port, () => {
  const stopTelemetry=observer.startRuntime();server.once('close',stopTelemetry);
  const financeMailTick = () => {
    if (process.env.PLATFORM_REIMBURSEMENTS_MAIL_ENABLED !== 'true' || !backgroundGate.allow()) return;
    void withRequestBudget(() => withSharedWriteLock(() => reimbursementNotifier.deliver()))
      .catch(() => console.warn('Reimbursement mail deferred; inspect notification status.'));
  };
  const financeMailTimer = setInterval(financeMailTick, 30_000); financeMailTimer.unref();
  registerShutdownCleanup(server, () => clearInterval(financeMailTimer));
  // 持久化任务队列：请求只入队，通知与投递在后台按租约执行。
  jobQueue.start();
  registerShutdownCleanup(server, () => {
    void jobQueue.stop({ timeoutMs: 5_000 }).finally(() => {
      // 停机时把在途任务立即放回队列，重启后不必等租约过期。
      try { jobQueue.store.releaseStale(Number.MAX_SAFE_INTEGER); } catch { /* 存储不可用时由下次启动回收 */ }
      try { jobQueue.close(); } catch { /* 关闭失败不影响进程退出 */ }
    });
  });
  // No business writes: warm the public schema discovery, shared by both programmes.
  void observer.dependency('background','refresh',warmthCapabilities);
  const capabilityTimer = setInterval(() => { if(backgroundGate.allow()) void observer.dependency('background','refresh',warmthCapabilities); }, 30_000);
  capabilityTimer.unref();
  if(process.env.PLATFORM_WORKFLOW_MODE==='production'){
    let warming=false;
    const warm=async()=>{if(warming)return;warming=true;try{await observer.dependency('background','refresh',()=>withDisplayReads(async()=>getPublicEvents(await getBase())));}catch{console.warn('Activity snapshot refresh deferred');}finally{warming=false;}};
    const vacancyTimer=setInterval(()=>{if(!backgroundGate.allow())return;observer.dependency('background','deliver',()=>getWishlist().then(w=>w.deliver())).catch(()=>console.warn('Vacancy reminders deferred'));},60_000);vacancyTimer.unref();
    let operationsRunning=false;
    const operations=async()=>{if(operationsRunning)return;operationsRunning=true;try{
      if(process.env.PLATFORM_ORDINARY_PLACES!=='true'&&process.env.PLATFORM_REGISTRATION_NOTIFICATIONS!=='true'&&!mailerStatus().configured)return;
      const workflow=await getWorkflow();
      if(process.env.PLATFORM_ORDINARY_PLACES==='true')await workflow.reconcilePlaces();
      const data=await workflow.read();
      if(mailerStatus().configured){const messages=participationReminderMessages(data.events,data.registrations,process.env.PUBLIC_BASE_URL||'https://njuredcross.cn');if(messages.length)decisionMail.enqueue(messages.map(m=>({kind:'participation',id:m.registrationId,requestAt:m.startAt})));}
      // Inventory is observational outside booking mutations; never changes registration history.
      if(process.env.PLATFORM_REGISTRATION_NOTIFICATIONS==='true')await observer.dependency('background','reconcile',()=>reconcileRegistrationNotifications(data));
      await reconcileApprovalReminders();
    }catch{console.warn('Registration notifications deferred for reconciliation');}finally{operationsRunning=false;}};
    // 献血车周次自动化：每周按配置生成下一周次岗位，并按配置的发布时间开放报名。
    let bloodWeekRunning=false;
    const bloodWeekAutomation=async()=>{
      if(bloodWeekRunning)return;
      bloodWeekRunning=true;
      try{
        const workflow=await getWorkflow();
        const outcome=await observer.dependency('background','generate',()=>workflow.runBloodWeekAutomation({actor:'njutable-automation'}));
        if(outcome?.ran)console.log(`[blood-week] 已生成 ${outcome.result.label}（${outcome.result.monday}）排班 ${outcome.result.rows} 行，发布时间 ${outcome.result.publishAt||'即时开放'}`);
      }catch(error){console.warn('Blood week automation deferred:',error.code||'service_unavailable');}
      finally{bloodWeekRunning=false;}
    };
    const bloodWeekTimer=setInterval(()=>{if(backgroundGate.allow())void bloodWeekAutomation();},5*60*1000);
    bloodWeekTimer.unref();
    void bloodWeekAutomation();
    const registrationTimer=setInterval(()=>{if(backgroundGate.allow())operations();},60_000);registrationTimer.unref();
    const finalHoursTimer=setInterval(()=>{if(backgroundGate.allow())queueFinalHoursMail();},60_000);finalHoursTimer.unref();queueFinalHoursMail();
    // 公共快照是 10 秒新鲜 + 20 秒陈旧；30 秒一次预热足以让它常热，又不必每 10 秒回源。
    const activityTimer=setInterval(()=>{if(backgroundGate.allow())warm();},30_000);activityTimer.unref();void warm();
    registerShutdownCleanup(server,()=>{clearInterval(vacancyTimer);clearInterval(activityTimer);clearInterval(registrationTimer);clearInterval(finalHoursTimer);clearInterval(bloodWeekTimer);});
  }

  const warmthDeliveryHour = Number(process.env.WARMTH_DELIVERY_HOUR || 8);
  // A submitted friend letter explicitly requests one birthday email after approval.
  // This schedule is independent of random matching's bulk-delivery opt-in.
  if (birthdayRollout.enabled) {
    let friendDeliveryRunning = false;
    const friendTick = async () => {
      if (friendDeliveryRunning || !mailerStatus().configured) return;
      const now = new Date();
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(now));
      if (hour < warmthDeliveryHour) return;
      friendDeliveryRunning = true;
      try {
        await withRequestBudget(async () => runFriendBirthdayBatch(await getBase(), now));
      } catch { console.warn('Friend birthday delivery deferred; inspect pending mail tasks.'); }
      finally { friendDeliveryRunning = false; }
    };
    const friendTimer = setInterval(() => { void friendTick(); }, 60_000);
    friendTimer.unref();
    registerShutdownCleanup(server, () => clearInterval(friendTimer));
    void friendTick();
  }

  // 每天按上海时间扫描生日成员；需显式启用自动投递。
  if (birthdayRollout.automaticDelivery) {
    let lastDeliveryDay = '';
    let delivering = false;

    const tick = async () => {
      try {
        const day = shanghaiMonthDay();
        const hour = Number(new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Shanghai',
          hour: '2-digit',
          hour12: false,
        }).format(new Date()));

        if (hour < warmthDeliveryHour || lastDeliveryDay === day || delivering) {
          return;
        }

        delivering = true;
        const client = await getBase();
        await assertBirthdayReady(client);
        const summary = await observer.dependency('background','deliver',()=>runWarmthBirthdayDelivery(client));
        lastDeliveryDay = day;

        console.log(`[warmth] 生日祝福投递完成（${summary.day}）：收件人 ${summary.recipients}，投递 ${summary.delivered}，邮件 ${summary.mailed}`);
      } catch (error) {
        console.error(
          'Warmth birthday delivery deferred:',
          error.code || 'service_unavailable',
        );
      } finally {
        delivering = false;
      }
    };

    const timer = setInterval(()=>{if(!backgroundGate.allow())return;tick();}, 5 * 60 * 1000);
    timer.unref();
    registerShutdownCleanup(server, () => clearInterval(timer));
    void tick();

    console.log(`Warmth birthday delivery: enabled, runs at ${String(warmthDeliveryHour).padStart(2, '0')}:00 Asia/Shanghai`);
  } else {
    console.log('Warmth birthday delivery: disabled unless both birthday and delivery are explicitly enabled');
  }
  console.log(`NJU Red Cross platform running at http://localhost:${port}`);
  console.log(`SeaTable server: ${serverUrl}`);
  console.log(`Platform authentication: three roles (super_admin, platform_admin, member), session ${sessionTtlHours}h`);
  const mail = mailerStatus();
  console.log(mail.configured
    ? `Outbound mail: SMTP transport ready${mail.from ? ` (from ${mail.from})` : ''}`
    : (isProduction
      ? 'Outbound mail: SMTP not configured; public self-registration is disabled.'
      : 'Outbound mail: SMTP not configured; verification codes are logged to the console (development transport).'));
      const mailRepairTimer = setInterval(() => {
        if(!backgroundGate.allow())return;
        void repairStoredMailRecords();
      }, 60 * 1000);

      mailRepairTimer.unref();
      registerShutdownCleanup(server, () => clearInterval(mailRepairTimer));
      void repairStoredMailRecords();
      if (String(process.env.MATERIALS_REMINDER_ENABLED || 'false').toLowerCase() === 'true' && smtpHost && smtpUser && smtpPassword) {
    const reminderTask = startBackgroundTask(
      () => observer.dependency('background','overdue',sendOverdueReminders),
      {
        intervalMs: reminderIntervalMinutes * 60 * 1000,
        onError: () => {
          console.error('Overdue reminder failed; preserve delivery records and check the task state.');
        },
      },
    );

    registerShutdownCleanup(server, () => reminderTask.stop());
  } else {
    console.log('Overdue email reminder: disabled unless explicitly enabled and SMTP is configured.');
  }
});
