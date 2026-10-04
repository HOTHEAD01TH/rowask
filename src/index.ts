import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { SEED, layaQuestions, layaState, planFilter, scoreRows, type Row } from "./filter.ts";
import { NOT_RUNNING, predict, sidecarHealth } from "./laya.ts";

const PORT = 3011;
const db = new Database(new URL("../data/demo.sqlite", import.meta.url).pathname);
db.run(`CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  region TEXT NOT NULL,
  age_days INTEGER NOT NULL,
  owner TEXT NOT NULL
)`);
const count = db.query("SELECT COUNT(*) AS n FROM tickets").get() as { n: number };
if (count.n === 0) {
  const insert = db.query(
    "INSERT INTO tickets (id, status, priority, region, age_days, owner) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const row of SEED) insert.run(row.id, row.status, row.priority, row.region, row.age_days, row.owner);
}

function allRows(): Row[] {
  return db.query("SELECT id, status, priority, region, age_days, owner FROM tickets ORDER BY id").all() as Row[];
}

const app = new Hono();
const page = await Bun.file(new URL("../public/index.html", import.meta.url)).text();

app.get("/", (c) => c.html(page));

app.get("/api/health", async (c) => {
  const health = await sidecarHealth();
  if (!health.loaded) return c.json({ loaded: false, error: NOT_RUNNING });
  return c.json({ loaded: true, error: null });
});

app.get("/api/rows", (c) => c.json({ rows: allRows(), scores: null }));

app.post("/api/filter", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof raw?.question === "string" ? raw.question.trim() : "";
  if (!question || question.length > 500) return c.json({ error: "question is required" }, 400);
  const state = layaState(question);
  const result = await predict(state, layaQuestions());
  const plan = planFilter(question, result);
  if (!result.ok) {
    return c.json({
      error: NOT_RUNNING,
      abstained: true,
      filter: null,
      rows: allRows(),
      sent: state,
    });
  }
  if (plan.abstained || !plan.filter) {
    return c.json({
      error: null,
      abstained: true,
      filter: null,
      rows: allRows(),
      sent: state,
      model: result.model,
    });
  }
  return c.json({
    error: null,
    abstained: false,
    filter: plan.filter,
    rows: scoreRows(allRows(), plan.filter),
    sent: state,
    model: result.model,
  });
});

if (import.meta.main) {
  Bun.serve({ hostname: "127.0.0.1", port: PORT, fetch: app.fetch });
  console.log(`rowask listening on http://127.0.0.1:${PORT}`);
}
