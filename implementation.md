# Yahoo Finance Watchlist の実装

Chrome の Manifest V3 拡張として、Yahoo Finance のページを専用ウィンドウで開く。
サイトが描画した Dock を同じ DOM 内に保持し、CSS でページ本体を隠す。
Dock の銘柄情報やメニュー操作は Yahoo Finance のページが処理する。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| [manifest.json](manifest.json) | 拡張アイコン、サービスワーカー、Options ページ、権限を登録する |
| [background.js](background.js) | ウィンドウの起動、専用タブの管理、ファイルの注入、幅の調整を行う |
| [config.js](config.js) | 既定値、入力範囲、Watchlist URL の判定を定義する |
| [content.js](content.js) | Dock の開閉を判定し、専用表示を有効にする |
| [styles.css](styles.css) | 専用ウィンドウ内で Dock を配置し、スクロールバーを細くする |
| [options.html](options.html)、[options.js](options.js)、[options.css](options.css) | 英語の設定画面を表示し、設定の検証と保存を行う |

## 設定と保存先

Options は `chrome.storage.local` の `watchlistDockSettings` に、`watchlistUrl`、`windowWidth`、`windowHeight` を保存する。
既定値は `https://finance.yahoo.com/watchlists`、幅 400 px、高さ 900 px で、幅は 240〜1600、高さは 400〜1400 の整数を受け付ける。
フォームは入力が不正なときに保存を中断し、該当欄にフォーカスを戻す。
設定の読み込み時は、欠落または不正な項目ごとに既定値を使う。

URL は HTTPS の `finance.yahoo.com` に限定し、`/watchlists` または `/watchlist/` に続くパスを受け付ける。
判定時はパス末尾のスラッシュを取り除き、クエリとフラグメントはパス判定に使わない。
保存する URL にはクエリとフラグメントを保持する。
`config.js` は Options、サービスワーカー、コンテンツスクリプトで共通に使う。

専用ウィンドウの管理情報は `chrome.storage.session` の `managedWatchlistWindow` に保存する。
管理情報にはタブ ID、ウィンドウ ID、注入済みの URL、起動後の幅調整に使う値を含める。
対象のタブやウィンドウを閉じると、サービスワーカーが管理情報を取り除く。

## ウィンドウの起動と再読み込み

1. 拡張アイコンを押すと、サービスワーカーが設定を読む。管理中のポップアップがあれば前面に出し、そのタブが対象外の URL を開いている場合は設定 URL に戻す。
2. 新規起動時は `chrome.windows.create()` で `about:blank` のポップアップを作る。幅は 1100 px、高さは設定値とし、タブ ID を登録してから設定 URL へ遷移させる。
3. 読み込みが完了したら、管理中のタブ ID、ウィンドウ ID、ポップアップ種別、URL を照合する。対象タブに `styles.css` を挿入し、`config.js` と `content.js` を順に実行する。
4. コンテンツスクリプトが Dock を検出し、閉じている場合は **Open dock** ボタンを DOM の `click()` で押す。展開を確認すると `html` に `ywm-compact-view` を付け、レイアウト反映後に `YWM_DOCK_READY` を送る。
5. サービスワーカーが送信元のフレーム、タブ ID、ウィンドウ ID と現在の URL を確認し、初回起動時の幅を設定値に変更する。

狭い幅では Yahoo Finance が Dock を折りたたみ、開閉ボタンの構成も変わる。
再読み込み後に幅が 1000 px 未満なら、サービスワーカーはその幅を記録し、注入前に幅を 1100 px に広げる。
Dock が準備できたら記録済みの幅に戻すため、利用者が手動で調整した幅も復元の対象になる。
高さはポップアップを作るときに指定する。

タブごとのキューは、再読み込みに伴う注入記録の更新、ファイルの注入、準備完了メッセージの処理を直列に実行する。
コンテンツスクリプトは同じページにコントローラーを重複登録しない。

## Dock の検出と表示

`content.js` は `aside#right-rail[aria-label="Dock"]` の下にある `[role="dialog"][aria-label="Dock"]` と `[data-testid="dock"]` を探す。
ダイアログの `isCollapsed` クラス、Dock と開閉ボタンの表示状態を確認し、要素が遅れて描画される場合は `MutationObserver` で変化を待つ。
最初の開閉判定には最大 12 秒、クリック後の展開確認には最大 10 秒を使う。
準備に失敗した場合はページを専用表示へ切り替えず、通知を 9 秒表示する。

`styles.css` は `html.ywm-compact-view` を起点にヘッダーやページ本体を隠し、Dock をウィンドウの先頭に全幅で配置する。
Dock の固定位置や折りたたみ時の変形を上書きするため、幅を縮めても DOM に残っている Dock を表示できる。
縦スクロールはページ全体で行い、ルートの `::-webkit-scrollbar` に 6 px 幅を指定する。

この処理は Yahoo Finance の DOM 構造と開閉ボタンのラベルに依存する。
Dock が表示されなくなった場合は、まず `findDockParts()` のセレクターと、実ページの開閉状態を確認する。

## 同じページ内での URL 変更

コンテンツスクリプトはパスの変更を検出すると、進行中の準備処理が古いパスに作用しないよう世代番号を更新する。
対象外のパスに移ると専用表示を解除する。
専用表示中に別の対象パスへ移った場合も、現行の `checkRoute()` は専用表示を解除し、その分岐では再準備を呼ばない。
切り替え先で Dock を専用表示に戻すには、そのページを再読み込みする。

## 動作確認

プロジェクトフォルダーで、JavaScript の構文とマニフェストの JSON を確認する。

```sh
for file in background.js config.js content.js options.js; do
  node --check "$file" || exit 1
done
node -e 'JSON.parse(require("node:fs").readFileSync("manifest.json", "utf8"))'
```

Chrome での確認手順は次のとおり。

1. 拡張機能を読み込み、Options の見出し **Yahoo Finance Watchlist Settings** と既定の URL、幅 400 px、高さ 900 px を確認する。
2. Dock を閉じた状態から拡張アイコンを押し、独立したウィンドウに Dock が展開することを確認する。Dock が開いている状態からも起動する。
3. 専用ウィンドウで縦スクロールと Watchlists のメニューを操作し、通常の Yahoo Finance タブに専用表示が適用されていないことを確認する。
4. Options に個別の Watchlist URL と別のサイズを保存し、専用ウィンドウを閉じて開き直す。指定 URL とサイズが反映されることを確認する。
5. 専用ウィンドウを手動でリサイズして再読み込みし、Dock の表示と再読み込み前の幅を確認する。最後に Options の **Restore defaults** を押し、画面を開き直して保存された値を確認する。
