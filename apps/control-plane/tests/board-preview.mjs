// A real temporary Git repository for driving the built task board in a browser.
// Default: deterministic worker/verifier fixtures. --codex: the installed Codex CLI.
import { boardFixture } from "./board-fixture.mjs";
import { createTaskBoard } from "../server/task-board.mjs";
import { createControlPlane } from "../server/server.mjs";

const fixture = await boardFixture();
let board = fixture.board;
if (process.argv.includes("--codex")) {
  await board.close();
  board = await createTaskBoard({
    dataDir: fixture.dataDir,
    defaultRepo: fixture.repo,
  });
}
const { server } = await createControlPlane({ board });
const port = Number(process.env.HARNESS_PREVIEW_PORT || 8788);
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
}).catch(async (error) => {
  await board.close();
  await fixture.cleanup();
  throw error;
});
console.log(
  JSON.stringify({
    url: `http://127.0.0.1:${port}`,
    root: fixture.root,
    repo: fixture.repo,
    runner: (await board.snapshot()).runner,
  }),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await board.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fixture.cleanup();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
