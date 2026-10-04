import { describe, expect, test } from "bun:test";
import { SEED, layaState, planFilter, scoreRows, type Row } from "./filter.ts";
import { NOT_RUNNING } from "./laya.ts";

const rows: Row[] = SEED.map((r) => ({ ...r }));

describe("rowask", () => {
  test("state sent to Laya is question and column names only", () => {
    const state = layaState("status is open");
    expect(Object.keys(state).sort()).toEqual(["columns", "question"]);
    const blob = JSON.stringify(state);
    for (const secret of ["ada", "ben", "chen", "dara", "noor", "t1", "t8"]) {
      expect(blob.includes(secret)).toBe(false);
    }
    expect(state.columns).toEqual(["status", "priority", "region", "age_days", "owner"]);
  });

  test("sidecar down abstains with the exact phrase and no scores", () => {
    const plan = planFilter("status is open", { ok: false, error: NOT_RUNNING });
    expect(plan.filter).toBeNull();
    expect(plan.reason).toBe("Laya not running");
  });

  test("low confidence runs no filter", () => {
    const plan = planFilter("status is open", {
      ok: true,
      model: "english",
      usage: null,
      routing: null,
      answers: {
        column: { type: "choice", choice: "status", abstention: "abstained", low_confidence: true, answer_confidence: 0.2 },
        operator: { type: "choice", choice: "eq", abstention: "passed", answer_confidence: 0.9 },
        status_value: { type: "choice", choice: "open", abstention: "passed", answer_confidence: 0.9 },
      },
    });
    expect(plan.abstained).toBe(true);
    expect(plan.filter).toBeNull();
  });

  test("a passed filter gets local scores, not invented model scores", () => {
    const plan = planFilter("status is open", {
      ok: true,
      model: "english",
      usage: null,
      routing: null,
      answers: {
        column: { type: "choice", choice: "status", abstention: "passed", answer_confidence: 0.9 },
        operator: { type: "choice", choice: "eq", abstention: "passed", answer_confidence: 0.9 },
        status_value: { type: "choice", choice: "open", abstention: "passed", answer_confidence: 0.9 },
      },
    });
    expect(plan.filter).toEqual({ column: "status", op: "eq", value: "open" });
    const scored = scoreRows(rows, plan.filter!);
    expect(scored.every((r) => r.local_score === 0 || r.local_score === 1)).toBe(true);
    expect(scored.filter((r) => r.local_noul === 1).map((r) => r.id).sort()).toEqual(["t1", "t2", "t5", "t8"]);
  });

  test("owner value comes from the question, not from a row scan", () => {
    const plan = planFilter("owner ada", {
      ok: true,
      model: "english",
      usage: null,
      routing: null,
      answers: {
        column: { type: "choice", choice: "owner", abstention: "passed", answer_confidence: 0.91 },
        operator: { type: "choice", choice: "eq", abstention: "passed", answer_confidence: 0.9 },
      },
    });
    expect(plan.filter).toEqual({ column: "owner", op: "eq", value: "ada" });
  });
});
