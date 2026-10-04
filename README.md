# rowask

Natural-language filter beside a local SQLite table (`data/demo.sqlite`). Laya may see the question and the column names only. Row values stay in SQLite and are never included in the sidecar request. After Laya picks a safe filter, each row gets a local match score and a local 0/1 noul. Those numbers are match bits, not model scores. If `min_confidence` abstains (or the choice is `none`), the abstain lane runs no filter and attaches no scores.

If the sidecar is down or the checkpoint is not loaded, the API and the page say `Laya not running`. They do not invent scores.

## Run

```bash
python3 -m pip install laya
python3 sidecar.py
```

The sidecar listens on `127.0.0.1:4011` and calls `Router.predict` in-process. `LAYA_SERVE_BACKEND` is set to `laya`. A different value is refused. The first `/predict` downloads weights from `huggingface.co/convaiinnovations/laya`. Booting the sidecar does not download them.

In another shell:

```bash
bun install && bun run start
```

UI: `http://127.0.0.1:3011`. `bun run dev` watches files. `bun run build` bundles the server without weights.

Abstention uses `min_confidence` (0.6). The app does not read `action.act_probability`.
