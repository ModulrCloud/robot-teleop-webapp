import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSatelliteDish,
  faUsers,
  faShieldAlt,
  faRobot,
  faHistory,
  faTerminal,
  faBell,
  faUserPlus,
  faCrown,
  faArrowLeft,
  faChevronRight,
  faCircle,
  faBan,
  faPlus,
  faWifi,
  faExclamationTriangle,
  faPlay,
  faCheck,
  faTimesCircle,
  faDownload,
  faProjectDiagram,
  faDotCircle,
  faList,
  faCopy,
  faPen,
  faToggleOn,
  faToggleOff,
  faCode,
  faCog,
  faRunning,
  faThermometerHalf,
  faWrench,
  faGlobe,
  faLaptop,
  faUser,
  faMapMarkerAlt,
  faClock,
  faEnvelope,
  faLink,
  faEye,
  faEyeSlash,
  faBullhorn,
  faInfoCircle,
  faExclamationCircle,
  faServer,
  faGamepad,
  faKeyboard,
  faSlidersH,
  faMapMarkedAlt,
  faCrosshairs,
  faArrowsAlt,
  faBarcode,
} from "@fortawesome/free-solid-svg-icons";
import type {
  Organization,
  OrgRole,
  OrgMember,
  OrgInvite,
  OrgRobot,
  OrgSession,
  OrgLog,
  RosCommand,
  RosCommandCategory,
  DenyListEntry,
  DenyScope,
  NotificationRule,
  OrgNotification,
  NotificationType,
  CommandHQTab,
  CustomizationSubTab,
  ControllerConfig,
  LocationMapping,
  KeyboardMapping,
} from "../types/organization";
import { PERMISSION_LABELS, ROS_COMMAND_CATEGORIES, DENY_SCOPES, DENY_REASONS, NOTIFICATION_EVENTS } from "../types/organization";
import {
  getMockOrgById,
  getMockRolesForOrg,
  getMockMembersForOrg,
  getMockInvitesForOrg,
  getMockRobotsForOrg,
  getMockSessionsForOrg,
  getMockLogsForOrg,
  getMockRosCommandsForOrg,
  getMockDenyListForOrg,
  getMockNotificationRulesForOrg,
  getMockNotificationsForOrg,
  getMockControllerConfigsForOrg,
  getMockLocationMappingsForOrg,
  getMockKeyboardMappingsForOrg,
} from "../mocks/organization";
import type { SimulationNodeDatum, SimulationLinkDatum } from "d3-force";
import "./CommandHQ.css";

/** Node shape used by d3-force in BubbleView (id required for forceLink; x, y set by simulation). */
interface CommandHQSimNode extends SimulationNodeDatum {
  id: string;
  type: string;
  r: number;
  label: string;
  sub: string;
  color: string;
  glow: string;
}

/** Link shape for BubbleView; source/target may be string (before sim) or CommandHQSimNode (after). */
interface CommandHQLink extends SimulationLinkDatum<CommandHQSimNode> {
  status: string;
}

const TABS: { id: CommandHQTab; label: string; icon: typeof faSatelliteDish }[] = [
  { id: "overview", label: "Overview", icon: faSatelliteDish },
  { id: "members", label: "Members", icon: faUsers },
  { id: "robots", label: "Robots", icon: faRobot },
  { id: "sessions", label: "Sessions & Logs", icon: faHistory },
  { id: "customizations", label: "Customizations", icon: faSlidersH },
  { id: "denylist", label: "Deny List", icon: faBan },
  { id: "notifications", label: "Notifications", icon: faBell },
];

