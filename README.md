# task-board

他フォルダで並行作業するエージェントが、スレッド (作業セッション) 単位でタスク進捗を
**API Post** していくローカルボード。プロジェクトを縦に積み、プロジェクト内のスレッドを
2列で並べる VSCode Explorer 風レイアウト。

## アーキテクチャ (軽量・依存ゼロ)

- `node:http` + `node:sqlite` の**単一プロセス**。ビルド工程なし。
- ランタイム依存パッケージ **0** (`node_modules` 不要)。フロントは静的 HTML + バニラ JS。
- ドラッグ並べ替えのみ [SortableJS](https://sortablejs.github.io/Sortable/) を `src/public/vendor/` に同梱 (オフライン動作)。
- DB: `data/board.db` (gitignore 済、起動時に自動生成)。
- **Port 8111 固定** (環境変数 `PORT` で変更可)。Node 22.5+ 必須。

## 起動

```bash
node server.mjs        # または npm start  → http://localhost:8111
```

`npm install` は不要。起動は数十 ms。

## レイアウト

- **プロジェクト = 1 行**を縦に積む。ヘッダのキャレットで開閉。プロジェクト名を掴むと縦に並べ替え。
- **スレッド = 2 列グリッド**。各カードに `Port / Current / Next / Memo`。
- ポートバッジを掴むとカードをドラッグ (プロジェクト間移動も可)。
- 5 秒ごとに自動更新。OS のダーク/ライトに追従。

## API

| Method | Path | 役割 |
|--------|------|------|
| `POST` | `/api/threads` | 進捗を upsert (エージェントはこれだけ叩く) |
| `GET`  | `/api/board` | 全プロジェクト + カードを取得 |
| `DELETE` | `/api/threads/:id` | カード削除 |
| `PATCH` | `/api/projects/:id` | 折りたたみ等の更新 |
| `POST` | `/api/board/reorder` | 並べ替えの永続化 (UI 用) |

### 進捗を Post する

`(project, thread)` の組で upsert。同じ組に再 Post すると上書き。プロジェクトは自動作成。

```bash
curl -X POST localhost:8111/api/threads \
  -H "content-type: application/json" \
  -d '{
    "project": "benchmark_app",
    "thread": "sess-a1",
    "port": 3000,
    "current": "データ品質、セグ別自社データ表示",
    "next": "EDINET セグデータ取り込み",
    "memo": "PR #525 レビュー待ち"
  }'
```

`project` と `thread` が必須、`port` / `current` / `next` / `memo` は任意。

`thread` キーの運用: セッション固有 ID を入れると 1 セッション = 1 カード、用途名
(`main` / `worker` 等) を入れると同じカードを更新し続ける。プロジェクト内で一意ならどちらでも可。

### ヘルパ (任意)

```bash
TB_PROJECT=benchmark_app TB_THREAD=sess-a1 TB_CURRENT="作業中" node tools/post.mjs
node tools/seed_dev.mjs    # 開発用サンプル投入
```

## テスト

```bash
node --test        # または npm test  (board ロジック + バリデーション、in-memory sqlite)
```

## ファイル構成

```
server.mjs              HTTP サーバー (静的配信 + API ルーティング)
src/lib/db.mjs          node:sqlite 初期化 + スキーマ
src/lib/board.mjs       ボードのクエリ (upsert / getBoard / reorder / delete)
src/lib/validate.mjs    軽量バリデーション (zod 代替)
src/public/             index.html / styles.css / app.js / vendor/Sortable.min.js
test/board.test.mjs     node:test
tools/                  post.mjs / seed_dev.mjs / kill_port_8111.ps1
```
