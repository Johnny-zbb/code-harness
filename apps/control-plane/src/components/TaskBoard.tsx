import { useEffect, useRef, useState, type ReactNode } from "react";
import { Form, ModalOverlay, Modal, Dialog } from "react-aria-components";
import {
  RiArrowLeftLine,
  RiGitMergeLine,
  RiChat3Line,
  RiAddLine,
} from "@remixicon/react";
import { Button, ButtonLink } from "@/components/boardui/base/buttons/button";
import { IconButton } from "@/components/boardui/base/buttons/icon-button";
import { Input } from "@/components/boardui/base/input/input";
import { Textarea } from "@/components/boardui/base/textarea/textarea";
import { Chip } from "@/components/boardui/base/badges/chip";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/boardui/base/segmented-control/segmented-control";
import { AgentThinking } from "@/components/boardui/application/agent-thinking/agent-thinking";
import {
  artifactUrl,
  boardRequest,
  boardStatus,
  repoName,
  type BoardTask,
  type BoardSnapshot,
  type BoardAttempt,
} from "../board";
import { icons } from "./Icon";
import { Icon } from "./Icon";
import { ScrollRegion } from "./ScrollRegion";
import { cx } from "@/utils/cx";
import { ProjectBoardWorkspace } from "./ProjectBoardWorkspace";

function BoardDialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
  drawer = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  drawer?: boolean;
}) {
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="board-overlay"
    >
      <Modal className={cx("board-dialog", wide && "board-dialog-wide", drawer && "board-dialog-drawer")}>
        <Dialog
          aria-label={title}
          className="board-dialog-content outline-none"
        >
          <header className="board-dialog-header">
            <div>
              {subtitle && <span className="board-eyebrow">{subtitle}</span>}
              <h2>{title}</h2>
            </div>
            <IconButton
              size="small"
              icon={icons.close}
              onClick={onClose}
              aria-label="关闭对话框"
            />
          </header>
          <ScrollRegion className="board-dialog-scroll">
            {children}
          </ScrollRegion>
          {footer && <footer className="board-dialog-footer">{footer}</footer>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function NewTask({
  defaultRepo,
  onClose,
  onCreated,
  autoStart = true,
}: {
  defaultRepo: string;
  onClose: () => void;
  onCreated: (task: BoardTask) => void;
  autoStart?: boolean;
}) {
  const [repo, setRepo] = useState(() => {
    try {
      return localStorage.getItem("kumo-repo") || defaultRepo;
    } catch {
      return defaultRepo;
    }
  });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [checkCommand, setCheckCommand] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit() {
    setError("");
    setPending(true);
    try {
      const task = await boardRequest<BoardTask>("/api/board/tasks", {
        repo,
        title,
        description,
        acceptance,
        checkCommand,
        autoStart,
      });
      try {
        localStorage.setItem("kumo-repo", repo);
      } catch {
        /* Optional preference. */
      }
      onCreated(task);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <BoardDialog
      title="新增任务"
      subtitle="给 Agent 一个清楚的目标"
      onClose={onClose}
      footer={
        <>
          <span>加入待办后自动开始，完成后等待你验收。</span>
          <Button
            type="submit"
            form="new-task-form"
            leadingIcon={RiAddLine}
            disabled={pending}
          >
            {pending ? "正在加入…" : "加入待办"}
          </Button>
        </>
      }
    >
      <Form
        id="new-task-form"
        className="board-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          label="目标仓库"
          hint="本机 Git 仓库路径；Agent 基于当前分支的已提交代码，在独立工作区中执行。"
          value={repo}
          onChange={setRepo}
          isRequired
          name="repo"
        />
        <Input
          label="任务标题"
          placeholder="例如：为任务列表增加搜索"
          value={title}
          onChange={setTitle}
          isRequired
          maxLength={200}
          autoFocus
          name="title"
        />
        <Textarea
          label="任务要求"
          placeholder="描述你希望改变的行为，以及需要保留的行为。"
          value={description}
          onChange={setDescription}
          isRequired
          rows={4}
          maxLength={20000}
          name="description"
        />
        <Textarea
          label="验收条件"
          placeholder="例如：输入关键词后只显示匹配任务；清空输入恢复全部任务。"
          value={acceptance}
          onChange={setAcceptance}
          isRequired
          rows={3}
          maxLength={20000}
          name="acceptance"
        />
        <Input
          label="项目验证命令（可选）"
          placeholder="例如 npm test"
          hint="在任务工作区执行；Agent 还会独立检查验收条件。"
          value={checkCommand}
          onChange={setCheckCommand}
          maxLength={2000}
          name="checkCommand"
        />
        {error && (
          <p role="alert" className="board-error">
            {error}
          </p>
        )}
      </Form>
    </BoardDialog>
  );
}

function ArtifactPreview({
  task,
  attempt,
  file,
}: {
  task: BoardTask;
  attempt: BoardAttempt;
  file: string;
}) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setContent("");
    setError("");
    fetch(artifactUrl(task, attempt, file), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const value = await response.json();
          throw new Error(value.error || "文件暂不可用。");
        }
        return response.text();
      })
      .then((value) =>
        setContent(
          value.length > 120000
            ? value.slice(0, 120000) + "\n[预览已截断，可打开完整文件。]"
            : value || "此文件为空。",
        ),
      )
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [task.id, attempt.number, file]);
  return (
    <div className="board-artifact-preview">
      <div>
        <strong>{file}</strong>
        <ButtonLink
          size="xs"
          variant="secondary"
          href={artifactUrl(task, attempt, file)}
          target="_blank"
          rel="noreferrer"
          trailingIcon={icons.arrow}
        >
          完整文件
        </ButtonLink>
      </div>
      {error ? (
        <p role="alert" className="board-error">
          {error}
        </p>
      ) : (
        <pre>{content || "正在读取…"}</pre>
      )}
    </div>
  );
}

