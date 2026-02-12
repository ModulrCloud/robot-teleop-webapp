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
} from "@fortawesome/free-solid-svg-icons";
import type {
  Organisation,
  OrgRole,
  OrgMember,
  OrgInvite,
  OrgRobot,
  CommandHQTab,
} from "../types/organisation";
import { PERMISSION_LABELS } from "../types/organisation";
import {
  getMockOrgById,
  getMockRolesForOrg,
  getMockMembersForOrg,
  getMockInvitesForOrg,
  getMockRobotsForOrg,
} from "../mocks/organisation";
import "./CommandHQ.css";

const TABS: { id: CommandHQTab; label: string; icon: typeof faSatelliteDish }[] = [
  { id: "overview", label: "Overview", icon: faSatelliteDish },
  { id: "members", label: "Members", icon: faUsers },
  { id: "robots", label: "Robots", icon: faRobot },
  { id: "sessions", label: "Sessions & Logs", icon: faHistory },
  { id: "commands", label: "ROS Commands", icon: faTerminal },
  { id: "denylist", label: "Deny List", icon: faBan },
  { id: "notifications", label: "Notifications", icon: faBell },
];

export const CommandHQ = () => {
  usePageTitle();
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStatus();

  const [activeTab, setActiveTab] = useState<CommandHQTab>("overview");
  const [org, setOrg] = useState<Organisation | null>(null);
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [robots, setRobots] = useState<OrgRobot[]>([]);
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
          <h2>Organisation not found</h2>
          <p className="chq-muted">This organisation doesn't exist or you don't have access.</p>
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
            <h1>{org.name}</h1>
            <span className={`chq-badge chq-badge--${org.status}`}>{org.status}</span>
            {currentRole && (
              <span className="chq-badge chq-badge--role">
                {currentRole.priority === 0 && <FontAwesomeIcon icon={faCrown} />}
                {currentRole.name}
              </span>
            )}
          </div>
          <span className="chq-slug">/{org.slug}</span>
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
            <MembersTab members={members} invites={invites} roles={roles} org={org} canManage={hasPermission("members:manage")} />
          )}
          {activeTab === "robots" && (
            <RobotsTab robots={robots} members={members} canManage={hasPermission("robots:manage")} />
          )}
          {!["overview", "members", "robots"].includes(activeTab) && <PlaceholderTab tab={activeTab} />}
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
  org: Organisation;
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
  org,
  canManage,
}: {
  members: OrgMember[];
  invites: OrgInvite[];
  roles: OrgRole[];
  org: Organisation;
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
                  {isOpen && role && (
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
                      </td>
                    </tr>
                  )}
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

function RobotsTab({
  robots,
  members,
  canManage,
}: {
  robots: OrgRobot[];
  members: OrgMember[];
  canManage: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number; status: string }[]>([]);

  const onlineCount = robots.filter((r) => r.connectionStatus === "online").length;
  const errorCount = robots.filter((r) => r.connectionStatus === "error").length;

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
              <div
                key={m.id}
                className={`chq-diagram-node ${!hasRobot ? "chq-diagram-node--dim" : ""}`}
                data-member={m.userId}
              >
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
          {robots.map((r) => {
            const unassigned = r.assignedOperators.length === 0;
            return (
              <div
                key={r.id}
                className={`chq-diagram-node chq-diagram-node--robot ${unassigned ? "chq-diagram-node--unassigned" : ""}`}
                data-robot={r.id}
              >
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
            );
          })}
        </div>
      </div>

      <div className="chq-diagram-legend">
        <span className="chq-legend-item"><span className="chq-legend-line chq-legend-line--online" /> Online</span>
        <span className="chq-legend-item"><span className="chq-legend-line chq-legend-line--offline" /> Offline</span>
        <span className="chq-legend-item"><span className="chq-legend-line chq-legend-line--error" /> Error</span>
        <span className="chq-legend-item"><span className="chq-legend-dot" /> Unassigned</span>
      </div>
    </section>
  );
}

function PlaceholderTab({ tab }: { tab: string }) {
  const labels: Record<string, string> = {
    robots: "Robots",
    sessions: "Sessions & Logs",
    commands: "ROS Commands",
    roles: "Roles & Permissions",
    denylist: "Deny List",
    notifications: "Notifications",
    settings: "Settings",
  };
  return (
    <section>
      <div className="chq-center chq-center--compact">
        <div className="chq-placeholder-icon">
          <FontAwesomeIcon icon={faSatelliteDish} />
        </div>
        <h3>{labels[tab] || tab}</h3>
        <p className="chq-muted">This section is under development.</p>
      </div>
    </section>
  );
}
