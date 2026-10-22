import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Activity as ActivityIcon,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CirclePause,
  ClipboardList,
  Clock3,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Loader2,
  Maximize2,
  MessageCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  Sparkles,
  Users,
  Wifi,
  WifiOff,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  Activity,
  Agent,
  Approval,
  Bootstrap,
  Project,
  Provider,
  Task,
  TaskStatus,
} from '../shared/types';
import { PROVIDER_LABELS, STATUS_LABELS } from '../shared/types';
import { api, download, getState, relativeTime } from './api';
import Modal from './components/Modal';
import Avatar from './components/Avatar';
import DocumentActions from './components/DocumentActions';
import WorkspaceControls from './components/WorkspaceControls';
import ProjectModal from './components/ProjectModal';
import PlanEditor from './components/PlanEditor';
import ProjectFiles from './components/ProjectFiles';

const Office = lazy(() => import('./components/Office'));
type View = 'workspace' | 'team' | 'tasks' | 'activity' | 'outputs';
const nav = [
  { id: 'workspace' as View, label: 'Workspace', icon: LayoutDashboard },
  { id: 'team' as View, label: 'Your team', icon: Users },
  { id: 'tasks' as View, label: 'Task board', icon: ClipboardList },
  { id: 'activity' as View, label: 'Activity', icon: ActivityIcon },
  { id: 'outputs' as View, label: 'Outputs', icon: FolderOpen },
];
const taskLabels: Record<TaskStatus, string> = {
  queued: 'Up next',
  working: 'In progress',
  review: 'Needs review',
  done: 'Done',
  failed: 'Needs attention',
};