export const CommandHQ = () => {
  usePageTitle();
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStatus();

  const [activeTab, setActiveTab] = useState<CommandHQTab>("overview");
  const [org, setOrg] = useState<Organization | null>(null);
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [robots, setRobots] = useState<OrgRobot[]>([]);
  const [sessions, setSessions] = useState<OrgSession[]>([]);
  const [logs, setLogs] = useState<OrgLog[]>([]);
  const [commands, setCommands] = useState<RosCommand[]>([]);
  const [controllerConfigs, setControllerConfigs] = useState<ControllerConfig[]>([]);
  const [locationMappings, setLocationMappings] = useState<LocationMapping[]>([]);
  const [keyboardMappings, setKeyboardMappings] = useState<KeyboardMapping[]>([]);
  const [denyList, setDenyList] = useState<DenyListEntry[]>([]);
  const [notifRules, setNotifRules] = useState<NotificationRule[]>([]);
  const [notifications, setNotifications] = useState<OrgNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    const mockOrg = getMockOrgById(orgId);
    if (mockOrg) {
      setOrg(mockOrg);
      setRoles(getMockRolesForOrg(orgId));
      setMembers(getMockMembersForOrg(orgId));
      setInvites(getMockInvitesForOrg(orgId));
      setRobots(getMockRobotsForOrg(orgId));
      setSessions(getMockSessionsForOrg(orgId));
      setLogs(getMockLogsForOrg(orgId));
      setCommands(getMockRosCommandsForOrg(orgId));
      setControllerConfigs(getMockControllerConfigsForOrg(orgId));
      setLocationMappings(getMockLocationMappingsForOrg(orgId));
      setKeyboardMappings(getMockKeyboardMappingsForOrg(orgId));
      setDenyList(getMockDenyListForOrg(orgId));
      setNotifRules(getMockNotificationRulesForOrg(orgId));
      setNotifications(getMockNotificationsForOrg(orgId));
    }
    setLoading(false);
  }, [orgId]);

  const currentMember = members.find((m) => m.userId === user?.username) || members[0];
  const currentRole = roles.find((r) => r.id === currentMember?.roleId);
  const hasPermission = (perm: string) => {
    if (!currentRole) return false;
    return currentRole.permissions.includes("*") || currentRole.permissions.includes(perm);
  };

  if (loading) {
    return (
      <div className="chq-page">
        <div className="chq-center">
          <FontAwesomeIcon icon={faSatelliteDish} spin className="chq-spin-icon" />
          <p className="chq-muted">Loading Command HQ...</p>
        </div>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="chq-page">
        <div className="chq-center">
          <h2>Organization not found</h2>
          <p className="chq-muted">This organization doesn't exist or you don't have access.</p>
          <button onClick={() => navigate("/")} className="chq-btn chq-btn-outline">
            <FontAwesomeIcon icon={faArrowLeft} /> Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const orgInitial = org.name.charAt(0).toUpperCase();

  return (
    <div className="chq-page">
      <header className="chq-header">
        <button onClick={() => navigate("/")} className="chq-back" title="Back to Dashboard">
          <FontAwesomeIcon icon={faArrowLeft} />
        </button>
        <div className="chq-org-avatar">{orgInitial}</div>
        <div className="chq-header-info">
          <div className="chq-header-row">
            <h1>Command HQ</h1>
            <span className="chq-slug">/{org.slug}</span>
            <span className={`chq-badge chq-badge--${org.status}`}>{org.status}</span>
            {currentRole && (
              <span className="chq-badge chq-badge--role">
                {currentRole.priority === 0 && <FontAwesomeIcon icon={faCrown} />}
                {currentRole.name}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="chq-layout">
        <nav className="chq-sidebar">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`chq-nav ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <FontAwesomeIcon icon={tab.icon} className="chq-nav-icon" />
              <span className="chq-nav-label">{tab.label}</span>
              {activeTab === tab.id && <FontAwesomeIcon icon={faChevronRight} className="chq-nav-chevron" />}
            </button>
          ))}
        </nav>

        <main className="chq-main">
          {activeTab === "overview" && <OverviewTab org={org} members={members} roles={roles} invites={invites} />}
          {activeTab === "members" && (
            <MembersTab members={members} invites={invites} roles={roles} robots={robots} org={org} canManage={hasPermission("members:manage")} />
          )}
          {activeTab === "robots" && (
            <RobotsTab robots={robots} members={members} canManage={hasPermission("robots:manage")} />
          )}
          {activeTab === "sessions" && <SessionsTab sessions={sessions} logs={logs} />}
          {activeTab === "customizations" && (
            <CustomizationsTab
              commands={commands} robots={robots} roles={roles}
              controllerConfigs={controllerConfigs} locationMappings={locationMappings} keyboardMappings={keyboardMappings}
              canManage={hasPermission("commands:manage")} canExecute={hasPermission("commands:execute")}
            />
          )}
          {activeTab === "denylist" && (
            <DenyListTab entries={denyList} canManage={hasPermission("settings:manage")} />
          )}
          {activeTab === "notifications" && (
            <NotificationsTab rules={notifRules} notifications={notifications} roles={roles} members={members} canManage={hasPermission("notifications:manage")} />
          )}
        </main>
      </div>
    </div>
  );
};

function OverviewTab({
  org,
  members,
  roles,
  invites,
}: {
  org: Organization;
  members: OrgMember[];
  roles: OrgRole[];
  invites: OrgInvite[];
}) {
  const pendingInvites = invites.filter((i) => i.status === "pending").length;
  return (
    <section>
      <div className="chq-stats">
        <div className="chq-stat">
          <div className="chq-stat-icon"><FontAwesomeIcon icon={faUsers} /></div>
          <div><span className="chq-stat-val">{members.length}</span><span className="chq-stat-lbl">of {org.maxMembers} members</span></div>
        </div>
        <div className="chq-stat">
          <div className="chq-stat-icon"><FontAwesomeIcon icon={faRobot} /></div>
          <div><span className="chq-stat-val">{org.robotCount}</span><span className="chq-stat-lbl">robots</span></div>
        </div>
        <div className="chq-stat">
          <div className="chq-stat-icon"><FontAwesomeIcon icon={faShieldAlt} /></div>
          <div><span className="chq-stat-val">{roles.length}</span><span className="chq-stat-lbl">roles</span></div>
        </div>
        <div className="chq-stat">
          <div className="chq-stat-icon"><FontAwesomeIcon icon={faUserPlus} /></div>
          <div><span className="chq-stat-val">{pendingInvites}</span><span className="chq-stat-lbl">pending invites</span></div>
        </div>
      </div>

      {org.description && (
        <div className="chq-panel">
          <div className="chq-panel-label">About</div>
          <p className="chq-panel-body">{org.description}</p>
        </div>
      )}

      <div className="chq-cols">
        <div className="chq-panel">
          <div className="chq-panel-head">
            <span>Members</span>
            <span className="chq-count">{members.length}</span>
          </div>
          {members.map((m) => (
            <div key={m.id} className="chq-row">
              <div className="chq-avatar-sm">{(m.userEmail || m.userId).charAt(0).toUpperCase()}</div>
              <div className="chq-row-text">
                <span className="chq-row-primary">{m.userEmail || m.userId}</span>
                <span className="chq-row-secondary">{m.roleName}</span>
              </div>
              <FontAwesomeIcon icon={faCircle} className={`chq-dot chq-dot--${m.status}`} />
            </div>
          ))}
        </div>

        <div className="chq-panel">
          <div className="chq-panel-head">
            <span>Roles</span>
            <span className="chq-count">{roles.length}</span>
          </div>
          {[...roles].sort((a, b) => a.priority - b.priority).map((r) => (
            <div key={r.id} className="chq-row">
              <div className={`chq-role-dot chq-priority-${r.priority}`} />
              <div className="chq-row-text">
                <span className="chq-row-primary">{r.name}</span>
                <span className="chq-row-secondary">
                  {r.permissions.includes("*") ? "Full access" : `${r.permissions.length} permissions`}
                </span>
              </div>
              {r.isSystem && <span className="chq-micro-tag">System</span>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MembersTab({
  members,
  invites,
  roles,
  robots,
  org,
  canManage,
}: {
  members: OrgMember[];
  invites: OrgInvite[];
  roles: OrgRole[];
  robots: OrgRobot[];
  org: Organization;
  canManage: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <section>
      <div className="chq-section-header">
        <div>
          <h2>Members</h2>
          <p className="chq-subtitle">{members.length} of {org.maxMembers} members</p>
        </div>
        {canManage && (
          <button className="chq-btn chq-btn-primary">
            <FontAwesomeIcon icon={faUserPlus} /> Invite Member
          </button>
        )}
      </div>

      <div className="chq-panel">
        <table className="chq-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
              {canManage && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const role = roles.find((r) => r.id === m.roleId);
              const isOwner = role?.priority === 0;
              const isOpen = expandedId === m.id;
              return (
                <Fragment key={m.id}>
                  <tr className={`chq-tr ${isOpen ? "chq-tr--open" : ""}`} onClick={() => toggleExpand(m.id)}>
                    <td>
                      <div className="chq-cell-user">
                        <div className="chq-avatar-sm">{(m.userEmail || m.userId).charAt(0).toUpperCase()}</div>
                        <span>{m.userEmail || m.userId}</span>
                      </div>
                    </td>
                    <td><span className={`chq-role-badge chq-priority-${role?.priority ?? 3}`}>{m.roleName}</span></td>
                    <td>
                      <span className={`chq-status chq-status--${m.status}`}>
                        <FontAwesomeIcon icon={faCircle} /> {m.status}
                      </span>
                    </td>
                    <td className="chq-dimmed">{new Date(m.joinedAt).toLocaleDateString()}</td>
                    {canManage && (
                      <td>
                        {!isOwner && (
                          <button className="chq-btn chq-btn-outline chq-btn-sm" onClick={(e) => e.stopPropagation()}>
                            Change Role
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  {isOpen && role && (() => {
                    const memberRobots = robots.filter((r) => r.assignedOperators.includes(m.userId));
                    return (
                      <tr className="chq-tr-expand">
                        <td colSpan={canManage ? 5 : 4}>
                          <div className="chq-expand-content">
                            <span className="chq-expand-label">Permissions:</span>
                            <div className="chq-perm-tags">
                              {role.permissions.includes("*") ? (
                                <span className="chq-perm wildcard">All Permissions</span>
                              ) : (
                                role.permissions.map((p) => (
                                  <span key={p} className="chq-perm">{PERMISSION_LABELS[p] || p}</span>
                                ))
                              )}
                            </div>
                          </div>
                          <div className="chq-expand-content" style={{ marginTop: "0.5rem" }}>
                            <span className="chq-expand-label">Robot Access:</span>
                            <div className="chq-perm-tags">
                              {memberRobots.length > 0 ? (
                                memberRobots.map((r) => (
                                  <span key={r.id} className={`chq-perm chq-perm--robot chq-perm--${r.connectionStatus}`}>
                                    <FontAwesomeIcon icon={faRobot} /> {r.name}
                                  </span>
                                ))
                              ) : (
                                <span className="chq-perm">No robots assigned</span>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {invites.length > 0 && (
        <>
          <h3 className="chq-section-label">Pending Invites</h3>
          <div className="chq-panel">
            <table className="chq-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id} className="chq-tr">
                    <td>{inv.email}</td>
                    <td><span className="chq-role-badge">{inv.roleName || roles.find((r) => r.id === inv.roleId)?.name}</span></td>
                    <td>
                      <span className={`chq-status chq-status--${inv.status}`}>
                        <FontAwesomeIcon icon={faCircle} /> {inv.status}
                      </span>
                    </td>
                    <td className="chq-dimmed">{new Date(inv.expiresAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

type RobotsLayout = "diagram" | "bubble" | "list";

function RobotsTab({
  robots,
  members,
  canManage,
}: {
  robots: OrgRobot[];
  members: OrgMember[];
  canManage: boolean;
}) {
  const [layout, setLayout] = useState<RobotsLayout>("diagram");
  const onlineCount = robots.filter((r) => r.connectionStatus === "online").length;
  const errorCount = robots.filter((r) => r.connectionStatus === "error").length;

  if (robots.length === 0) {
    return (
      <section>
        <div className="chq-center chq-center--compact">
          <div className="chq-placeholder-icon"><FontAwesomeIcon icon={faRobot} /></div>
          <h3>No robots yet</h3>
          <p className="chq-muted">Add your first robot to start managing your fleet.</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="chq-section-header">
        <div>
          <h2>Robots</h2>
          <p className="chq-subtitle">
            {onlineCount} online &middot; {robots.length} total
            {errorCount > 0 && <span className="chq-text-warn"> &middot; {errorCount} error</span>}
          </p>
        </div>
        {canManage && (
          <button className="chq-btn chq-btn-primary">
            <FontAwesomeIcon icon={faPlus} /> Add Robot
          </button>
        )}
      </div>

      <div className="chq-tab-toggle">
        <button className={`chq-toggle-btn ${layout === "diagram" ? "active" : ""}`} onClick={() => setLayout("diagram")}>
          <FontAwesomeIcon icon={faProjectDiagram} /> Diagram
        </button>
        <button className={`chq-toggle-btn ${layout === "bubble" ? "active" : ""}`} onClick={() => setLayout("bubble")}>
          <FontAwesomeIcon icon={faDotCircle} /> Bubble
        </button>
        <button className={`chq-toggle-btn ${layout === "list" ? "active" : ""}`} onClick={() => setLayout("list")}>
          <FontAwesomeIcon icon={faList} /> List
        </button>
      </div>

      {layout === "diagram" && <DiagramView robots={robots} members={members} />}
      {layout === "bubble" && <BubbleView robots={robots} members={members} />}
      {layout === "list" && <ListView robots={robots} members={members} />}
    </section>
  );
}

function DiagramView({ robots, members }: { robots: OrgRobot[]; members: OrgMember[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number; status: string }[]>([]);

  const calculateLines = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const result: typeof lines = [];

    const memberConns = new Map<string, string[]>();
    const robotConns = new Map<string, string[]>();
    robots.forEach((r) => {
      r.assignedOperators.forEach((opId) => {
        memberConns.set(opId, [...(memberConns.get(opId) || []), r.id]);
        robotConns.set(r.id, [...(robotConns.get(r.id) || []), opId]);
      });
    });

    robots.forEach((robot) => {
      const robotEl = el.querySelector(`[data-robot="${robot.id}"]`);
      if (!robotEl) return;
      const rRect = robotEl.getBoundingClientRect();
      const rConns = robotConns.get(robot.id) || [];

      robot.assignedOperators.forEach((opId) => {
        const memberEl = el.querySelector(`[data-member="${opId}"]`);
        if (!memberEl) return;
        const mRect = memberEl.getBoundingClientRect();
        const mConns = memberConns.get(opId) || [];
        const mIdx = mConns.indexOf(robot.id);
        const rIdx = rConns.indexOf(opId);

        result.push({
          x1: mRect.right - box.left,
          y1: mRect.top - box.top + mRect.height * ((mIdx + 1) / (mConns.length + 1)),
          x2: rRect.left - box.left,
          y2: rRect.top - box.top + rRect.height * ((rIdx + 1) / (rConns.length + 1)),
          status: robot.connectionStatus,
        });
      });
    });

    setLines(result);
  }, [robots]);

  useEffect(() => {
    const timer = setTimeout(calculateLines, 60);
    const observer = new ResizeObserver(calculateLines);
    if (containerRef.current) observer.observe(containerRef.current);
    window.addEventListener("resize", calculateLines);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("resize", calculateLines);
    };
  }, [calculateLines]);

  return (
    <>
      <div className="chq-diagram" ref={containerRef}>
        <svg className="chq-diagram-svg">
          {lines.map((l, i) => {
            const dx = l.x2 - l.x1;
            return (
              <g key={i}>
                <path
                  d={`M ${l.x1} ${l.y1} C ${l.x1 + dx * 0.4} ${l.y1}, ${l.x2 - dx * 0.4} ${l.y2}, ${l.x2} ${l.y2}`}
                  className={`chq-line chq-line--${l.status}`}
                />
                <circle cx={l.x1} cy={l.y1} r={3.5} className={`chq-dot-end chq-dot-end--${l.status}`} />
                <circle cx={l.x2} cy={l.y2} r={3.5} className={`chq-dot-end chq-dot-end--${l.status}`} />
              </g>
            );
          })}
        </svg>
        <div className="chq-diagram-col">
          <div className="chq-diagram-label">Operators</div>
          {members.map((m) => {
            const hasRobot = robots.some((r) => r.assignedOperators.includes(m.userId));
            return (
              <div key={m.id} className={`chq-diagram-node ${!hasRobot ? "chq-diagram-node--dim" : ""}`} data-member={m.userId}>
                <div className="chq-avatar-sm">{(m.userEmail || m.userId).charAt(0).toUpperCase()}</div>
                <div className="chq-row-text">
                  <span className="chq-row-primary">{m.userEmail || m.userId}</span>
                  <span className="chq-row-secondary">{m.roleName}</span>
                </div>
                <FontAwesomeIcon icon={faCircle} className={`chq-dot chq-dot--${m.status}`} />
              </div>
            );
          })}
        </div>
        <div className="chq-diagram-col">
          <div className="chq-diagram-label">Fleet</div>
          {robots.map((r) => (
            <div key={r.id} className={`chq-diagram-node chq-diagram-node--robot ${r.assignedOperators.length === 0 ? "chq-diagram-node--unassigned" : ""}`} data-robot={r.id}>
              <div className={`chq-robot-icon-sm chq-robot-icon-sm--${r.connectionStatus}`}>
                <FontAwesomeIcon icon={faRobot} />
              </div>
              <div className="chq-row-text">
                <span className="chq-row-primary">{r.name}</span>
                <span className="chq-row-secondary">{r.model} &middot; {r.robotType}</span>
              </div>
              <span className={`chq-conn chq-conn--${r.connectionStatus}`}>
                <FontAwesomeIcon icon={r.connectionStatus === "error" ? faExclamationTriangle : faWifi} />
                {r.connectionStatus}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="chq-diagram-legend">
        <span className="chq-legend-item"><span className="chq-legend-line chq-legend-line--online" /> Online</span>
        <span className="chq-legend-item"><span className="chq-legend-line chq-legend-line--offline" /> Offline</span>
        <span className="chq-legend-item"><span className="chq-legend-line chq-legend-line--error" /> Error</span>
        <span className="chq-legend-item"><span className="chq-legend-dot" /> Unassigned</span>
      </div>
    </>
  );
}

function BubbleView({ robots, members }: { robots: OrgRobot[]; members: OrgMember[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [nodes, setNodes] = useState<{ id: string; type: string; x: number; y: number; r: number; label: string; sub: string; color: string; glow: string }[]>([]);
  const [links, setLinks] = useState<{ x1: number; y1: number; x2: number; y2: number; status: string; source: string; target: string }[]>([]);

  useEffect(() => {
    import("d3-force").then(({ forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide }) => {
      const WIDTH = 700;
      const HEIGHT = 500;

      const roleColors: Record<number, string> = { 0: "#ffc107", 1: "#60a5fa", 2: "#34d399", 3: "rgba(255,255,255,0.35)" };
      const statusColors: Record<string, string> = { online: "#4ade80", offline: "rgba(255,255,255,0.25)", error: "#f87171" };
      const statusGlow: Record<string, string> = { online: "rgba(74,222,128,0.15)", offline: "rgba(255,255,255,0.04)", error: "rgba(248,113,113,0.12)" };

      const simNodes: CommandHQSimNode[] = [];
      const simLinks: CommandHQLink[] = [];

      members.forEach((m) => {
        const robotCount = robots.filter((r) => r.assignedOperators.includes(m.userId)).length;
        const r = Math.max(20, 14 + robotCount * 8);
        const role = parseInt(Object.keys(roleColors).find((k) => m.roleName?.toLowerCase().includes(["owner", "admin", "operator", "viewer"][Number(k)]) ? true : false) || "3");
        simNodes.push({
          id: `m-${m.userId}`,
          type: "member",
          r,
          label: (m.userEmail || m.userId).split("@")[0],
          sub: m.roleName || "",
          color: roleColors[role] || roleColors[3],
          glow: "rgba(255,255,255,0.06)",
        });
      });

      robots.forEach((robot) => {
        const r = Math.max(18, 12 + Math.sqrt(robot.totalSessions) * 3);
        simNodes.push({
          id: `r-${robot.id}`,
          type: "robot",
          r,
          label: robot.name,
          sub: robot.model,
          color: statusColors[robot.connectionStatus] || statusColors.offline,
          glow: statusGlow[robot.connectionStatus] || statusGlow.offline,
        });

        robot.assignedOperators.forEach((opId) => {
          simLinks.push({ source: `m-${opId}`, target: `r-${robot.id}`, status: robot.connectionStatus });
        });
      });

      const sim = forceSimulation<CommandHQSimNode>(simNodes)
        .force("link", forceLink<CommandHQSimNode, CommandHQLink>(simLinks).id((d) => d.id).distance(80).strength(0.6))
        .force("charge", forceManyBody<CommandHQSimNode>().strength(-200))
        .force("center", forceCenter<CommandHQSimNode>(WIDTH / 2, HEIGHT / 2))
        .force("collide", forceCollide<CommandHQSimNode>().radius((d) => d.r + 6).strength(0.8));

      sim.tick(200);
      sim.stop();

      const finalNodes = simNodes.map((n) => ({
        id: n.id,
        type: n.type,
        x: n.x ?? 0,
        y: n.y ?? 0,
        r: n.r,
        label: n.label,
        sub: n.sub,
        color: n.color,
        glow: n.glow,
      }));

      const nodeMap = new Map(finalNodes.map((n) => [n.id, n]));
      const getNodeId = (src: CommandHQSimNode | string | number): string =>
        typeof src === "object" ? src.id : String(src);
      const finalLinks = simLinks.map((l) => {
        const s = nodeMap.get(getNodeId(l.source));
        const t = nodeMap.get(getNodeId(l.target));
        return {
          x1: s?.x ?? 0, y1: s?.y ?? 0,
          x2: t?.x ?? 0, y2: t?.y ?? 0,
          status: l.status,
          source: s?.id ?? "",
          target: t?.id ?? "",
        };
      });

      setNodes(finalNodes);
      setLinks(finalLinks);
    });
  }, [robots, members]);

  const isConnected = (nodeId: string) => {
    if (!hoveredNode) return true;
    if (nodeId === hoveredNode) return true;
    return links.some((l) => (l.source === hoveredNode && l.target === nodeId) || (l.target === hoveredNode && l.source === nodeId));
  };

  const isLinkConnected = (l: { source: string; target: string }) => {
    if (!hoveredNode) return true;
    return l.source === hoveredNode || l.target === hoveredNode;
  };

  return (
    <>
      <svg ref={svgRef} className="chq-bubble-svg" viewBox="0 0 700 500" preserveAspectRatio="xMidYMid meet">
        {links.map((l, i) => (
          <line
            key={i}
            x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            className={`chq-bubble-link chq-bubble-link--${l.status}`}
            style={{ opacity: isLinkConnected(l) ? 1 : 0.08 }}
          />
        ))}
        {nodes.map((n) => {
          const connected = isConnected(n.id);
          return (
            <g
              key={n.id}
              className="chq-bubble-node"
              style={{ opacity: connected ? 1 : 0.15 }}
              onMouseEnter={() => setHoveredNode(n.id)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              <circle cx={n.x} cy={n.y} r={n.r + 4} fill={n.glow} />
              <circle cx={n.x} cy={n.y} r={n.r} fill="rgba(15,15,20,0.85)" stroke={n.color} strokeWidth={2} />
              {n.type === "robot" && (
                <text x={n.x} y={n.y + 1} textAnchor="middle" dominantBaseline="middle" fill={n.color} fontSize={n.r * 0.55} className="chq-bubble-icon">
                  &#xf544;
                </text>
              )}
              {n.type === "member" && (
                <text x={n.x} y={n.y + 1} textAnchor="middle" dominantBaseline="middle" fill={n.color} fontSize={n.r * 0.6} fontWeight="700" className="chq-bubble-initial">
                  {n.label.charAt(0).toUpperCase()}
                </text>
              )}
              <text x={n.x} y={n.y + n.r + 14} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="11" fontWeight="600" className="chq-bubble-label">
                {n.label}
              </text>
              <text x={n.x} y={n.y + n.r + 26} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="9" className="chq-bubble-sub">
                {n.sub}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="chq-diagram-legend">
        <span className="chq-legend-item"><span className="chq-legend-line chq-legend-line--online" /> Online</span>
        <span className="chq-legend-item"><span className="chq-legend-line chq-legend-line--offline" /> Offline</span>
        <span className="chq-legend-item"><span className="chq-legend-line chq-legend-line--error" /> Error</span>
      </div>
    </>
  );
}

function ListView({ robots, members }: { robots: OrgRobot[]; members: OrgMember[] }) {
  const getOperatorNames = (ops: string[]) =>
    ops.map((id) => members.find((m) => m.userId === id)?.userEmail?.split("@")[0] || id).join(", ");

  return (
    <div className="chq-panel">
      <table className="chq-table">
        <thead>
          <tr>
            <th>Robot</th>
            <th>Model</th>
            <th>Type</th>
            <th>Status</th>
            <th>Operators</th>
            <th>Sessions</th>
            <th>Hours</th>
          </tr>
        </thead>
        <tbody>
          {robots.map((r) => (
            <tr key={r.id} className="chq-tr">
              <td>
                <div className="chq-cell-user">
                  <div className={`chq-robot-icon-sm chq-robot-icon-sm--${r.connectionStatus}`}>
                    <FontAwesomeIcon icon={faRobot} />
                  </div>
                  <span>{r.name}</span>
                </div>
              </td>
              <td className="chq-dimmed">{r.model}</td>
              <td className="chq-dimmed">{r.robotType}</td>
              <td>
                <span className={`chq-conn chq-conn--${r.connectionStatus}`}>
                  <FontAwesomeIcon icon={r.connectionStatus === "error" ? faExclamationTriangle : faWifi} />
                  {r.connectionStatus}
                </span>
              </td>
              <td className="chq-dimmed">{r.assignedOperators.length > 0 ? getOperatorNames(r.assignedOperators) : "—"}</td>
              <td>{r.totalSessions}</td>
              <td className="chq-dimmed">{r.totalHours}h</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionsTab({ sessions, logs }: { sessions: OrgSession[]; logs: OrgLog[] }) {
  const [view, setView] = useState<"sessions" | "logs">("sessions");

  const activeSessions = sessions.filter((s) => s.status === "active").length;
  const totalCredits = sessions.reduce((sum, s) => sum + (s.creditsUsed || 0), 0);
  const errorLogs = logs.filter((l) => l.level === "error").length;

  const formatDuration = (mins: number | null) => {
    if (mins === null) return "In progress";
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const sessionIcon = (status: string) => {
    switch (status) {
      case "active": return faPlay;
      case "completed": return faCheck;
      case "failed": return faExclamationTriangle;
      case "terminated": return faTimesCircle;
      default: return faCircle;
    }
  };

  return (
    <section>
      <div className="chq-section-header">
        <div>
          <h2>Sessions & Logs</h2>
          <p className="chq-subtitle">
            {activeSessions > 0 && <><span className="chq-text-live">{activeSessions} live</span> &middot; </>}
            {sessions.length} total sessions &middot; {totalCredits} credits used
            {errorLogs > 0 && <span className="chq-text-warn"> &middot; {errorLogs} errors</span>}
          </p>
        </div>
        <button className="chq-btn chq-btn-outline">
          <FontAwesomeIcon icon={faDownload} /> Export
        </button>
      </div>

      <div className="chq-tab-toggle">
        <button
          className={`chq-toggle-btn ${view === "sessions" ? "active" : ""}`}
          onClick={() => setView("sessions")}
        >
          <FontAwesomeIcon icon={faHistory} /> Sessions
        </button>
        <button
          className={`chq-toggle-btn ${view === "logs" ? "active" : ""}`}
          onClick={() => setView("logs")}
        >
          <FontAwesomeIcon icon={faTerminal} /> Logs
          {errorLogs > 0 && <span className="chq-toggle-badge">{errorLogs}</span>}
        </button>
      </div>

      {view === "sessions" && (
        <div className="chq-panel">
          <table className="chq-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Robot</th>
                <th>Operator</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Credits</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="chq-tr">
                  <td>
                    <span className={`chq-session-status chq-session-status--${s.status}`}>
                      <FontAwesomeIcon icon={sessionIcon(s.status)} />
                      {s.status}
                    </span>
                  </td>
                  <td>
                    <span className="chq-row-primary">{s.robotName}</span>
                  </td>
                  <td className="chq-dimmed">{s.operatorEmail}</td>
                  <td className="chq-dimmed">{formatTime(s.startedAt)}</td>
                  <td>
                    <span className={s.status === "active" ? "chq-text-live" : ""}>
                      {formatDuration(s.durationMinutes)}
                    </span>
                  </td>
                  <td className="chq-dimmed">{s.creditsUsed ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "logs" && (
        <div className="chq-logs">
          {logs.map((log) => (
            <div key={log.id} className={`chq-log-entry chq-log-entry--${log.level}`}>
              <div className="chq-log-left">
                <span className={`chq-log-level chq-log-level--${log.level}`}>{log.level}</span>
                <span className="chq-log-time">{formatTime(log.timestamp)}</span>
              </div>
              <div className="chq-log-body">
                <span className="chq-log-msg">{log.message}</span>
                <div className="chq-log-meta">
                  <span className="chq-micro-tag">{log.robotName}</span>
                  <span className="chq-micro-tag">{log.source}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const CUSTOM_SUBTABS: { id: CustomizationSubTab; label: string; icon: typeof faTerminal }[] = [
  { id: 'ros-commands', label: 'ROS Commands', icon: faTerminal },
  { id: 'controller', label: 'Controller', icon: faGamepad },
  { id: 'locations', label: 'Locations', icon: faMapMarkedAlt },
  { id: 'keyboard', label: 'Keyboard', icon: faKeyboard },
];

function CustomizationsTab({
  commands, robots, roles, controllerConfigs, locationMappings, keyboardMappings, canManage, canExecute,
}: {
  commands: RosCommand[];
  robots: OrgRobot[];
  roles: OrgRole[];
  controllerConfigs: ControllerConfig[];
  locationMappings: LocationMapping[];
  keyboardMappings: KeyboardMapping[];
  canManage: boolean;
  canExecute: boolean;
}) {
  const [subTab, setSubTab] = useState<CustomizationSubTab>('ros-commands');

  return (
    <section>
      <div className="chq-section-header">
        <div>
          <h2>Customizations</h2>
          <p className="chq-subtitle">Configure commands, controllers, locations, and keyboard bindings</p>
        </div>
      </div>

      <div className="chq-custom-subtabs">
        {CUSTOM_SUBTABS.map((st) => (
          <button
            key={st.id}
            className={`chq-custom-subtab ${subTab === st.id ? 'active' : ''}`}
            onClick={() => setSubTab(st.id)}
          >
            <FontAwesomeIcon icon={st.icon} />
            <span>{st.label}</span>
          </button>
        ))}
      </div>

      {subTab === 'ros-commands' && (
        <RosCommandsSubTab commands={commands} robots={robots} roles={roles} canManage={canManage} canExecute={canExecute} />
      )}
      {subTab === 'controller' && (
        <ControllerConfigSubTab configs={controllerConfigs} robots={robots} canManage={canManage} />
      )}
      {subTab === 'locations' && (
        <LocationMappingSubTab locations={locationMappings} robots={robots} canManage={canManage} />
      )}
      {subTab === 'keyboard' && (
        <KeyboardMappingSubTab mappings={keyboardMappings} robots={robots} canManage={canManage} />
      )}
    </section>
  );
}

function ControllerConfigSubTab({ configs, robots, canManage }: { configs: ControllerConfig[]; robots: OrgRobot[]; canManage: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const TYPE_ICONS: Record<string, typeof faGamepad> = { gamepad: faGamepad, joystick: faArrowsAlt, custom: faCog };

  return (
    <div className="chq-custom-section">
      <div className="chq-custom-section-bar">
        <span className="chq-custom-section-count">{configs.length} configurations</span>
        {canManage && (
          <button className="chq-btn chq-btn-primary chq-btn-sm"><FontAwesomeIcon icon={faPlus} /> New Config</button>
        )}
      </div>

      <div className="chq-cmd-grid">
        {configs.map((cfg) => {
          const isOpen = expandedId === cfg.id;
          return (
            <div key={cfg.id} className={`chq-cmd-card ${isOpen ? 'chq-cmd-card--open' : ''}`}>
              <div className="chq-cmd-card-header" onClick={() => setExpandedId(isOpen ? null : cfg.id)}>
                <div className="chq-cmd-icon-wrap">
                  <FontAwesomeIcon icon={TYPE_ICONS[cfg.controllerType] || faGamepad} className="chq-cmd-cat-icon chq-cmd-cat--motion" />
                </div>
                <div className="chq-cmd-card-info">
                  <div className="chq-cmd-card-title">
                    <span className="chq-cmd-name">{cfg.name}</span>
                    {cfg.isDefault && <span className="chq-cmd-badge chq-cmd-badge--default">Default</span>}
                  </div>
                  <span className="chq-cmd-topic"><FontAwesomeIcon icon={faGamepad} /> {cfg.controllerType}</span>
                </div>
                <div className="chq-cmd-card-meta">
                  <span className="chq-cmd-meta-stat" title="Axes"><FontAwesomeIcon icon={faArrowsAlt} /> {Object.keys(cfg.axisMapping).length}</span>
                  <span className="chq-cmd-meta-stat" title="Buttons"><FontAwesomeIcon icon={faCrosshairs} /> {Object.keys(cfg.buttonMapping).length}</span>
                </div>
              </div>

              {isOpen && (
                <div className="chq-cmd-card-body">
                  {cfg.description && <p className="chq-cmd-desc">{cfg.description}</p>}

                  <div className="chq-cmd-detail-grid">
                    <div className="chq-cmd-detail">
                      <span className="chq-cmd-detail-label">Deadzone</span>
                      <span className="chq-cmd-detail-value chq-cmd-mono">{cfg.deadzone}</span>
                    </div>
                    <div className="chq-cmd-detail">
                      <span className="chq-cmd-detail-label">Sensitivity</span>
                      <span className="chq-cmd-detail-value chq-cmd-mono">{cfg.sensitivity}</span>
                    </div>
                  </div>

                  <div className="chq-custom-mapping-group">
                    <span className="chq-cmd-detail-label">Axis Mapping</span>
                    <div className="chq-custom-mapping-grid">
                      {Object.entries(cfg.axisMapping).map(([input, topic]) => (
                        <div key={input} className="chq-custom-mapping-row">
                          <span className="chq-custom-key">{input}</span>
                          <FontAwesomeIcon icon={faChevronRight} className="chq-custom-arrow" />
                          <span className="chq-custom-value">{topic}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="chq-custom-mapping-group">
                    <span className="chq-cmd-detail-label">Button Mapping</span>
                    <div className="chq-custom-mapping-grid">
                      {Object.entries(cfg.buttonMapping).map(([input, topic]) => (
                        <div key={input} className="chq-custom-mapping-row">
                          <span className="chq-custom-key">{input}</span>
                          <FontAwesomeIcon icon={faChevronRight} className="chq-custom-arrow" />
                          <span className="chq-custom-value">{topic}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="chq-cmd-tags-section">
                    <div className="chq-cmd-tag-group">
                      <span className="chq-cmd-detail-label">Target Robots</span>
                      <div className="chq-cmd-tags">
                        {cfg.targetRobotIds.map((rid) => (
                          <span key={rid} className="chq-cmd-tag chq-cmd-tag--robot">
                            <FontAwesomeIcon icon={faRobot} /> {robots.find((r) => r.id === rid)?.name || rid}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {canManage && (
                    <div className="chq-cmd-actions">
                      <button className="chq-btn chq-btn-outline chq-btn-sm"><FontAwesomeIcon icon={faPen} /> Edit</button>
                      <button className="chq-btn chq-btn-outline chq-btn-sm chq-btn-danger"><FontAwesomeIcon icon={faWrench} /> Delete</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LocationMappingSubTab({ locations, robots, canManage }: { locations: LocationMapping[]; robots: OrgRobot[]; canManage: boolean }) {
  const [showInactive, setShowInactive] = useState(false);
  const filtered = showInactive ? locations : locations.filter((l) => l.isActive);
  const activeCount = locations.filter((l) => l.isActive).length;
  const zones = [...new Set(locations.map((l) => l.zone).filter(Boolean))];

  return (
    <div className="chq-custom-section">
      <div className="chq-custom-section-bar">
        <span className="chq-custom-section-count">{activeCount} active locations &middot; {locations.length} total</span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className={`chq-btn chq-btn-outline chq-btn-sm ${showInactive ? 'active' : ''}`} onClick={() => setShowInactive(!showInactive)}>
            <FontAwesomeIcon icon={showInactive ? faEye : faEyeSlash} /> {showInactive ? 'Showing All' : 'Active Only'}
          </button>
          {canManage && (
            <button className="chq-btn chq-btn-primary chq-btn-sm"><FontAwesomeIcon icon={faPlus} /> Add Location</button>
          )}
        </div>
      </div>

      {zones.length > 0 && (
        <div className="chq-custom-zone-chips">
          {zones.map((z) => (
            <span key={z} className="chq-custom-zone-chip"><FontAwesomeIcon icon={faMapMarkedAlt} /> {z}</span>
          ))}
        </div>
      )}

      <div className="chq-panel">
        <table className="chq-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Zone</th>
              <th>Pose (x, y, z)</th>
              <th>Assigned Robots</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((loc) => (
              <tr key={loc.id} className="chq-tr">
                <td>
                  <div className="chq-cell-user">
                    <div className="chq-avatar-sm" style={{ background: loc.isActive ? 'rgba(255,193,7,0.15)' : 'rgba(255,255,255,0.05)', color: loc.isActive ? '#ffc107' : 'rgba(255,255,255,0.3)' }}>
                      <FontAwesomeIcon icon={faCrosshairs} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{loc.productName || loc.label}</div>
                      <div className="chq-dimmed" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <FontAwesomeIcon icon={faBarcode} style={{ fontSize: '0.65rem' }} />
                        {loc.productId || loc.name}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="chq-dimmed">{loc.zone || '—'}</span>
                </td>
                <td className="chq-cmd-mono" style={{ fontSize: '0.82rem' }}>
                  ({loc.coordinates.x.toFixed(2)}, {loc.coordinates.y.toFixed(2)}, {loc.coordinates.z.toFixed(2)})
                </td>
                <td>
                  <div className="chq-cmd-tags" style={{ gap: '0.25rem' }}>
                    {loc.targetRobotIds.map((rid) => (
                      <span key={rid} className="chq-cmd-tag chq-cmd-tag--robot" style={{ fontSize: '0.72rem' }}>
                        <FontAwesomeIcon icon={faRobot} /> {robots.find((r) => r.id === rid)?.name || rid}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className={`chq-status chq-status--${loc.isActive ? 'active' : 'inactive'}`}>
                    <FontAwesomeIcon icon={faCircle} /> {loc.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KeyboardMappingSubTab({ mappings, robots, canManage }: { mappings: KeyboardMapping[]; robots: OrgRobot[]; canManage: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="chq-custom-section">
      <div className="chq-custom-section-bar">
        <span className="chq-custom-section-count">{mappings.length} keyboard layouts</span>
        {canManage && (
          <button className="chq-btn chq-btn-primary chq-btn-sm"><FontAwesomeIcon icon={faPlus} /> New Layout</button>
        )}
      </div>

      <div className="chq-cmd-grid">
        {mappings.map((km) => {
          const isOpen = expandedId === km.id;
          return (
            <div key={km.id} className={`chq-cmd-card ${isOpen ? 'chq-cmd-card--open' : ''}`}>
              <div className="chq-cmd-card-header" onClick={() => setExpandedId(isOpen ? null : km.id)}>
                <div className="chq-cmd-icon-wrap">
                  <FontAwesomeIcon icon={faKeyboard} className="chq-cmd-cat-icon chq-cmd-cat--system" />
                </div>
                <div className="chq-cmd-card-info">
                  <div className="chq-cmd-card-title">
                    <span className="chq-cmd-name">{km.name}</span>
                    {km.isDefault && <span className="chq-cmd-badge chq-cmd-badge--default">Default</span>}
                  </div>
                  <span className="chq-cmd-topic"><FontAwesomeIcon icon={faKeyboard} /> {Object.keys(km.bindings).length} bindings</span>
                </div>
                <div className="chq-cmd-card-meta">
                  <span className="chq-cmd-meta-stat" title="Modifiers"><FontAwesomeIcon icon={faCog} /> {Object.keys(km.modifiers).length} mod</span>
                </div>
              </div>

              {isOpen && (
                <div className="chq-cmd-card-body">
                  {km.description && <p className="chq-cmd-desc">{km.description}</p>}

                  <div className="chq-custom-mapping-group">
                    <span className="chq-cmd-detail-label">Key Bindings</span>
                    <div className="chq-custom-mapping-grid">
                      {Object.entries(km.bindings).map(([key, action]) => (
                        <div key={key} className="chq-custom-mapping-row">
                          <kbd className="chq-custom-kbd">{key}</kbd>
                          <FontAwesomeIcon icon={faChevronRight} className="chq-custom-arrow" />
                          <span className="chq-custom-value">{action}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {Object.keys(km.modifiers).length > 0 && (
                    <div className="chq-custom-mapping-group">
                      <span className="chq-cmd-detail-label">Modifiers</span>
                      <div className="chq-custom-mapping-grid">
                        {Object.entries(km.modifiers).map(([key, effect]) => (
                          <div key={key} className="chq-custom-mapping-row">
                            <kbd className="chq-custom-kbd chq-custom-kbd--mod">{key}</kbd>
                            <FontAwesomeIcon icon={faChevronRight} className="chq-custom-arrow" />
                            <span className="chq-custom-value">{effect}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="chq-cmd-tags-section">
                    <div className="chq-cmd-tag-group">
                      <span className="chq-cmd-detail-label">Target Robots</span>
                      <div className="chq-cmd-tags">
                        {km.targetRobotIds.map((rid) => (
                          <span key={rid} className="chq-cmd-tag chq-cmd-tag--robot">
                            <FontAwesomeIcon icon={faRobot} /> {robots.find((r) => r.id === rid)?.name || rid}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {canManage && (
                    <div className="chq-cmd-actions">
                      <button className="chq-btn chq-btn-outline chq-btn-sm"><FontAwesomeIcon icon={faPen} /> Edit</button>
                      <button className="chq-btn chq-btn-outline chq-btn-sm chq-btn-danger"><FontAwesomeIcon icon={faWrench} /> Delete</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CATEGORY_ICONS: Record<RosCommandCategory, typeof faTerminal> = {
  motion: faRunning,
  sensor: faThermometerHalf,
  system: faCog,
  custom: faCode,
};

function RosCommandsSubTab({
  commands,
  robots,
  roles,
  canManage,
  canExecute,
}: {
  commands: RosCommand[];
  robots: OrgRobot[];
  roles: OrgRole[];
  canManage: boolean;
  canExecute: boolean;
}) {
  const [filterCategory, setFilterCategory] = useState<RosCommandCategory | "all">("all");
  const [filterRobot, setFilterRobot] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = commands.filter((cmd) => {
    if (filterCategory !== "all" && cmd.category !== filterCategory) return false;
    if (filterRobot !== "all" && !cmd.targetRobotIds.includes(filterRobot)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return cmd.name.toLowerCase().includes(q) || cmd.rosTopic.toLowerCase().includes(q) || (cmd.description || "").toLowerCase().includes(q);
    }
    return true;
  });

  const enabledCount = commands.filter((c) => c.isEnabled).length;
  const totalExecutions = commands.reduce((sum, c) => sum + c.executionCount, 0);

  const handleCopyPayload = (cmd: RosCommand) => {
    navigator.clipboard.writeText(cmd.payloadTemplate);
    setCopiedId(cmd.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const getRobotName = (id: string) => robots.find((r) => r.id === id)?.name || id;
  const getRoleName = (id: string) => roles.find((r) => r.id === id)?.name || id;

  return (
    <div className="chq-custom-section">
      <div className="chq-custom-section-bar">
        <span className="chq-custom-section-count">{commands.length} commands &middot; {enabledCount} enabled &middot; {totalExecutions} total executions</span>
        {canManage && (
          <button className="chq-btn chq-btn-primary chq-btn-sm">
            <FontAwesomeIcon icon={faPlus} /> New Command
          </button>
        )}
      </div>

      <div className="chq-cmd-toolbar">
        <input
          className="chq-cmd-search"
          type="text"
          placeholder="Search commands, topics..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select className="chq-cmd-filter" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value as RosCommandCategory | "all")}>
          <option value="all">All Categories</option>
          {ROS_COMMAND_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        <select className="chq-cmd-filter" value={filterRobot} onChange={(e) => setFilterRobot(e.target.value)}>
          <option value="all">All Robots</option>
          {robots.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="chq-center chq-center--compact">
          <p className="chq-muted">No commands match your filters.</p>
        </div>
      ) : (
        <div className="chq-cmd-grid">
          {filtered.map((cmd) => {
            const isOpen = expandedId === cmd.id;
            return (
              <div key={cmd.id} className={`chq-cmd-card ${!cmd.isEnabled ? "chq-cmd-card--disabled" : ""} ${isOpen ? "chq-cmd-card--open" : ""}`}>
                <div className="chq-cmd-card-header" onClick={() => setExpandedId(isOpen ? null : cmd.id)}>
                  <div className="chq-cmd-icon-wrap">
                    <FontAwesomeIcon icon={CATEGORY_ICONS[cmd.category]} className={`chq-cmd-cat-icon chq-cmd-cat--${cmd.category}`} />
                  </div>
                  <div className="chq-cmd-card-info">
                    <div className="chq-cmd-card-title">
                      <span className="chq-cmd-name">{cmd.name}</span>
                      {!cmd.isEnabled && <span className="chq-cmd-badge chq-cmd-badge--disabled">Disabled</span>}
                    </div>
                    <span className="chq-cmd-topic"><FontAwesomeIcon icon={faTerminal} /> {cmd.rosTopic}</span>
                  </div>
                  <div className="chq-cmd-card-meta">
                    <span className="chq-cmd-meta-stat" title="Executions"><FontAwesomeIcon icon={faPlay} /> {cmd.executionCount}</span>
                    {canManage && (
                      <button className="chq-cmd-toggle" title={cmd.isEnabled ? "Disable" : "Enable"} onClick={(e) => { e.stopPropagation(); }}>
                        <FontAwesomeIcon icon={cmd.isEnabled ? faToggleOn : faToggleOff} className={cmd.isEnabled ? "chq-cmd-on" : "chq-cmd-off"} />
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="chq-cmd-card-body">
                    {cmd.description && <p className="chq-cmd-desc">{cmd.description}</p>}

                    <div className="chq-cmd-detail-grid">
                      <div className="chq-cmd-detail">
                        <span className="chq-cmd-detail-label">Message Type</span>
                        <span className="chq-cmd-detail-value chq-cmd-mono">{cmd.messageType}</span>
                      </div>
                      <div className="chq-cmd-detail">
                        <span className="chq-cmd-detail-label">Category</span>
                        <span className="chq-cmd-detail-value">
                          <FontAwesomeIcon icon={CATEGORY_ICONS[cmd.category]} className={`chq-cmd-cat--${cmd.category}`} /> {ROS_COMMAND_CATEGORIES.find((c) => c.id === cmd.category)?.label}
                        </span>
                      </div>
                      <div className="chq-cmd-detail">
                        <span className="chq-cmd-detail-label">Last Executed</span>
                        <span className="chq-cmd-detail-value">{cmd.lastExecutedAt ? new Date(cmd.lastExecutedAt).toLocaleString() : "Never"}</span>
                      </div>
                      <div className="chq-cmd-detail">
                        <span className="chq-cmd-detail-label">Created</span>
                        <span className="chq-cmd-detail-value">{new Date(cmd.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="chq-cmd-payload-section">
                      <div className="chq-cmd-payload-header">
                        <span className="chq-cmd-detail-label">Payload Template</span>
                        <button className="chq-cmd-copy" onClick={() => handleCopyPayload(cmd)} title="Copy payload">
                          <FontAwesomeIcon icon={copiedId === cmd.id ? faCheck : faCopy} />
                          {copiedId === cmd.id ? " Copied" : " Copy"}
                        </button>
                      </div>
                      <pre className="chq-cmd-payload">{(() => {
                        try { return JSON.stringify(JSON.parse(cmd.payloadTemplate), null, 2); } catch { return cmd.payloadTemplate; }
                      })()}</pre>
                    </div>

                    <div className="chq-cmd-tags-section">
                      <div className="chq-cmd-tag-group">
                        <span className="chq-cmd-detail-label">Target Robots</span>
                        <div className="chq-cmd-tags">
                          {cmd.targetRobotIds.map((rid) => {
                            const robot = robots.find((r) => r.id === rid);
                            return (
                              <span key={rid} className={`chq-cmd-tag chq-cmd-tag--robot ${robot ? `chq-cmd-tag--${robot.connectionStatus}` : ""}`}>
                                <FontAwesomeIcon icon={faRobot} /> {getRobotName(rid)}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      <div className="chq-cmd-tag-group">
                        <span className="chq-cmd-detail-label">Allowed Roles</span>
                        <div className="chq-cmd-tags">
                          {cmd.allowedRoleIds.map((rid) => (
                            <span key={rid} className="chq-cmd-tag chq-cmd-tag--role">
                              <FontAwesomeIcon icon={faShieldAlt} /> {getRoleName(rid)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="chq-cmd-actions">
                      {canExecute && cmd.isEnabled && (
                        <button className="chq-btn chq-btn-primary chq-btn-sm">
                          <FontAwesomeIcon icon={faPlay} /> Execute
                        </button>
                      )}
                      {canManage && (
                        <>
                          <button className="chq-btn chq-btn-outline chq-btn-sm">
                            <FontAwesomeIcon icon={faPen} /> Edit
                          </button>
                          <button className="chq-btn chq-btn-outline chq-btn-sm chq-btn-danger">
                            <FontAwesomeIcon icon={faWrench} /> Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const DENY_SCOPE_ICONS: Record<DenyScope, typeof faBan> = {
  ip: faGlobe,
  user: faUser,
  device: faLaptop,
  region: faMapMarkerAlt,
};

function DenyListTab({
  entries,
  canManage,
}: {
  entries: DenyListEntry[];
  canManage: boolean;
}) {
  const [filterScope, setFilterScope] = useState<DenyScope | "all">("all");
  const [showInactive, setShowInactive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = entries.filter((e) => {
    if (filterScope !== "all" && e.scope !== filterScope) return false;
    if (!showInactive && !e.isActive) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return e.value.toLowerCase().includes(q) || (e.description || "").toLowerCase().includes(q);
    }
    return true;
  });

  const activeCount = entries.filter((e) => e.isActive).length;
  const scopeCounts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.scope] = (acc[e.scope] || 0) + 1;
    return acc;
  }, {});

  return (
    <section>
      <div className="chq-section-header">
        <div>
          <h2>Deny List</h2>
          <p className="chq-subtitle">{activeCount} active rules &middot; {entries.length} total</p>
        </div>
        {canManage && (
          <button className="chq-btn chq-btn-primary">
            <FontAwesomeIcon icon={faPlus} /> Add Rule
          </button>
        )}
      </div>

      <div className="chq-deny-stats">
        {DENY_SCOPES.map((s) => (
          <div key={s.id} className="chq-deny-stat">
            <FontAwesomeIcon icon={DENY_SCOPE_ICONS[s.id]} className={`chq-deny-stat-icon chq-deny-scope--${s.id}`} />
            <span className="chq-deny-stat-count">{scopeCounts[s.id] || 0}</span>
            <span className="chq-deny-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="chq-cmd-toolbar">
        <input
          className="chq-cmd-search"
          type="text"
          placeholder="Search values, descriptions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select className="chq-cmd-filter" value={filterScope} onChange={(e) => setFilterScope(e.target.value as DenyScope | "all")}>
          <option value="all">All Scopes</option>
          {DENY_SCOPES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <button
          className={`chq-btn chq-btn-outline chq-btn-sm ${showInactive ? "chq-btn--active" : ""}`}
          onClick={() => setShowInactive(!showInactive)}
        >
          <FontAwesomeIcon icon={showInactive ? faEye : faEyeSlash} /> {showInactive ? "Showing Inactive" : "Show Inactive"}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="chq-center chq-center--compact">
          <p className="chq-muted">No deny list entries match your filters.</p>
        </div>
      ) : (
        <div className="chq-panel">
          <table className="chq-table">
            <thead>
              <tr>
                <th>Scope</th>
                <th>Value</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Created</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id} className={`chq-tr ${!entry.isActive ? "chq-tr--inactive" : ""}`}>
                  <td>
                    <span className={`chq-deny-scope-tag chq-deny-scope--${entry.scope}`}>
                      <FontAwesomeIcon icon={DENY_SCOPE_ICONS[entry.scope]} /> {DENY_SCOPES.find((s) => s.id === entry.scope)?.label}
                    </span>
                  </td>
                  <td>
                    <span className="chq-deny-value">{entry.value}</span>
                    {entry.description && <p className="chq-deny-desc">{entry.description}</p>}
                  </td>
                  <td>
                    <span className={`chq-deny-reason chq-deny-reason--${entry.reason}`}>
                      {DENY_REASONS.find((r) => r.id === entry.reason)?.label}
                    </span>
                  </td>
                  <td>
                    <span className={`chq-status ${entry.isActive ? "chq-status--active" : "chq-status--expired"}`}>
                      <FontAwesomeIcon icon={faCircle} /> {entry.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="chq-dimmed">
                    {entry.expiresAt ? (
                      <span><FontAwesomeIcon icon={faClock} /> {new Date(entry.expiresAt).toLocaleDateString()}</span>
                    ) : (
                      <span className="chq-deny-permanent">Permanent</span>
                    )}
                  </td>
                  <td>
                    <span className="chq-dimmed">{entry.createdByEmail}</span>
                    <br />
                    <span className="chq-dimmed" style={{ fontSize: "0.78rem" }}>{new Date(entry.createdAt).toLocaleDateString()}</span>
                  </td>
                  {canManage && (
                    <td>
                      <div style={{ display: "flex", gap: "0.4rem" }}>
                        <button className="chq-btn chq-btn-outline chq-btn-sm">
                          <FontAwesomeIcon icon={faPen} />
                        </button>
                        <button className="chq-btn chq-btn-outline chq-btn-sm chq-btn-danger">
                          <FontAwesomeIcon icon={faBan} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const NOTIF_TYPE_ICONS: Record<NotificationType, typeof faBell> = {
  alert: faExclamationCircle,
  warning: faExclamationTriangle,
  info: faInfoCircle,
  system: faServer,
};

const NOTIF_TYPE_COLORS: Record<NotificationType, string> = {
  alert: "#f87171",
  warning: "#fbbf24",
  info: "#60a5fa",
  system: "#a78bfa",
};

function NotificationsTab({
  rules,
  notifications,
  roles,
  members,
  canManage,
}: {
  rules: NotificationRule[];
  notifications: OrgNotification[];
  roles: OrgRole[];
  members: OrgMember[];
  canManage: boolean;
}) {
  const [activeView, setActiveView] = useState<"feed" | "rules">("feed");
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const enabledRules = rules.filter((r) => r.isEnabled).length;

  const getRoleName = (id: string) => roles.find((r) => r.id === id)?.name || id;
  const getMemberEmail = (id: string) => members.find((m) => m.userId === id)?.userEmail || id;

  const channelIcon = (ch: string) => {
    if (ch === "email") return faEnvelope;
    if (ch === "webhook") return faLink;
    return faBell;
  };

  return (
    <section>
      <div className="chq-section-header">
        <div>
          <h2>Notifications</h2>
          <p className="chq-subtitle">{unreadCount} unread &middot; {enabledRules} active rules</p>
        </div>
        {canManage && (
          <button className="chq-btn chq-btn-primary">
            <FontAwesomeIcon icon={faPlus} /> New Rule
          </button>
        )}
      </div>

      <div className="chq-notif-toggle">
        <button className={`chq-notif-toggle-btn ${activeView === "feed" ? "active" : ""}`} onClick={() => setActiveView("feed")}>
          <FontAwesomeIcon icon={faBell} /> Feed {unreadCount > 0 && <span className="chq-notif-badge">{unreadCount}</span>}
        </button>
        <button className={`chq-notif-toggle-btn ${activeView === "rules" ? "active" : ""}`} onClick={() => setActiveView("rules")}>
          <FontAwesomeIcon icon={faCog} /> Rules
        </button>
      </div>

      {activeView === "feed" && (
        <div className="chq-notif-feed">
          {notifications.length === 0 ? (
            <div className="chq-center chq-center--compact">
              <p className="chq-muted">No notifications yet.</p>
            </div>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className={`chq-notif-item ${!n.isRead ? "chq-notif-item--unread" : ""}`}>
                <div className="chq-notif-icon" style={{ color: NOTIF_TYPE_COLORS[n.type] }}>
                  <FontAwesomeIcon icon={NOTIF_TYPE_ICONS[n.type]} />
                </div>
                <div className="chq-notif-content">
                  <div className="chq-notif-title">
                    {n.title}
                    {!n.isRead && <span className="chq-notif-dot" />}
                  </div>
                  <p className="chq-notif-message">{n.message}</p>
                  <div className="chq-notif-meta">
                    {n.robotName && (
                      <span className="chq-notif-meta-tag">
                        <FontAwesomeIcon icon={faRobot} /> {n.robotName}
                      </span>
                    )}
                    <span className="chq-notif-time">{new Date(n.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeView === "rules" && (
        <div className="chq-cmd-grid">
          {rules.map((rule) => {
            const isOpen = expandedRuleId === rule.id;
            return (
              <div key={rule.id} className={`chq-cmd-card ${!rule.isEnabled ? "chq-cmd-card--disabled" : ""} ${isOpen ? "chq-cmd-card--open" : ""}`}>
                <div className="chq-cmd-card-header" onClick={() => setExpandedRuleId(isOpen ? null : rule.id)}>
                  <div className="chq-cmd-icon-wrap" style={{ color: NOTIF_TYPE_COLORS[rule.type] }}>
                    <FontAwesomeIcon icon={NOTIF_TYPE_ICONS[rule.type]} />
                  </div>
                  <div className="chq-cmd-card-info">
                    <div className="chq-cmd-card-title">
                      <span className="chq-cmd-name">{rule.name}</span>
                      {!rule.isEnabled && <span className="chq-cmd-badge chq-cmd-badge--disabled">Paused</span>}
                    </div>
                    <span className="chq-cmd-topic">
                      <FontAwesomeIcon icon={faBullhorn} /> {NOTIFICATION_EVENTS.find((e) => e.id === rule.event)?.label || rule.event}
                    </span>
                  </div>
                  <div className="chq-cmd-card-meta">
                    <div className="chq-notif-channels">
                      {rule.channels.map((ch) => (
                        <span key={ch} className="chq-notif-channel-icon" title={ch}>
                          <FontAwesomeIcon icon={channelIcon(ch)} />
                        </span>
                      ))}
                    </div>
                    <span className="chq-cmd-meta-stat" title="Times triggered"><FontAwesomeIcon icon={faBell} /> {rule.triggerCount}</span>
                    {canManage && (
                      <button className="chq-cmd-toggle" title={rule.isEnabled ? "Pause" : "Enable"} onClick={(e) => e.stopPropagation()}>
                        <FontAwesomeIcon icon={rule.isEnabled ? faToggleOn : faToggleOff} className={rule.isEnabled ? "chq-cmd-on" : "chq-cmd-off"} />
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="chq-cmd-card-body">
                    {rule.description && <p className="chq-cmd-desc">{rule.description}</p>}

                    <div className="chq-cmd-detail-grid">
                      <div className="chq-cmd-detail">
                        <span className="chq-cmd-detail-label">Event Trigger</span>
                        <span className="chq-cmd-detail-value">{NOTIFICATION_EVENTS.find((e) => e.id === rule.event)?.label || rule.event}</span>
                      </div>
                      <div className="chq-cmd-detail">
                        <span className="chq-cmd-detail-label">Channels</span>
                        <span className="chq-cmd-detail-value">
                          {rule.channels.map((ch) => (
                            <span key={ch} className="chq-notif-channel-tag">
                              <FontAwesomeIcon icon={channelIcon(ch)} /> {ch.replace("_", " ")}
                            </span>
                          ))}
                        </span>
                      </div>
                      <div className="chq-cmd-detail">
                        <span className="chq-cmd-detail-label">Last Triggered</span>
                        <span className="chq-cmd-detail-value">{rule.lastTriggeredAt ? new Date(rule.lastTriggeredAt).toLocaleString() : "Never"}</span>
                      </div>
                      <div className="chq-cmd-detail">
                        <span className="chq-cmd-detail-label">Created</span>
                        <span className="chq-cmd-detail-value">{new Date(rule.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="chq-cmd-tags-section">
                      {rule.targetRoleIds.length > 0 && (
                        <div className="chq-cmd-tag-group">
                          <span className="chq-cmd-detail-label">Notify Roles</span>
                          <div className="chq-cmd-tags">
                            {rule.targetRoleIds.map((rid) => (
                              <span key={rid} className="chq-cmd-tag chq-cmd-tag--role">
                                <FontAwesomeIcon icon={faShieldAlt} /> {getRoleName(rid)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {rule.targetUserIds.length > 0 && (
                        <div className="chq-cmd-tag-group">
                          <span className="chq-cmd-detail-label">Notify Users</span>
                          <div className="chq-cmd-tags">
                            {rule.targetUserIds.map((uid) => (
                              <span key={uid} className="chq-cmd-tag">
                                <FontAwesomeIcon icon={faUser} /> {getMemberEmail(uid)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {canManage && (
                      <div className="chq-cmd-actions">
                        <button className="chq-btn chq-btn-outline chq-btn-sm">
                          <FontAwesomeIcon icon={faPen} /> Edit
                        </button>
                        <button className="chq-btn chq-btn-outline chq-btn-sm chq-btn-danger">
                          <FontAwesomeIcon icon={faBan} /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