function TaskDetail({
  task,
  onClose,
  onRefresh,
}: {
  task: BoardTask;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState("report");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [file, setFile] = useState("git-diff.patch");
  const latest = task.attempts.at(-1);
  const [attemptNumber, setAttemptNumber] = useState(latest?.number || 1);
  useEffect(() => {
    setAttemptNumber(latest?.number || 1);
    setConfirmMerge(false);
  }, [latest?.number, task.headSha]);
  const attempt =
    task.attempts.find((item) => item.number === attemptNumber) || latest;
  const report = attempt?.verification;
  const historical = attempt?.number !== latest?.number;
  const shownHead = attempt?.headSha || task.headSha;
  const reviewFeedback = task.messages
    .filter(
      (message) =>
        message.role === "user" &&
        message.text !== task.description &&
        message.text !== "验收通过，等待手动合入。" &&
        (!attempt || message.at <= attempt.startedAt),
    )
    .at(-1);
  const busy = ["queued", "running", "verifying"].includes(task.status);
  const canRework = ["review", "blocked", "approved"].includes(task.status);
  async function action(name: string, body: unknown = {}) {
    setPending(true);
    setError("");
    try {
      await boardRequest(`/api/board/tasks/${task.id}/${name}`, body);
      setConfirmMerge(false);
      setFeedback("");
      await onRefresh();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <BoardDialog
      title={task.title}
      subtitle={`${repoName(task.repo)} · ${task.targetBranch}`}
      onClose={onClose}
      wide
      drawer
      footer={
        <>
          <span>
            {historical
              ? "正在查看历史报告，请回到最新报告后验收。"
              : task.status === "approved"
                ? "你已验收。合入仍需你确认。"
                : task.status === "merged"
                  ? "代码已合入目标分支。"
                  : "验收通过后，才会开放合入操作。"}
          </span>
          {historical && (
            <Button
              size="small"
              variant="secondary"
              onClick={() => setAttemptNumber(latest?.number || 1)}
            >
              最新报告
            </Button>
          )}
          {task.status === "review" && (
            <Button
              leadingIcon={icons.check}
              disabled={pending || attemptNumber !== latest?.number}
              onClick={() => void action("approve", { headSha: task.headSha })}
            >
              验收通过
            </Button>
          )}
          {task.status === "approved" && (
            <Button
              leadingIcon={RiGitMergeLine}
              disabled={pending || historical}
              onClick={() => {
                setConfirmMerge(true);
                setTab("report");
              }}
            >
              合入代码
            </Button>
          )}
        </>
      }
    >
      <div className="board-detail-body">
        <div className="board-detail-status">
          <Chip color={boardStatus[task.status].color}>
            {boardStatus[task.status].label}
          </Chip>
          <span>第 {task.attempts.length || 0} 次执行</span>
          {shownHead && (
            <span className="mono" title={shownHead}>
              {historical ? "报告版本" : "版本"} {shownHead.slice(0, 8)}
            </span>
          )}
        </div>
        <SegmentedControl
          aria-label="任务详情视图"
          selectedKeys={[tab]}
          onSelectionChange={(keys) => setTab(String([...keys][0]))}
        >
          <SegmentedControlItem id="report">验收报告</SegmentedControlItem>
          <SegmentedControlItem id="conversation">讨论</SegmentedControlItem>
          <SegmentedControlItem id="history">执行记录</SegmentedControlItem>
        </SegmentedControl>
        {error && (
          <p role="alert" className="board-error">
            {error}
          </p>
        )}
        {task.error && <p className="board-error">{task.error}</p>}
        {confirmMerge && (
          <div className="board-merge-confirm">
            <strong>确认合入这个版本？</strong>
            <p>
              将 {task.headSha?.slice(0, 8)} 合入本地仓库 {repoName(task.repo)}{" "}
              的 {task.targetBranch} 分支。此操作不推送远端。
            </p>
            <div>
              <Button
                size="small"
                variant="secondary"
                onClick={() => setConfirmMerge(false)}
              >
                取消
              </Button>
              <Button
                size="small"
                leadingIcon={RiGitMergeLine}
                disabled={pending}
                onClick={() => void action("merge", { headSha: task.headSha })}
              >
                确认合入
              </Button>
            </div>
          </div>
        )}
        {tab === "report" && (
          <>
            <section className="board-detail-section">
              <h3>这次要完成什么</h3>
              <p>{task.description}</p>
              <h3>{reviewFeedback ? "初始验收条件" : "验收条件"}</h3>
              <p>{task.acceptance}</p>
              {reviewFeedback && (
                <>
                  <h3>本轮修改意见</h3>
                  <p>{reviewFeedback.text}</p>
                </>
              )}
            </section>
            <section className="board-detail-section">
              <div className="board-section-heading">
                <h3>第 {attempt?.number || 1} 次验证报告</h3>
                {report && (
                  <Chip
                    variant="caption"
                    color={report.verdict === "passed" ? "lime" : "rose"}
                  >
                    {report.verdict === "passed"
                      ? "独立验证通过"
                      : report.verdict === "failed"
                        ? "验证未通过"
                        : "验证受阻"}
                  </Chip>
                )}
              </div>
              {busy && attempt?.number === latest?.number ? (
                <>
                  <AgentThinking
                    showTimer={false}
                    label={
                      task.status === "queued"
                        ? "任务已排队，Agent 会自动领取"
                        : task.status === "verifying"
                          ? "正在独立验证，尚未产生最终报告"
                          : "Agent 正在开发，完成后会进行独立验证"
                    }
                  />
                  {task.activity?.length ? (
                    <div className="board-conversation" aria-live="polite">
                      {task.activity.map((message, index) => (
                        <article
                          key={index}
                          className="board-discussion-message board-message-agent"
                        >
                          <strong>
                            {message.role === "verifier"
                              ? "验证 Agent"
                              : "开发 Agent"}
                          </strong>
                          <p>{message.text}</p>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : report ? (
                <>
                  <p>{report.summary}</p>
                  <ul className="board-checks">
                    {report.checks.map((check, index) => (
                      <li key={index}>
                        <Icon
                          name={
                            check.status === "passed" ? "check" : "activity"
                          }
                          size={16}
                        />
                        <div>
                          <strong>{check.name}</strong>
                          <p>{check.evidence}</p>
                        </div>
                        <Chip
                          variant="caption"
                          color={check.status === "passed" ? "lime" : "rose"}
                        >
                          {check.status === "passed" ? "通过" : "未通过"}
                        </Chip>
                      </li>
                    ))}
                  </ul>
                  <div className="board-check-command">
                    <span>项目验证命令</span>
                    <strong>{task.checkCommand || "未指定额外命令"}</strong>
                    {task.checkCommand && (
                      <Chip
                        variant="caption"
                        color={attempt?.checkExitCode === 0 ? "lime" : "rose"}
                      >
                        {attempt?.checkExitCode === 0
                          ? "通过"
                          : attempt?.checkExitCode == null
                            ? "未执行"
                            : "失败"}
                      </Chip>
                    )}
                  </div>
                </>
              ) : (
                <p>尚无验证报告。执行日志会保留失败原因。</p>
              )}
            </section>
            {attempt?.evidenceDir && attempt.finishedAt && (
              <section className="board-detail-section">
                <h3>代码与证据</h3>
                <div className="board-artifact-buttons">
                  {[
                    "git-diff.patch",
                    "worker.log",
                    "verifier.log",
                    ...(task.checkCommand ? ["check.log"] : []),
                  ].map((name) => (
                    <Button
                      size="small"
                      variant={file === name ? "ghost" : "secondary"}
                      key={name}
                      onClick={() => setFile(name)}
                    >
                      {name === "git-diff.patch"
                        ? "代码差异"
                        : name === "worker.log"
                          ? "开发日志"
                          : name === "verifier.log"
                            ? "验证日志"
                            : "命令输出"}
                    </Button>
                  ))}
                </div>
                <ArtifactPreview task={task} attempt={attempt} file={file} />
              </section>
            )}
          </>
        )}
        {tab === "conversation" && (
          <>
            <div className="board-conversation">
              {task.messages.map((message, index) => (
                <article
                  key={index}
                  className={cx(
                    "board-discussion-message",
                    `board-message-${message.role}`,
                  )}
                >
                  <div>
                    <strong>
                      {message.role === "user"
                        ? "你"
                        : message.role === "agent"
                          ? "Agent"
                          : "任务进度"}
                    </strong>
                    <time dateTime={message.at}>
                      {new Date(message.at).toLocaleString("zh-CN", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
            {canRework && (
              <Form
                className="board-feedback"
                onSubmit={(event) => {
                  event.preventDefault();
                  void action("rework", { text: feedback });
                }}
              >
                <Textarea
                  label="告诉 Agent 还需要改什么"
                  hint="提交后回到待办，在原工作区继续开发，并重新生成验证报告。"
                  value={feedback}
                  onChange={setFeedback}
                  rows={4}
                  isRequired
                  maxLength={20000}
                />
                <Button
                  type="submit"
                  leadingIcon={RiChat3Line}
                  disabled={pending}
                >
                  发送并继续开发
                </Button>
              </Form>
            )}
            {busy && (
              <p className="board-detail-hint">
                本轮正在执行。完成后可以在这里提交修改意见。
              </p>
            )}
          </>
        )}
        {tab === "history" && (
          <div className="board-history">
            {[...task.attempts].reverse().map((item) => (
              <article key={item.number}>
                <div>
                  <strong>第 {item.number} 次执行</strong>
                  <Chip
                    variant="caption"
                    color={
                      item.status === "passed"
                        ? "lime"
                        : item.finishedAt
                          ? "rose"
                          : "blue"
                    }
                  >
                    {item.status === "passed"
                      ? "验证通过"
                      : item.finishedAt
                        ? "未通过"
                        : "进行中"}
                  </Chip>
                </div>
                <p>
                  {item.verification?.summary || item.error || "正在执行任务…"}
                </p>
                <span>{new Date(item.startedAt).toLocaleString("zh-CN")}</span>
                {item.worktree && (
                  <p className="board-path mono">{item.worktree}</p>
                )}
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => {
                    setAttemptNumber(item.number);
                    setTab("report");
                  }}
                >
                  查看第 {item.number} 次报告
                </Button>
              </article>
            ))}
            {task.attempts.length === 0 && (
              <p>Agent 领取任务后，会在这里留下每轮记录。</p>
            )}
          </div>
        )}
        {canRework && tab === "report" && (
          <Button
            variant="secondary"
            leadingIcon={RiChat3Line}
            onClick={() => setTab("conversation")}
          >
            还不满足？提交修改意见
          </Button>
        )}
      </div>
    </BoardDialog>
  );
}

export function TaskBoard({ onDemo }: { onDemo: () => void }) {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newTaskAutoStart, setNewTaskAutoStart] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("kumo-theme") === "dark";
    } catch {
      return false;
    }
  });
  const revision = useRef(-1);
  const mounted = useRef(true);
  async function refresh(signal?: AbortSignal) {
    const next = await boardRequest<BoardSnapshot>(
      "/api/board",
      undefined,
      signal,
    );
    if (!mounted.current) return;
    if (next.revision >= revision.current) {
      revision.current = next.revision;
      setSnapshot(next);
    }
    setError("");
  }
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const load = () =>
      refresh(controller.signal).catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    void load();
    const interval = setInterval(() => {
      if (!document.hidden) void load();
    }, 2000);
    return () => {
      mounted.current = false;
      controller.abort();
      clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("kumo-theme", dark ? "dark" : "light");
    } catch {
      /* Optional preference. */
    }
  }, [dark]);
  const tasks = snapshot?.tasks || [];
  const selected = tasks.find((task) => task.id === selectedId);
  return (
    <>
      <ProjectBoardWorkspace snapshot={snapshot} error={error} search={search} onSearch={setSearch} dark={dark} onThemeChange={setDark} onDemo={onDemo} onCreate={(backlog) => { setNewTaskAutoStart(!backlog); setShowNew(true); }} onOpenTask={setSelectedId} onMove={async (id, status) => { try { await boardRequest(`/api/board/tasks/${id}/move`, { status }); await refresh(); } catch (reason) { setError((reason as Error).message); } }} />
      {showNew && snapshot && (
        <NewTask
          defaultRepo={snapshot.defaultRepo}
          autoStart={newTaskAutoStart}
          onClose={() => setShowNew(false)}
          onCreated={(task) => {
            setShowNew(false);
            setSelectedId(task.id);
            void refresh().catch((reason) => setError(reason.message));
          }}
        />
      )}
      {selected && (
        <TaskDetail
          key={selected.id}
          task={selected}
          onClose={() => setSelectedId(null)}
          onRefresh={refresh}
        />
      )}
    </>
  );
}

export function BackToBoard({ onClick }: { onClick: () => void }) {
  return (
    <Button
      size="small"
      variant="secondary"
      leadingIcon={RiArrowLeftLine}
      className="back-to-board"
      onClick={onClick}
    >
      返回任务看板
    </Button>
  );
}