export default function App() {
  const [data, setData] = useState<Bootstrap>();
  const [connected, setConnected] = useState(false);
  const [initialError, setInitialError] = useState('');
  const [view, setView] = useState<View>('workspace');
  const [projectId, setProjectId] = useState(() => {
    try {
      return localStorage.getItem('workroom-project') || '';
    } catch {
      return '';
    }
  });
  const [projectMenu, setProjectMenu] = useState(false);
  const [modal, setModal] = useState<'project' | 'runtime' | 'help' | 'controls' | 'plan' | null>(
    null,
  );
  const [controlsTab, setControlsTab] = useState('limits');
  const [retryFeedback, setRetryFeedback] = useState('');
  const [agentId, setAgentId] = useState<string>();
  const [taskId, setTaskId] = useState<string>();
  const [reviewId, setReviewId] = useState<string>();
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [officeMoving, setOfficeMoving] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [cameraMode, setCameraMode] = useState<'orbit' | 'top'>('orbit');
  const [resetCamera, setResetCamera] = useState(0);
  const [activityFilter, setActivityFilter] = useState('all');
  const seenApprovals = useRef<Set<string> | null>(null);
  const rawState = data?.state;
  const project = rawState?.projects.find((p) => p.id === projectId) || rawState?.projects[0];
  const state = rawState ? { ...rawState, agents: project?.team || rawState.agents } : undefined;
  const tasks = state?.tasks.filter((t) => t.projectId === project?.id) || [];
  const activities = state?.activities.filter((a) => a.projectId === project?.id) || [];
  const pending = state?.approvals.filter((a) => a.status === 'pending') || [];
  const projectApprovals = pending.filter((a) => a.projectId === project?.id);
  const done = tasks.filter((t) => t.status === 'done').length;
  const working = tasks.filter((t) => t.status === 'working').length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const selectedTask = state?.tasks.find((t) => t.id === taskId);
  const selectedAgent = state?.agents.find((a) => a.id === agentId);
  const selectedReview = state?.approvals.find((a) => a.id === reviewId && a.status === 'pending');

  useEffect(() => {
    let disposed = false;
    getState()
      .then((result) => {
        if (!disposed) {
          setData(result);
          setInitialError('');
        }
      })
      .catch((error) => {
        if (!disposed) setInitialError(error.message);
      });
    const source = new EventSource('/api/events');
    source.onopen = () => {
      setConnected(true);
      setInitialError('');
    };
    source.onerror = () => setConnected(false);
    source.onmessage = (e) => {
      try {
        const next = JSON.parse(e.data) as Bootstrap;
        if (!disposed) setData(next);
      } catch {
        setConnected(false);
      }
    };
    return () => {
      disposed = true;
      source.close();
    };
  }, []);
  useEffect(() => {
    if (project)
      try {
        localStorage.setItem('workroom-project', project.id);
      } catch {
        /* Project remains saved on the server. */
      }
  }, [project?.id]);
  useEffect(() => {
    setRetryFeedback('');
  }, [taskId]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!state) return;
    const ids = new Set(pending.map((a) => a.id));
    if (seenApprovals.current)
      for (const approval of pending)
        if (!seenApprovals.current.has(approval.id)) {
          setToast('Your team needs a decision. A new review is ready.');
          if ('Notification' in window && Notification.permission === 'granted')
            new Notification('Your team needs a hand', {
              body: approval.question,
              icon: '/favicon.svg',
            });
        }
    seenApprovals.current = ids;
    document.title = `${pending.length ? `(${pending.length}) ` : ''}Workroom — ${project?.title || 'your studio'}`;
  }, [state]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setModal('project');
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);

  async function act(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await action();
      if (success) setToast(success);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Something went wrong. Please retry.');
    } finally {
      setBusy(false);
    }
  }
  function openReview(approval: Approval) {
    setProjectId(approval.projectId);
    setReviewId(approval.id);
  }
  async function notify() {
    if (pending.length) {
      openReview(pending[0]);
      return;
    }
    if (!('Notification' in window)) {
      setToast(
        'This browser does not support desktop notifications. Reviews will still appear here.',
      );
      return;
    }
    const result = await Notification.requestPermission();
    setToast(
      result === 'granted'
        ? 'Browser alerts enabled. We’ll let you know when your team needs you.'
        : 'Reviews will appear inside Workroom. You can enable browser alerts in browser settings.',
    );
  }

  if (!data || !state)
    return (
      <div className="loading-screen">
        <span className="brand-mark">w</span>
        <h1>Making room for your team.</h1>
        {initialError ? (
          <>
            <p>{initialError}</p>
            <button className="button primary" onClick={() => location.reload()}>
              Try again <RefreshCw size={16} />
            </button>
          </>
        ) : (
          <>
            <Loader2 className="spin" />
            <p>Connecting to your workspace…</p>
          </>
        )}
      </div>
    );

  if (!project)
    return (
      <div className="welcome-workspace">
        <span className="brand-mark">w</span>
        <h1>Your workspace is ready.</h1>
        <p>
          Create a project with your own goal. Choose a team, edit its task plan, and connect a
          model when you are ready.
        </p>
        <p>
          Current connection: {PROVIDER_LABELS[state.provider]}.{' '}
          {state.provider === 'demo'
            ? 'Demo previews do not run AI or tools.'
            : 'Model work starts only when you request planning or run a team.'}
        </p>
        <div className="file-actions">
          <button className="button primary" onClick={() => setModal('project')}>
            New project
          </button>
          <button className="button secondary" onClick={() => setModal('runtime')}>
            Model connections
          </button>
        </div>
        {modal === 'project' && (
          <ProjectModal
            provider={state.provider}
            onClose={() => setModal(null)}
            onCreated={(id) => {
              setProjectId(id);
              setModal(null);
              void getState().then(setData);
            }}
          />
        )}
        {modal === 'runtime' && (
          <RuntimeModal
            data={data}
            onClose={() => setModal(null)}
            onChange={(p) =>
              act(() => api('/runtime', { provider: p }), 'Default connection updated.')
            }
          />
        )}
        {toast && <p role="status">{toast}</p>}
      </div>
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView('workspace');
          }}
        >
          <span className="brand-mark">w</span>
          <span>
            workroom<span className="brand-period">.</span>
          </span>
        </a>
        <div className="studio-picker">
          <span className="studio-monogram">S</span>
          <div>
            <strong>Personal studio</strong>
            <span>Your space to make things</span>
          </div>
        </div>
        <span className="nav-label">YOUR STUDIO</span>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => setView(item.id)}
            >
              <item.icon size={18} strokeWidth={1.7} />
              <span>{item.label}</span>
              {item.id === 'tasks' && <span className="nav-count">{tasks.length}</span>}
              {item.id === 'outputs' && done > 0 && <span className="nav-count">{done}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-spark">
            <Sparkles size={17} />
          </span>
          <strong>Small team. Big possibilities.</strong>
          <p>
            Give your agents a brief.
            <br />
            Make something good together.
          </p>
          <button onClick={() => setModal('project')}>
            Start a project <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setModal('help')}>
            <CircleHelp size={18} strokeWidth={1.7} />
            <span>A little guidance</span>
            <ArrowUpRight size={14} />
          </button>
          <button
            className="nav-item"
            aria-label="Workspace controls"
            onClick={() => setModal('controls')}
          >
            <Settings2 size={18} />
            <span>Workspace controls</span>
          </button>
          <button
            className="runtime-card"
            aria-label={`${PROVIDER_LABELS[state.provider]} ${state.provider === 'demo' ? 'No API key needed' : 'Server-side connection'}`}
            onClick={() => setModal('runtime')}
          >
            <span className="runtime-symbol">
              <Zap size={17} />
            </span>
            <span>
              <strong>{PROVIDER_LABELS[state.provider]}</strong>
              <small>Default for new projects</small>
            </span>
            <Settings2 size={15} />
          </button>
          <div className="sidebar-footer">
            <span className={`status-dot ${connected ? '' : 'offline'}`} />
            {connected ? 'All systems connected' : 'Reconnecting…'}
            <span>v0.1</span>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Studio</span>
            <ChevronRight size={13} />
            <div className="project-selector">
              <button onClick={() => setProjectMenu(!projectMenu)} aria-expanded={projectMenu}>
                {project.title}
                <ChevronDown size={13} />
              </button>
              {projectMenu && (
                <>
                  <button
                    className="menu-dismiss"
                    aria-label="Close project menu"
                    onClick={() => setProjectMenu(false)}
                  />
                  <div className="project-menu">
                    {state.projects.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setProjectId(p.id);
                          setProjectMenu(false);
                        }}
                      >
                        <span>
                          <strong>{p.title}</strong>
                          <small>{STATUS_LABELS[p.status]}</small>
                        </span>
                        {project.id === p.id && <Check size={15} />}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        setProjectMenu(false);
                        setModal('project');
                      }}
                    >
                      <Plus size={15} />
                      New project
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="topbar-right">
            <button
              className={`connection ${connected ? '' : 'connection-off'}`}
              title="Browser connection to the Workroom server. Click for model connection status; this indicator does not mean agents are running."
              onClick={() => setModal('runtime')}
            >
              {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
              {connected ? 'Server connected' : 'Reconnecting'}
            </button>
            <span className="topbar-divider" />
            <button
              className="icon-button notification-button"
              onClick={notify}
              aria-label={
                pending.length
                  ? `${pending.length} pending reviews`
                  : 'Enable browser notifications'
              }
              title="Reviews and notifications"
            >
              <Bell size={18} />
              {pending.length > 0 && <i>{pending.length}</i>}
            </button>
            <span className="user-avatar" title="You · workspace owner">
              Y<span />
            </span>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">A PLACE FOR YOUR AGENTS TO THINK</div>
              <h1>
                {view === 'workspace'
                  ? 'Good work starts with a little space.'
                  : view === 'team'
                    ? 'Different minds. One shared goal.'
                    : view === 'tasks'
                      ? 'Big ideas, manageable steps.'
                      : view === 'outputs'
                        ? 'A little less talk. A little more made.'
                        : 'The conversation behind the work.'}
              </h1>
              <p>
                {view === 'workspace'
                  ? 'Your team is here. Give them a direction and watch ideas become progress.'
                  : view === 'team'
                    ? 'Give each teammate a role, a perspective, and a place in the studio.'
                    : view === 'tasks'
                      ? 'Every handoff has a purpose. Follow the work from brief to done.'
                      : view === 'outputs'
                        ? 'The documents, decisions, and handoffs your team has created.'
                        : 'Live handoffs, working notes, and the decisions that move things forward.'}
              </p>
            </div>
            <button className="button primary new-project" onClick={() => setModal('project')}>
              <Plus size={16} />
              New project
            </button>
          </div>

          <section className="project-banner" aria-label="Current project">
            <div className="project-art">
              <span />
              <span />
              <span />
              <Sparkles size={23} />
            </div>
            <div className="project-info">
              <div className="project-eyebrow">
                CURRENT PROJECT <span>·</span>{' '}
                {project.provider === 'demo'
                  ? 'DEMO SESSION'
                  : PROVIDER_LABELS[project.provider].toUpperCase()}
              </div>
              <h2>{project.title}</h2>
              <p title={project.brief}>{project.brief}</p>
            </div>
            <div className="project-progress">
              <div>
                <span>Overall progress</span>
                <strong>{progress}%</strong>
              </div>
              <div className="progress-track">
                <span style={{ width: `${progress}%` }} />
              </div>
              <small>
                {done} of {tasks.length} tasks complete
              </small>
            </div>
            <button
              disabled={
                busy ||
                project.status === 'completed' ||
                !connected ||
                !tasks.length ||
                project.planningStatus === 'planning' ||
                project.planningStatus === 'failed'
              }
              className={`button ${project.status === 'running' ? 'secondary' : 'primary'}`}
              onClick={() =>
                project.status === 'needs_input' && projectApprovals[0]
                  ? openReview(projectApprovals[0])
                  : void act(() =>
                      api(
                        `/projects/${project.id}/${project.status === 'running' ? 'pause' : 'run'}`,
                      ),
                    )
              }
            >
              {busy ? (
                <Loader2 size={15} className="spin" />
              ) : project.status === 'running' ? (
                <Pause size={15} />
              ) : project.status === 'completed' ? (
                <CheckCheck size={15} />
              ) : project.status === 'needs_input' ? (
                <MessageCircle size={15} />
              ) : (
                <Play size={15} fill="currentColor" />
              )}
              {project.status === 'running'
                ? 'Pause team'
                : project.status === 'completed'
                  ? 'All done'
                  : project.status === 'needs_input'
                    ? 'Review work'
                    : project.status === 'paused'
                      ? 'Resume team'
                      : 'Run team'}
            </button>
          </section>

          <section className="project-tools" aria-label="Project brief and plan">
            <details className="saved-brief">
              <summary>Saved project brief</summary>
              <p>{project.brief}</p>
              <button
                className="text-button"
                onClick={() =>
                  download(`${project.title}-brief.md`, `# ${project.title}\n\n${project.brief}`)
                }
              >
                Download brief
              </button>
            </details>
            <button
              className="button secondary small"
              disabled={
                busy ||
                project.planningStatus === 'planning' ||
                project.status === 'running' ||
                working > 0
              }
              onClick={() => setModal('plan')}
            >
              Edit plan · {tasks.length} tasks
            </button>
          </section>
          {project.planningStatus === 'planning' && (
            <div className="planning-banner" role="status">
              <Loader2 size={18} className="spin" />
              <div>
                <strong>Project saved. Planning is running.</strong>
                <p>Your original brief is safe. You can close this page and return.</p>
              </div>
              <button
                className="button secondary small"
                onClick={() => act(() => api(`/projects/${project.id}/pause`))}
              >
                Stop planning
              </button>
            </div>
          )}
          {project.planningStatus === 'failed' && (
            <div className="planning-banner error-banner" role="alert">
              <div>
                <strong>Planning needs attention. Your project and brief are saved.</strong>
                <p>{project.planningError}</p>
              </div>
              <div className="file-actions">
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => act(() => api(`/projects/${project.id}/retry-planning`))}
                >
                  Retry planning
                </button>
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => act(() => api(`/projects/${project.id}/starter-plan`))}
                >
                  Use editable template
                </button>
                <button
                  className="button secondary small"
                  onClick={() => {
                    setControlsTab('usage');
                    setModal('controls');
                  }}
                >
                  Review usage
                </button>
              </div>
            </div>
          )}

          {projectApprovals.length > 0 && (
            <button className="approval-banner" onClick={() => openReview(projectApprovals[0])}>
              <span className="approval-symbol">
                <MessageCircle size={18} />
              </span>
              <span>
                <strong>A little human perspective?</strong>
                <span>Your team has a direction ready for you to review.</span>
              </span>
              <span className="review-link">
                Review & respond <ArrowRight size={16} />
              </span>
            </button>
          )}
          {tasks.some((t) => t.status === 'failed') && (
            <div className="error-banner">
              <strong>A teammate hit a snag.</strong>
              <span>{tasks.find((t) => t.status === 'failed')?.error}</span>
              <button
                className="button secondary small"
                onClick={() => setTaskId(tasks.find((t) => t.status === 'failed')!.id)}
              >
                See task <ArrowRight size={14} />
              </button>
            </div>
          )}

          {view === 'workspace' && (
            <>
              <div className="workspace-grid">
                <section className="office-card">
                  <div className="section-header">
                    <div>
                      <span className="section-title">The studio</span>
                      <span className="live-pill">
                        <i />
                        LIVE
                      </span>
                    </div>
                    <div className="view-toggle" aria-label="Camera view">
                      <button
                        className={cameraMode === 'orbit' ? 'selected' : ''}
                        onClick={() => setCameraMode('orbit')}
                      >
                        3D view
                      </button>
                      <button
                        className={cameraMode === 'top' ? 'selected' : ''}
                        onClick={() => setCameraMode('top')}
                      >
                        Floor plan
                      </button>
                    </div>
                  </div>
                  <div className="office-scene">
                    <Suspense
                      fallback={
                        <div className="scene-loading">
                          <Box size={30} />
                          <span>Opening the studio…</span>
                        </div>
                      }
                    >
                      <Office
                        agents={state.agents}
                        tasks={tasks}
                        activities={activities}
                        mode={cameraMode}
                        zoom={zoom}
                        reset={resetCamera}
                        moving={officeMoving}
                        onAgentClick={setAgentId}
                      />
                    </Suspense>
                    <div className="scene-top">
                      <span className={`scene-status ${project.status}`}>
                        <i />
                        {STATUS_LABELS[project.status]}
                      </span>
                      <span className="scene-agent-count">
                        <Users size={13} />
                        {state.agents.length} agents
                      </span>
                    </div>
                    <div className="scene-controls">
                      <button
                        onClick={() => setOfficeMoving((moving) => !moving)}
                        aria-label={
                          officeMoving ? 'Pause office movement' : 'Resume office movement'
                        }
                        title={
                          officeMoving
                            ? 'Pause office movement (tasks continue)'
                            : 'Resume office movement'
                        }
                        aria-pressed={!officeMoving}
                      >
                        {officeMoving ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                      <span />
                      <button
                        onClick={() => setZoom((z) => Math.max(0.65, z - 0.15))}
                        aria-label="Zoom out"
                        title="Zoom out"
                      >
                        <ZoomOut size={16} />
                      </button>
                      <button
                        onClick={() => setZoom((z) => Math.min(1.9, z + 0.15))}
                        aria-label="Zoom in"
                        title="Zoom in"
                      >
                        <ZoomIn size={16} />
                      </button>
                      <span />
                      <button
                        onClick={() => {
                          setZoom(1);
                          setResetCamera((v) => v + 1);
                        }}
                        aria-label="Reset camera"
                        title="Reset camera"
                      >
                        <RotateCcw size={15} />
                      </button>
                    </div>
                    <span className="scene-hint">
                      {cameraMode === 'orbit'
                        ? 'Drag to orbit · Scroll to zoom'
                        : 'Your team, from a different perspective'}
                    </span>
                    <div className="scene-wordmark">
                      workroom<span>STUDIO 001</span>
                    </div>
                  </div>
                  <div className="office-footer">
                    <span>
                      <span className="status-dot" />
                      {working
                        ? `${working} ${working === 1 ? 'teammate is' : 'teammates are'} making progress`
                        : projectApprovals.length
                          ? 'Waiting for your perspective'
                          : project.status === 'completed'
                            ? 'Good things, made together'
                            : 'A good day to make something'}
                    </span>
                    <button onClick={() => setView('team')}>
                      Meet the team <ArrowUpRight size={14} />
                    </button>
                  </div>
                </section>
                <aside className="activity-card">
                  <div className="section-header">
                    <span className="section-title">
                      Live activity <span className="subtle-count">{activities.length}</span>
                    </span>
                    <button
                      className="icon-button"
                      onClick={() => setView('activity')}
                      aria-label="View all activity"
                    >
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                  <div className="activity-intro">
                    <span className="status-dot" />
                    Good ideas are in the making.
                  </div>
                  <div className="activity-list compact">
                    {activities.slice(0, 8).map((activity) => (
                      <ActivityItem key={activity.id} activity={activity} agents={state.agents} />
                    ))}
                  </div>
                  <div className="activity-bottom">
                    <span className="tiny-agent-dots">
                      {state.agents.map((a) => (
                        <i key={a.id} style={{ background: a.color }} />
                      ))}
                    </span>
                    <span>One shared workspace.</span>
                  </div>
                </aside>
              </div>
              <div className="team-section-heading">
                <h2>
                  Your people<span>Well, your agents.</span>
                </h2>
                <button onClick={() => setView('team')}>
                  Manage team <ArrowRight size={15} />
                </button>
              </div>
              <div className="agent-strip">
                {state.agents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    task={tasks.find(
                      (t) =>
                        t.agentId === agent.id && (t.status === 'working' || t.status === 'review'),
                    )}
                    onClick={() => setAgentId(agent.id)}
                  />
                ))}
              </div>
              <div className="bottom-note">
                <Sparkles size={14} />
                <span>
                  {project.provider === 'demo'
                    ? 'Demo preview: no AI or tools run. Connect a model for real work.'
                    : project.workflow === 'software'
                      ? 'Each role uses Codex tools in the shared project folder. Task details show actual tool activity.'
                      : 'Each role receives its assignment and relevant handoffs. This connection produces text; it does not execute code.'}
                </span>
                <button onClick={() => setModal('runtime')}>
                  {project.provider === 'demo' ? 'Connect a runtime' : 'Runtime settings'}
                  <ArrowUpRight size={13} />
                </button>
              </div>
            </>
          )}

          {view === 'team' && (
            <>
              <div className="team-grid">
                {state.agents.map((agent) => (
                  <article className="team-profile" key={agent.id}>
                    <div
                      className="profile-cover"
                      style={{ '--agent-color': agent.color } as React.CSSProperties}
                    >
                      <Avatar color={agent.color} size={96} />
                      <span>DESK 0{agent.desk + 1}</span>
                    </div>
                    <div className="profile-content">
                      <div className="profile-name">
                        <h2>{agent.name}</h2>
                        <span className="tag">
                          {tasks.some((t) => t.agentId === agent.id && t.status === 'working')
                            ? 'Working'
                            : 'Available'}
                        </span>
                      </div>
                      <span className="role-label">{agent.role}</span>
                      <p>{agent.specialty}</p>
                      <div className="profile-stats">
                        <span>
                          <strong>{tasks.filter((t) => t.agentId === agent.id).length}</strong>{' '}
                          assigned tasks
                        </span>
                        <span>
                          <strong>
                            {
                              tasks.filter((t) => t.agentId === agent.id && t.status === 'done')
                                .length
                            }
                          </strong>{' '}
                          complete
                        </span>
                      </div>
                      <button className="button secondary" onClick={() => setAgentId(agent.id)}>
                        Edit role & desk <Settings2 size={15} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="info-callout">
                <Users size={20} />
                <div>
                  <strong>A role is more than a label.</strong>
                  <p>
                    Each teammate’s role and focus become part of their model prompt. Desk changes
                    also move their character in the studio.
                  </p>
                </div>
              </div>
            </>
          )}

          {view === 'tasks' && (
            <section className="board">
              <div className="board-heading">
                <span>
                  <ClipboardList size={17} />
                  {tasks.length} tasks <span>·</span> {done} completed
                </span>
                <span className="tag">Dependencies enforced</span>
              </div>
              <div className="board-columns">
                {(['queued', 'working', 'review', 'done'] as TaskStatus[]).map((status) => {
                  const group = tasks.filter(
                    (t) => t.status === status || (status === 'working' && t.status === 'failed'),
                  );
                  return (
                    <div className={`board-column column-${status}`} key={status}>
                      <h3>
                        <i />
                        {taskLabels[status]}
                        <span>{group.length}</span>
                      </h3>
                      <div className="column-tasks">
                        {group.map((task, index) => {
                          const agent = state.agents.find((a) => a.id === task.agentId)!;
                          const blocked = task.dependencies.some(
                            (id) => tasks.find((t) => t.id === id)?.status !== 'done',
                          );
                          return (
                            <button
                              className={`task-card ${task.status}`}
                              key={task.id}
                              onClick={() =>
                                task.status === 'review'
                                  ? openReview(projectApprovals.find((a) => a.taskId === task.id)!)
                                  : setTaskId(task.id)
                              }
                            >
                              <span className="task-number">
                                TASK {String(tasks.indexOf(task) + 1).padStart(2, '0')}
                                <ArrowUpRight size={14} />
                              </span>
                              <h4>{task.title}</h4>
                              <p>{task.description}</p>
                              {blocked && (
                                <span className="dependency-label">
                                  <Clock3 size={12} />
                                  Waiting for handoff
                                </span>
                              )}
                              {task.status === 'failed' && (
                                <span className="failed-label">Task failed · retry available</span>
                              )}
                              <div className="task-card-footer">
                                <Avatar color={agent.color} size={25} />
                                <span>{agent.name}</span>
                                {task.requiresApproval && (
                                  <span title="Human review required">
                                    <MessageCircle size={13} />
                                  </span>
                                )}
                                {task.status === 'working' && (
                                  <Loader2 size={14} className="spin" />
                                )}
                              </div>
                            </button>
                          );
                        })}
                        {!group.length && (
                          <div className="column-empty">
                            {status === 'done'
                              ? 'Good work will land here.'
                              : status === 'review'
                                ? 'A place for your perspective.'
                                : status === 'working'
                                  ? 'Ready for a little momentum.'
                                  : 'Nothing waiting in the wings.'}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {view === 'activity' && (
            <section className="full-activity">
              <div className="section-header">
                <span className="section-title">The team’s timeline</span>
                <select
                  aria-label="Filter activity"
                  value={activityFilter}
                  onChange={(e) => setActivityFilter(e.target.value)}
                >
                  <option value="all">All updates</option>
                  <option value="message">Conversations</option>
                  <option value="approval">Human reviews</option>
                  <option value="error">Errors</option>
                </select>
              </div>
              <div className="activity-list">
                {activities
                  .filter((a) => activityFilter === 'all' || a.type === activityFilter)
                  .map((a) => (
                    <ActivityItem key={a.id} activity={a} agents={state.agents} />
                  ))}
                {!activities.some((a) => activityFilter === 'all' || a.type === activityFilter) && (
                  <div className="empty-state">
                    <MessageCircle size={32} />
                    <h3>A quiet corner, for now.</h3>
                    <p>Matching updates will appear as the team works.</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {view === 'outputs' && (
            <section className="outputs-section">
              <div className="outputs-heading">
                <span>{tasks.filter((t) => t.output).length} deliverables in this project</span>
                {tasks.some((t) => t.output) && (
                  <DocumentActions
                    all
                    title={`${project.title}-handoff`}
                    content={`# ${project.title}\n\n${project.brief}\n\n${tasks
                      .filter((t) => t.output)
                      .map((t) => `> Workflow status: ${taskLabels[t.status]}\n\n${t.output}`)
                      .join('\n\n---\n\n')}`}
                  />
                )}
              </div>
              <p className="outputs-help">
                Open a task result to review its work, download useful reports as Word or Markdown,
                export tables to Excel, or print to PDF.
              </p>
              {project.workflow === 'software' && (
                <ProjectFiles
                  key={project.id}
                  project={project}
                  revision={tasks
                    .map((t) => `${t.status}:${t.completedAt || 0}:${t.toolLog?.length || 0}`)
                    .join('|')}
                />
              )}
              {tasks.some((t) => t.output) ? (
                <div className="output-grid">
                  {tasks
                    .filter((t) => t.output)
                    .map((task) => {
                      const agent = state.agents.find((a) => a.id === task.agentId)!;
                      return (
                        <article className="output-card" key={task.id}>
                          <button
                            className="output-preview"
                            aria-label={`Read ${task.title}`}
                            onClick={() => setTaskId(task.id)}
                          >
                            <FileText size={30} strokeWidth={1.2} />
                            <div className="paper-lines">
                              <i />
                              <i />
                              <i />
                              <i />
                            </div>
                            <span className={`output-status ${task.status}`}>
                              {task.status === 'review'
                                ? 'Awaiting approval'
                                : task.status === 'done'
                                  ? 'Ready to use'
                                  : 'Draft'}
                            </span>
                          </button>
                          <div className="output-details">
                            <h3>{task.title}</h3>
                            <div>
                              <Avatar color={agent.color} size={24} />
                              <span>
                                {agent.name} ·{' '}
                                {task.documentKind
                                  ? task.documentKind.replace(/_/g, ' ')
                                  : 'Document'}
                              </span>
                            </div>
                            <div className="output-actions">
                              <button onClick={() => setTaskId(task.id)}>
                                Read & export <ArrowUpRight size={14} />
                              </button>
                              <button
                                aria-label={`Download ${task.title}`}
                                onClick={() =>
                                  download(
                                    `${task.title.toLowerCase().replace(/\W+/g, '-')}.md`,
                                    task.output,
                                  )
                                }
                              >
                                <ArrowDownToLine size={16} />
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                </div>
              ) : (
                <div className="empty-state large">
                  <span className="empty-icon">
                    <FolderOpen size={35} strokeWidth={1.3} />
                  </span>
                  <h2>Good things take a little teamwork.</h2>
                  <p>
                    Run your team and their deliverables will collect here,
                    <br />
                    ready for you to review, keep, and build on.
                  </p>
                  <button className="button primary" onClick={() => setView('workspace')}>
                    Back to the studio <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </section>
          )}
          <footer className="page-footer">
            <span>MADE FOR THINKING TOGETHER.</span>
            <a
              href="https://github.com/guiltyascharged123/Coding-Chet"
              target="_blank"
              rel="noreferrer"
            >
              Open source, open possibilities <ArrowUpRight size={12} />
            </a>
          </footer>
        </div>
      </main>

      {modal === 'project' && (
        <ProjectModal
          onClose={() => setModal(null)}
          provider={state.provider}
          onCreated={(id) => {
            setProjectId(id);
            setView('workspace');
            setModal(null);
            void getState().then(setData);
            setToast('Project saved. Review its plan before starting the team.');
          }}
        />
      )}
      {modal === 'plan' && (
        <PlanEditor
          project={project}
          tasks={tasks}
          team={state.agents}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'controls' && (
        <WorkspaceControls
          data={data}
          project={project}
          initialTab={controlsTab}
          onClose={() => {
            setModal(null);
            setControlsTab('limits');
          }}
        />
      )}
      {modal === 'runtime' && (
        <RuntimeModal
          data={data}
          onClose={() => setModal(null)}
          onChange={(provider) =>
            act(
              () => api('/runtime', { provider }),
              `Default for new projects: ${PROVIDER_LABELS[provider]}. Existing projects keep their connection.`,
            )
          }
        />
      )}
      {modal === 'help' && (
        <Modal
          title="A little room to get started."
          subtitle="From a brief to a team handoff, in a few steps."
          onClose={() => setModal(null)}
        >
          <div className="help-steps">
            {[
              [
                '01',
                'Give the team a direction',
                'Create a project with a clear goal, audience, and constraints. The planner breaks it into tasks and assigns your specialists.',
              ],
              [
                '02',
                'Let the handoffs happen',
                'Run the team. Tasks start when dependencies are done. The office and activity feed reflect actual runtime events.',
              ],
              [
                '03',
                'Bring your perspective',
                'When a review appears, read the draft. Approve it or request specific changes. Dependent tasks wait for you.',
              ],
              [
                '04',
                'Take the good work with you',
                'Export Word documents, Excel workbooks, Markdown, or print to PDF in Outputs. Demo mode uses labeled templates; model runtimes generate text, while external workers can connect your own tools.',
              ],
            ].map(([n, title, text]) => (
              <div key={n}>
                <span>{n}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="modal-bottom-note">
            <span className="keycap">⌘ / Ctrl K</span> Start a new project from anywhere.
          </div>
        </Modal>
      )}
      {selectedAgent && (
        <AgentModal
          agent={selectedAgent}
          projectId={project.id}
          onClose={() => setAgentId(undefined)}
          onSaved={() => {
            setAgentId(undefined);
            setToast('Teammate updated. A new perspective, same shared goal.');
          }}
        />
      )}
      {selectedTask && (
        <Modal
          wide
          title={selectedTask.title}
          subtitle={`${state.agents.find((a) => a.id === selectedTask.agentId)?.name} · ${taskLabels[selectedTask.status]}`}
          onClose={() => setTaskId(undefined)}
        >
          <div className="task-detail">
            <p className="task-description">{selectedTask.description}</p>
            {!!selectedTask.toolLog?.length && (
              <details className="tool-activity" open>
                <summary>Actual tool activity ({selectedTask.toolLog.length})</summary>
                {selectedTask.toolLog.map((e) => (
                  <div key={e.id}>
                    <strong>
                      {e.type} · {e.status || 'started'}
                    </strong>
                    <pre>{e.detail}</pre>
                  </div>
                ))}
              </details>
            )}
            {selectedTask.error && (
              <div className="task-error">
                <strong>The task couldn’t finish</strong>
                <p>{selectedTask.error}</p>
                <label>
                  Additional direction for retry
                  <textarea
                    key={selectedTask.id}
                    maxLength={4000}
                    rows={3}
                    onChange={(e) => setRetryFeedback(e.target.value)}
                    placeholder="Clarify the assignment or explain what changed."
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => api(`/tasks/${selectedTask.id}/retry`, { feedback: retryFeedback }),
                      'The task is queued for another attempt.',
                    )
                  }
                >
                  <RefreshCw size={15} />
                  Retry task
                </button>
              </div>
            )}
            {selectedTask.output ? (
              <>
                <div className="document-toolbar">
                  <span>
                    <FileText size={15} />
                    Deliverable
                  </span>
                  <DocumentActions
                    title={selectedTask.title}
                    content={`> Workflow status: ${taskLabels[selectedTask.status]}\n\n${selectedTask.output}`}
                  />
                </div>
                <article className="markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedTask.output}</ReactMarkdown>
                </article>
              </>
            ) : (
              <div className="empty-state">
                <Clock3 size={28} />
                <h3>
                  {selectedTask.status === 'working'
                    ? 'A good idea is taking shape.'
                    : 'Waiting for its moment.'}
                </h3>
                <p>
                  {selectedTask.status === 'working'
                    ? 'The deliverable will appear here when the agent finishes.'
                    : 'This task will begin when the team is running and its dependencies are complete.'}
                </p>
              </div>
            )}
          </div>
        </Modal>
      )}
      {selectedReview && (
        <ReviewModal
          approval={selectedReview}
          task={state.tasks.find((t) => t.id === selectedReview.taskId)!}
          agent={state.agents.find(
            (a) => a.id === state.tasks.find((t) => t.id === selectedReview.taskId)?.agentId,
          )!}
          onClose={() => setReviewId(undefined)}
          onDone={(message) => {
            setReviewId(undefined);
            setToast(message);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <span className="toast-icon">
            <Sparkles size={17} />
          </span>
          <span>{toast}</span>
          <button onClick={() => setToast('')} aria-label="Dismiss notification">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function ActivityItem({ activity, agents }: { activity: Activity; agents: Agent[] }) {
  const agent = agents.find((a) => a.id === activity.agentId);
  return (
    <article className={`activity-item type-${activity.type}`}>
      <span className="activity-avatar">
        {agent ? (
          <Avatar color={agent.color} size={31} />
        ) : (
          <span className="system-avatar">
            {activity.type === 'error' ? <CircleHelp size={14} /> : <Sparkles size={14} />}
          </span>
        )}
      </span>
      <div>
        <div className="activity-byline">
          <strong>{agent?.name || 'Workroom'}</strong>
          <time dateTime={new Date(activity.createdAt).toISOString()}>
            {relativeTime(activity.createdAt)}
          </time>
        </div>
        {agent && <span className="activity-role">{agent.role}</span>}
        <p>{activity.message}</p>
        {activity.type === 'approval' && (
          <span className="review-tag">
            <MessageCircle size={11} />
            Human input needed
          </span>
        )}
      </div>
    </article>
  );
}
function AgentCard({ agent, task, onClick }: { agent: Agent; task?: Task; onClick: () => void }) {
  return (
    <button className={`agent-card ${task?.status || ''}`} onClick={onClick}>
      <Avatar color={agent.color} size={45} />
      <div>
        <div className="agent-card-name">
          {agent.name}
          <span className={`agent-status-dot ${task?.status || ''}`} />
        </div>
        <span className="agent-card-role">{agent.role}</span>
        <span className="agent-card-status">
          {task?.status === 'working'
            ? 'Making progress'
            : task?.status === 'review'
              ? 'Waiting for your review'
              : 'Ready for what’s next'}
        </span>
      </div>
      <ChevronRight size={14} />
    </button>
  );
}

function AgentModal({
  agent,
  projectId,
  onClose,
  onSaved,
}: {
  agent: Agent;
  projectId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role);
  const [specialty, setSpecialty] = useState(agent.specialty);
  const [goal, setGoal] = useState(agent.goal || '');
  const [desk, setDesk] = useState(agent.desk);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api(`/agents/${agent.id}`, { name, role, specialty, desk, goal, projectId }, 'PATCH');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={`A little about ${agent.name}.`}
      subtitle="A distinct perspective makes the whole team better."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        <div className="form-agent-intro">
          <Avatar color={agent.color} size={60} />
          <div>
            <strong>Your studio teammate</strong>
            <span>Agent ID: {agent.id}</span>
          </div>
        </div>
        <div className="form-row">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={30} />
          </label>
          <label>
            Role
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              required
              minLength={2}
              maxLength={50}
            />
          </label>
        </div>
        <label>
          Focus & perspective
          <textarea
            rows={3}
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            required
            minLength={5}
            maxLength={600}
          />
        </label>
        <label>
          Goal within a project
          <textarea
            aria-label="Agent goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            maxLength={1000}
            rows={2}
          />
        </label>
        <label>
          A place in the studio
          <select value={desk} onChange={(e) => setDesk(Number(e.target.value))}>
            {[
              '01 · Window side',
              '02 · Inspiration corner',
              '03 · Builder’s bench',
              '04 · Quiet corner',
            ].map((d, i) => (
              <option key={i} value={i}>
                Desk {d}
              </option>
            ))}
          </select>
          <span className="field-hint">
            Choosing an occupied desk swaps seats with that teammate.
          </span>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={saving}>
            {saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}Save teammate
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReviewModal({
  approval,
  task,
  agent,
  onClose,
  onDone,
}: {
  approval: Approval;
  task: Task;
  agent: Agent;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function decide(decision: 'approve' | 'revise') {
    setSaving(true);
    try {
      await api(`/approvals/${approval.id}`, { decision, feedback });
      onDone(
        decision === 'approve'
          ? 'Direction approved. The next handoff is underway.'
          : 'Feedback delivered. Your teammate will revise the draft.',
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal wide title="A little human perspective." subtitle={approval.question} onClose={onClose}>
      <div className="review-agent">
        <Avatar color={agent.color} size={37} />
        <div>
          <strong>{agent.name} has a draft for you.</strong>
          <span>{task.title}</span>
        </div>
        <span className="review-tag">Your decision matters</span>
      </div>
      <article className="markdown review-document">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.output}</ReactMarkdown>
      </article>
      <div className="review-response">
        <label>
          Your feedback
          <span className="field-hint">
            Optional for approval. Required when requesting changes.
          </span>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="What’s working? What would you like to change?"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            className="button secondary"
            disabled={saving || !feedback.trim()}
            onClick={() => decide('revise')}
          >
            <RotateCcw size={15} />
            Request changes
          </button>
          <button className="button primary" disabled={saving} onClick={() => decide('approve')}>
            {saving ? <Loader2 className="spin" size={15} /> : <Check size={15} />}Approve &
            continue
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RuntimeModal({
  data,
  onClose,
  onChange,
}: {
  data: Bootstrap;
  onClose: () => void;
  onChange: (provider: Provider) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [checkMessage, setCheckMessage] = useState('');
  const descriptions: Record<Provider, string> = {
    codex:
      'Uses your ChatGPT Codex sign-in. Software teams can edit files and run commands in their managed folder; other workflows generate text. Subscription allowance applies, with no API-key fallback.',
    ollama:
      'A model running on your computer through Ollama. Uses local RAM and CPU/GPU. No automatic model download.',
    compatible:
      'Connect a configured OpenAI-compatible model server such as LM Studio or llama.cpp. API compatibility and billing depend on that server.',
    demo: 'A local, scripted workflow. Explore tasks, reviews, and handoffs without API calls.',
    openai: `Real AI plans and documents using ${data.runtime.models.openai}. Requires an OpenAI API key and API billing. No file or command tools in this adapter.`,
    gemini: `Real AI plans and documents using ${data.runtime.models.gemini}. Requires a Gemini API key, model access, and available quota. No file or command tools in this adapter.`,
    external:
      'Run your own agent processes and attach them to the office. Requires a shared RUNNER_TOKEN, a running worker, and whatever model or tools that worker uses.',
  };
  return (
    <Modal
      title="The minds behind the desks."
      subtitle="The studio is the interface. Your runtime does the thinking."
      onClose={onClose}
    >
      <div className="runtime-check">
        <button
          className="button secondary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await api('/connections/check');
              setCheckMessage('Readiness refreshed. No model was run.');
            } catch (e) {
              setCheckMessage((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          Check connections
        </button>
        <p role="status">{checkMessage}</p>
        {data.runtime.coding && (
          <p>
            <strong>Coding tools: {data.runtime.coding.ready ? 'Ready' : 'Not ready'}</strong>
            <br />
            {data.runtime.coding.message}
          </p>
        )}
        <p>
          This chooses the default for new projects. Use Workspace controls to explicitly change an
          existing project’s connection.
        </p>
      </div>
      <div className="runtime-options">
        {(
          ['demo', 'codex', 'ollama', 'compatible', 'openai', 'gemini', 'external'] as Provider[]
        ).map((provider) => (
          <button
            className={`runtime-option ${data.state.provider === provider ? 'chosen' : ''}`}
            key={provider}
            disabled={!data.runtime.available[provider] || saving}
            onClick={async () => {
              setSaving(true);
              await onChange(provider);
              setSaving(false);
            }}
          >
            <span className={`provider-icon provider-${provider}`}>
              {provider === 'external' ? (
                <Box size={20} />
              ) : provider === 'demo' ? (
                <Play size={19} />
              ) : (
                <Sparkles size={20} />
              )}
            </span>
            <span>
              <strong>
                {PROVIDER_LABELS[provider]}
                {data.state.provider === provider && <span className="tag">Active</span>}
              </strong>
              <p>{descriptions[provider]}</p>
              <small>
                {data.runtime.available[provider]
                  ? data.runtime.diagnostics?.[provider] ||
                    (provider === 'demo'
                      ? 'Simulation · no model calls'
                      : provider === 'external'
                        ? 'Token configured · start a worker separately'
                        : 'API key present · access checked on first request')
                  : data.runtime.diagnostics?.[provider] || 'Needs server configuration'}
              </small>
            </span>
            {data.state.provider === provider && <Check size={18} />}
          </button>
        ))}
      </div>
      <div className="runtime-instructions">
        <strong>These are implemented connection options</strong>
        <p>
          Use Codex through your ChatGPT account for software delivery or text work, or use a local
          model for text work. All four characters can share one model; their roles and task context
          make each assignment different. You do not need to build four separate AIs.
        </p>
        <p>
          Codex uses your account’s Codex allowance. Local models use your hardware. Paid API access
          is separate and starts disabled; enable it and set price estimates in Workspace controls.
          Keys stay on the server.
        </p>
        <strong>Connect a provider</strong>
        <p>
          Copy <code>.env.example</code> to <code>.env</code> and follow the connection guide. Codex
          needs CLI sign-in and an exact available model ID; Ollama needs a running local service
          and installed model. Restart after configuration, then check connections.
        </p>
        <p>
          Software delivery uses the built-in Codex file and command worker. For additional browsing
          or specialist tools, connect an external worker built with an agent framework such as
          OpenAI Agents SDK, LangGraph, CrewAI, or Google ADK. These need a custom bridge using the
          documented runner API; they are not preinstalled integrations. A local model server can
          also be used inside that worker. Pause running projects before switching. This single-user
          app should stay on a trusted local network until authentication is added.{' '}
          <a
            href="https://github.com/guiltyascharged123/Coding-Chet/blob/workroom-starter/docs/AI-CONNECTIONS.md"
            target="_blank"
            rel="noreferrer"
          >
            Read the AI connection guide ↗
          </a>
        </p>
      </div>
    </Modal>
  );
}
