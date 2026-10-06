import { useEffect, useReducer, useState } from "react";
import {
  connectHarnessEvents,
  type ConnectionStatus,
} from "./adapters/harness-events";
import { AgentChat } from "./components/AgentChat";
import { AgentList } from "./components/AgentList";
import { EvidencePanel } from "./components/EvidencePanel";
import { Icon, icons } from "./components/Icon";
import { RunHeader } from "./components/RunHeader";
import {
  applyEvent,
  deriveAgentRows,
  initialRunState,
  type RunState,
} from "./store";
import type { HarnessEvent } from "./types";
import { IconButton } from "@/components/boardui/base/buttons/icon-button";
import { Chip } from "@/components/boardui/base/badges/chip";
import { cx } from "@/utils/cx";
import { BackToBoard, TaskBoard } from "./components/TaskBoard";

type Action = { type: "reset" } | { type: "event"; event: HarnessEvent };
function reducer(state: RunState, action: Action): RunState {
  return action.type === "reset"
    ? initialRunState
    : applyEvent(state, action.event);
}

export function App() {
  const [demo, setDemo] = useState(false);
  return demo ? (
    <>
      <BackToBoard onClick={() => setDemo(false)} />
      <RunWorkspace />
    </>
  ) : (
    <TaskBoard onDemo={() => setDemo(true)} />
  );
}

function RunWorkspace() {
  const [state, dispatch] = useReducer(reducer, initialRunState);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [mode, setMode] = useState<"mock" | "live" | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(
    () => window.matchMedia("(min-width: 981px)").matches,
  );
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("kumo-theme") === "dark";
    } catch {
      return false;
    }
  });
  const selectedAgent =
    deriveAgentRows(state).find((row) => row.key === selectedKey) ?? null;

  useEffect(
    () =>
      connectHarnessEvents(
        () => {
          dispatch({ type: "reset" });
          setSelectedKey(null);
        },
        (event) => dispatch({ type: "event", event }),
        setConnection,
      ),
    [],
  );

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 980px)");
    const onChange = () => {
      if (narrow.matches) setShowEvidence(false);
    };
    narrow.addEventListener("change", onChange);
    return () => narrow.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("kumo-theme", dark ? "dark" : "light");
    } catch {
      /* Optional preference. */
    }
  }, [dark]);

  useEffect(() => {
    if (connection !== "connected") return;
    const controller = new AbortController();
    fetch("/api/runs", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) =>
        setMode(
          data?.mode === "mock"
            ? "mock"
            : data?.mode === "live"
              ? "live"
              : null,
        ),
      )
      .catch(() => {});
    return () => controller.abort();
  }, [connection, state.runId]);

  return (
    <div className="app">
      <a className="skip-link" href="#conversation">
        Skip to conversation
      </a>
      <AgentList
        run={state}
        selectedKey={selectedAgent?.key ?? null}
        onSelect={setSelectedKey}
        dark={dark}
        onTheme={() => setDark(!dark)}
      />
      <main className="workspace">
        <div className="workspace-bar">
          <div className="breadcrumb">
            <Icon name="grid" size={16} />
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>Multi-agent run</strong>
          </div>
          <div className="workspace-actions">
            {mode === "mock" && (
              <Chip variant="caption" color="soft">
                Demo run
              </Chip>
            )}
            <span
              className={cx("connection", `connection-${connection}`)}
              role="status"
            >
              <span className="dot" />
              {connection === "connected"
                ? "Connected"
                : connection === "reconnecting"
                  ? "Reconnecting…"
                  : "Connecting…"}
            </span>
            <IconButton
              size="small"
              icon={icons.panel}
              className={cx(showEvidence && "bg-background-secondary-default")}
              onClick={() => setShowEvidence(!showEvidence)}
              aria-label={
                showEvidence ? "Hide evidence panel" : "Show evidence panel"
              }
              aria-expanded={showEvidence}
              aria-controls="evidence-panel"
            />
          </div>
        </div>
        <RunHeader run={state} />
        <div className={cx("columns", !showEvidence && "evidence-hidden")}>
          <AgentChat
            run={state}
            selectedAgent={selectedAgent}
            onClearSelection={() => setSelectedKey(null)}
            connection={connection}
          />
          {showEvidence && (
            <>
              <button
                className="evidence-backdrop"
                aria-label="Dismiss evidence overlay"
                onClick={() => setShowEvidence(false)}
              />
              <EvidencePanel
                run={state}
                mode={mode}
                onClose={() => setShowEvidence(false)}
              />
            </>
          )}
        </div>
        <footer className="workspace-footer">
          <span>
            <span className="dot" />
            {mode === "mock"
              ? "Scripted demo · sample artifacts"
              : mode === "live"
                ? "Live harness event stream"
                : "Waiting for event source"}
          </span>
          <span>Built for a few minds to work together.</span>
        </footer>
      </main>
    </div>
  );
}
