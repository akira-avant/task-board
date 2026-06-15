# task-board — エージェント向け投稿ガイド

このファイルは、**他フォルダで作業するエージェント (Claude Code 等) が読む**ためのもの。
自分の作業進捗を task-board に Post すると、`http://localhost:8111` のボードに
プロジェクト別・スレッド別に表示される。

## 何をすればいいか (1 行)

作業の節目で `POST http://localhost:8111/api/threads` に現状を投げるだけ。

## API 契約

`POST http://localhost:8111/api/threads` — Content-Type: `application/json`

| フィールド | 必須 | 型 | 意味 |
|-----------|------|----|------|
| `project` | ✅ | string | プロジェクト名 = だいたいフォルダ名 (例 `benchmark_app`)。ボードの 1 行になる。 |
| `thread`  | ✅ | string | スレッド識別子 (下記)。`project` 内で一意。 |
| `port`    | — | number | dev server 等のポート。無ければ省略。 |
| `current` | — | string | 今やっていること。 |
| `next`    | — | string | 次にやること。 |
| `memo`    | — | string | 補足 (PR 番号・ブロッカー等)。 |

**upsert される**: 同じ `(project, thread)` に再 Post すると**上書き更新**。`project` は無ければ自動作成。
だから「節目ごとに最新状態を上書き投稿」で OK。履歴は残らない (最新のみ)。

### `thread` キーの決め方

- **1 セッション = 1 カードにしたい** → セッション固有の値 (例 `sess-20260615-a1`)。毎回別カード。
- **同じ作業を更新し続けたい** → 用途名 (例 `main` / `worker` / `migration`)。同じカードを上書き。

迷ったら用途名 (`main` 等) で十分。乱立させないこと。

## いつ Post するか

- タスク開始時 (`current` をセット、`next` に予定)
- マイルストーン到達・方針転換時 (`current` を更新)
- 行き詰まり / レビュー待ち (`memo` に状況)
- セッション終了時 (最終状態を上書き)

ボードが落ちていても (server 未起動) **作業は止めない**。Post 失敗は握りつぶしてよい。

## 投稿方法 (Windows で確実なやり方)

### ⚠ 落とし穴: curl の `-d` に日本語を直書きしない

Windows の shell (cp932 / Git Bash) 経由だと、`curl -d '{"current":"日本語"}'` は
マルチバイトが壊れて `invalid JSON` (400) になることがある。**日本語を含むなら下記のどれか**を使う。

### 方法 A (推奨): JSON ファイルを書いて `--data-binary @`

ファイルは UTF-8 で保存されるので文字化けしない。

```bash
# payload.json を UTF-8 で用意してから:
curl -s -X POST http://localhost:8111/api/threads \
  -H "content-type: application/json" \
  --data-binary @payload.json
```

`payload.json` の中身:

```json
{
  "project": "benchmark_app",
  "thread": "main",
  "port": 3000,
  "current": "データ品質、セグ別自社データ表示",
  "next": "EDINET セグデータ取り込み",
  "memo": "PR #525 レビュー待ち"
}
```

### 方法 B: 同梱ヘルパ `post.mjs`

```bash
TB_PROJECT=benchmark_app TB_THREAD=main TB_PORT=3000 \
TB_CURRENT="作業中の内容" TB_NEXT="次の作業" TB_MEMO="メモ" \
node "C:\Users\akira.motogami\workspace\task-board\tools\post.mjs"
```

(`TB_URL` で接続先を変更可。デフォルト `http://localhost:8111`)

### 方法 C: 英数字だけなら curl 直書きで OK

```bash
curl -s -X POST http://localhost:8111/api/threads \
  -H "content-type: application/json" \
  -d '{"project":"benchmark_app","thread":"main","current":"refactor db layer"}'
```

## 自分の CLAUDE.md に入れる運用ルール (任意)

各プロジェクトの `CLAUDE.md` に以下を足すと、毎セッション自動で進捗が乗る:

```markdown
## task-board への進捗共有

作業の節目 (開始 / マイルストーン / 行き詰まり / 終了) で、現状を task-board に Post する。
- エンドポイント: `POST http://localhost:8111/api/threads`
- project = このフォルダ名、thread = "main" (用途別に分けたい時のみ変える)
- 日本語を含むので、curl -d 直書きは避け、JSON ファイル + `--data-binary @` か
  `node C:\Users\akira.motogami\workspace\task-board\tools\post.mjs` を使う
- 詳細は task-board/AGENTS.md
```

## ボードの確認

ブラウザで `http://localhost:8111`。プロジェクト=縦の行、スレッド=2 列カード。
5 秒ごとに自動更新されるので、Post すれば数秒で反映される。
