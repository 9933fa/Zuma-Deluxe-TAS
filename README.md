# ZumaTAS: a faithful Zuma Deluxe replica + Claude TAS (8:51)

[English](#english) · [中文](#中文) · Full write-up: [docs/TAS.md](docs/TAS.md) (also in-game as `docs/tas_doc.html`)

| | TOTAL TIME | COMBOS | COINS | GAPS | MAX CHAIN | MAX COMBO |
|---|---|---|---|---|---|---|
| World-record TAS by [QuocQuoc](https://www.youtube.com/@quocquoc444) & [DadoYep](https://www.youtube.com/@DadoYep) ([YouTube](https://www.youtube.com/watch?v=9vhNcWftR3Q) / [Bilibili](https://www.bilibili.com/video/BV1qd6pYNECM)) | 11:22 | 685 | 52 | 61 | 25 | 10 |
| Claude TAS v3 (`tas/movie_v3.js`) | 12:27 | 459 | 25 | 478 | 21 | 5 |
| Claude TAS v4 (`tas/movie_v4.js`) | 9:38 (578.26 s) | 565 | 18 | 538 | 15 | 6 |
| Claude TAS v4.1 (`tas/movie_r64.js`) | 9:11 (551.00 s) | 517 | 11 | 520 | 14 | 7 |
| Claude TAS v4.2 (`tas/movie_v5b.js`) | 9:02 (542.07 s) | 494 | 20 | 521 | 14 | 5 |
| Claude TAS v4.3 (`tas/movie_v7.js`) | 8:53 (533.15 s) | 519 | 9 | 479 | 16 | 7 |
| **Claude TAS v4.4** (`tas/movie.js`) | **8:51** (531.95 s) | 501 | 8 | 508 | 15 | 5 |

TOTAL TIME is the sum of in-level times shown on the game's WINNING TOTALS screen. v4.1 re-ran the unmodified v4 searcher as four independent full 76-level runs in parallel and kept the best. v4.2 re-tuned the value function on the 22-level bench (`alpha` 1.5 + `K` 20). v4.3 found the knob combinations **stack**: `alpha` 1.5 + `K` 20 + `settle` 90 + `colorPen` 2 is worth −449 bench ticks. v4.4 re-scanned the seed on a full-76-level criterion (the original seed 64 was picked by 1-1 speed alone): 32 quick full runs spread 25 s at equal compute, and the best of the verified seeds (24) lands at 531.95 s. Level by level the current movie is faster than the world record on 70 of 76 levels, in the same second on 4 and slower on 2 (9-6, 12-6).

---

## English

### What this is

- **A line-by-line JavaScript port of Zuma Deluxe** (HTML5 canvas, original 640×480), based on the decompilation [CircleShootApp](https://github.com/alula/CircleShootApp). Game logic, transitions, scoring quirks, single-precision floats and the order of random-number use all match the original, so the same seed plus the same inputs always give the same game, in Node.js and in the browser.
- **Claude TAS**: a tool-assisted speedrun of the whole Adventure mode (76 levels) planned by a search program, with an in-game replay viewer. Same firing rate as the original; no limit on turning speed or ball swaps.

### Requirements

- **Your own copy of Zuma Deluxe** (e.g. [Steam](https://store.steampowered.com/app/3330/Zuma_Deluxe/)). The game's art, sounds, music, fonts and level data are copyrighted and are **not** in this repository.
- Python 3.9+ with `pillow` and `numpy` (`pip install pillow numpy`).
- Node.js 18+ (only for the TAS tools and replay checks).
- Optional, for music: [openmpt123](https://lib.openmpt.org) and an `ffmpeg` with libvorbis. Without them the game runs silently.

### Setup

```bash
# 1. build the assets from your installation (writes assets/ and js/gamedata.js)
python tools/build_assets.py --game "C:/Program Files (x86)/Steam/steamapps/common/Zuma Deluxe" --openmpt path/to/openmpt123 --ffmpeg path/to/ffmpeg

# 2. check that your game data matches the recording (should print TOTAL TIME 8:51)
node tools/tas/final_stats.js tas/movie.js

# 3. serve the folder and open http://localhost:8767
python -m http.server 8767
```

The build script prints SHA-256 checksums of `levels/levels.xml` and `properties/resources.xml` and warns if they differ from the version the TAS was recorded with. A different game version can make the replay desync; playing the game itself still works.

### Playing and watching

- ADVENTURE: the original adventure mode. Left click shoots, right click swaps, space pauses, `T` shows the ACE timer.
- **MORE GAMES opens the Claude TAS replay**: watch from the start or from any stage. Top left shows the time in this level, the WR time for this level, and the total. Buttons and keys: pause (space), single frame (→), slower/faster (−/+), **restart this level** (`R`), exit (Esc).
- The TAS menu also has a **Docs** button for the full bilingual write-up.

### Reproducing the TAS

```bash
node tools/tas/run_v4.js 64 22 4 _v4 64 8   # seed 64, 22 worker processes, compare 4 solutions, beam width 64, lookahead width 8
```

This writes `tas/progress_64_v4.json` (resumable) and `tas/movie_v4.js`; copy it to `tas/movie.js` to watch it. The v4 run took about 4 hours on 22 CPU cores. Older pipelines: `run_v3.js` (12:27) and `run_all.js` (v1, 14:00).

The published 9:11 movie was made by re-running the same driver as **four independent full runs in parallel** (on a 128-core machine, ~3.5 h wall) and keeping the best — search code unchanged, only compute and fresh cross-level RNG paths:

```bash
node tools/tas/run_v4.js 64 32 8  _r64 64 8   # beam 64  -> 551.00 s (published)
node tools/tas/run_v4.js 64 32 8  _r48 48 8   # beam 48  -> 551.50 s
node tools/tas/run_v4.js 64 24 8  _r96 96 8   # beam 96  -> 553.03 s (width saturates ~64)
node tools/tas/run_v4.js 64 24 16 _r16 32 16  # M=16 deep cross-level choice -> 551.13 s
```

The four `tas/movie_r*.js` files are kept as experiment records.

v4.2 re-tunes the searcher on the same bench (`tools/tas/bench4.js` on the 22-level test set, ~90 s per config on a many-core box): clear-cost weight `alpha` 1.5 + candidate list `K` 20 was the winning combination (−246 ticks vs base, bit-identical across bench seeds), and those combos now lead the `VAR` ensemble in `run_v4.js`. Three parallel full runs with the retuned ensemble:

```bash
node tools/tas/run_v4.js 64 32 16 _v5b 64 8   # M=16 deep cross-level choice -> 542.07 s (published)
node tools/tas/run_v4.js 64 32 8  _v5  64 8   # M=8                            -> 548.77 s
node tools/tas/run_v4.js 64 40 8  _v6  64 8   # combo-heavy ensemble           -> 542.74 s
```

`v4.js` also gained an optional `postDelay`/`postTop` knob (wider delayed firing after the score target is reached); it is off by default — it lost by ~1500 ticks on the bench, but it is kept as a configurable option.

v4.3 found the combinations stack (`alpha` 1.5 + `K` 20 + `settle` 90 + `colorPen` 2: −449 bench ticks vs the original base) and now leads the `VAR` ensemble:

```bash
node tools/tas/run_v4.js 64 32 16 _v7 64 8   # quad ensemble, M=16 -> 533.15 s (published)
node tools/tas/run_v4.js 64 32 24 _v7b 64 8  # M=24 -> 537.99 s (M=16 stays best)
```

Seeds can be re-scanned with quick full runs (`node tools/tas/run_v4.js <seed> 4 2 _q<seed> 16 4`); 32 seeds spread 25 s at equal compute, so the choice of seed matters. The published movie uses seed 24, found by this criterion (the original pick, 64, was chosen by 1-1 speed alone):

```bash
node tools/tas/run_v4.js 24 32 16 _f24 64 8   # seed 24, quad ensemble, M=16 -> 531.95 s (published)
```

Useful tools in `tools/tas/`: `bench4.js` (benchmark a search setting on all level-start states), `final_stats.js` (WINNING TOTALS of a movie), `determinism.js` (headless vs visual check), `test_trace.js` (aim predictor vs exact simulation), `dpcheck.js` (clear-cost DP vs brute force).

### Layout

| Path | Contents |
|---|---|
| `js/sim.js` | the game (pure, deterministic simulation) |
| `js/render.js`, `js/font.js`, `js/app.js` | drawing, PopCap ImageFont port, screens/input/audio/replay viewer |
| `tools/build_assets.py` | converts your Zuma Deluxe installation into `assets/` + `js/gamedata.js` |
| `tools/tas/v4.js`, `run_v4.js` | the current TAS search and full-run driver |
| `tas/movie.js` | the recorded run (inputs per 10 ms tick) |
| `tas/wr_times.js` | world-record time for every level |
| `docs/` | write-up (`TAS.md`, `tas_doc.html`) |

### Credits and legal

Zuma Deluxe © PopCap Games / Electronic Arts; this is a non-commercial fan project, not affiliated with or endorsed by them. Game logic ported from [CircleShootApp](https://github.com/alula/CircleShootApp). Includes portions of the PopCap Games Framework, © 2005-2009 PopCap Games, Inc. Comparison times from the world-record TAS by QuocQuoc and DadoYep. Our own code is MIT licensed ([LICENSE](LICENSE)); see [NOTICE](NOTICE) for third-party notices.

---

## 中文

### 这是什么

- **Zuma Deluxe（祖玛豪华版）的逐行 JavaScript 复刻**（HTML5 Canvas，原版 640×480），依据反编译项目 [CircleShootApp](https://github.com/alula/CircleShootApp)。游戏逻辑、过场、计分的各种怪规则、单精度浮点、随机数的消耗顺序都和原版一致：同一个种子加同样的输入，在 Node.js 和浏览器里都得到完全相同的结果。
- **Claude TAS**：由搜索程序规划的冒险模式全 76 关工具辅助速通，游戏内自带回放。发射频率和原版相同，不限转向速度和换球次数。

### 需要准备

- **你自己的 Zuma Deluxe**（例如 [Steam 版](https://store.steampowered.com/app/3330/Zuma_Deluxe/)）。游戏的图片、声音、音乐、字体和关卡数据受版权保护，**不包含**在本仓库里。
- Python 3.9+，以及 `pillow` 和 `numpy`（`pip install pillow numpy`）。
- Node.js 18+（只有 TAS 工具和录像校验需要）。
- 可选（生成音乐用）：[openmpt123](https://lib.openmpt.org) 和带 libvorbis 的 `ffmpeg`。没有的话游戏照常运行，只是没有背景音乐。

### 安装运行

```bash
# 1. 从你的游戏目录生成素材（写入 assets/ 和 js/gamedata.js）
python tools/build_assets.py --game "C:/Program Files (x86)/Steam/steamapps/common/Zuma Deluxe" --openmpt openmpt123路径 --ffmpeg ffmpeg路径

# 2. 检查游戏数据和录像是否一致（应输出 TOTAL TIME 8:51）
node tools/tas/final_stats.js tas/movie.js

# 3. 启动本地服务器，浏览器打开 http://localhost:8767
python -m http.server 8767
```

生成脚本会打印 `levels/levels.xml` 和 `properties/resources.xml` 的 SHA-256；如果和录制 TAS 时用的版本不同会给出警告。游戏版本不同可能导致 TAS 回放不同步，但游戏本身仍可正常游玩。

### 游玩与观看

- ADVENTURE：原版冒险模式。左键发射，右键换球，空格暂停，`T` 显示 ACE 计时。
- **MORE GAMES 改为 Claude TAS 速通回放**：可以从头看，也可以从任意大关开始看。左上角显示本关用时、对应关的世界纪录和总时间。按钮与快捷键：暂停（空格）、单帧（→）、减速/加速（−/+）、**本关重开**（`R`）、退出（Esc）。
- TAS 菜单里的 **项目说明 / Docs** 打开中英文完整说明。

### 复现 TAS

```bash
node tools/tas/run_v4.js 64 22 4 _v4 64 8   # 种子 64、22 个进程、比较 4 个解、束宽 64、下一关试探束宽 8
```

结果写入 `tas/progress_64_v4.json`（可断点续跑）和 `tas/movie_v4.js`，复制为 `tas/movie.js` 即可在游戏里观看。v4 在 22 个 CPU 核心上跑了约 4 小时。旧版流程：`run_v3.js`（12:27）、`run_all.js`（v1，14:00）。

正式的 9:11 录像是把同一驱动**并行跑 4 路独立全程**（128 核机器，约 3.5 小时）取最优得到的——搜索代码零改动，只是算力加上重新洗牌的跨关随机路径：

```bash
node tools/tas/run_v4.js 64 32 8  _r64 64 8   # 束宽 64  -> 551.00 s（正式发布）
node tools/tas/run_v4.js 64 32 8  _r48 48 8   # 束宽 48  -> 551.50 s
node tools/tas/run_v4.js 64 24 8  _r96 96 8   # 束宽 96  -> 553.03 s（宽度收益在 64 附近饱和）
node tools/tas/run_v4.js 64 24 16 _r16 32 16  # M=16 深跨关选择 -> 551.13 s
```

四份 `tas/movie_r*.js` 保留作为实验记录。

v4.2 在同一测试台（`tools/tas/bench4.js`，22 关测试集，多核机器上每组约 90 秒）上重调了估值：清场代价权重 `alpha` 1.5 + 候选数 `K` 20 是最优组合（相对基线 −246 tick，且各 bench 种子下逐位一致），这些组合现在排在 `run_v4.js` 的 `VAR` 集成最前面。用重调后的集成并行跑了三路全量：

```bash
node tools/tas/run_v4.js 64 32 16 _v5b 64 8   # M=16 深跨关选择 -> 542.07 s（正式发布）
node tools/tas/run_v4.js 64 32 8  _v5  64 8   # M=8             -> 548.77 s
node tools/tas/run_v4.js 64 40 8  _v6  64 8   # 组合密集集成     -> 542.74 s
```

`v4.js` 还新增了可选的 `postDelay`/`postTop` 旋钮（达标后更宽的延迟换色窗口）；默认关闭——测试集上它输了约 1500 tick，但保留为可配置项。

v4.3 发现旋钮组合可以叠加（`alpha` 1.5 + `K` 20 + `settle` 90 + `colorPen` 2：测试集累计 −449），现在排在 `VAR` 集成最前：

```bash
node tools/tas/run_v4.js 64 32 16 _v7 64 8   # quad 集成, M=16 -> 533.15 s（正式发布）
node tools/tas/run_v4.js 64 32 24 _v7b 64 8  # M=24 -> 537.99 s（M=16 仍是最优）
```

种子也可以用快速全程重扫（`node tools/tas/run_v4.js <种子> 4 2 _q<种子> 16 4`）：32 个种子同算力下成绩差 25 秒，选种很重要。正式录像用的就是该口径选出的 24 号种（当年按 1-1 单关速度选的 64 号）：

```bash
node tools/tas/run_v4.js 24 32 16 _f24 64 8   # 种子 24, quad 集成, M=16 -> 531.95 s（正式发布）
```

`tools/tas/` 里的常用工具：`bench4.js`（在全部关卡开局状态上测试搜索设置）、`final_stats.js`（输出录像的 WINNING TOTALS）、`determinism.js`（无画面/有画面一致性检查）、`test_trace.js`（瞄准预测与精确模拟对拍）、`dpcheck.js`（清场 DP 与暴力搜索对拍）。

### 目录

| 路径 | 内容 |
|---|---|
| `js/sim.js` | 游戏本体（纯逻辑、确定性模拟） |
| `js/render.js`、`js/font.js`、`js/app.js` | 绘制、PopCap ImageFont 移植、界面/输入/声音/回放 |
| `tools/build_assets.py` | 把你的游戏目录转换成 `assets/` 和 `js/gamedata.js` |
| `tools/tas/v4.js`、`run_v4.js` | 当前的 TAS 搜索与整局驱动 |
| `tas/movie.js` | 录像（每 10 毫秒一帧的输入） |
| `tas/wr_times.js` | 每关的世界纪录用时 |
| `docs/` | 说明文档（`TAS.md`、`tas_doc.html`） |

### 致谢与版权

Zuma Deluxe © PopCap Games / Electronic Arts；本项目为非商业的爱好者作品，与其没有关联、也未获其认可。游戏逻辑移植自 [CircleShootApp](https://github.com/alula/CircleShootApp)。包含 PopCap Games Framework 的部分内容，© 2005-2009 PopCap Games, Inc.。对比时间来自 QuocQuoc 与 DadoYep 的世界纪录 TAS。本项目自己的代码以 MIT 协议发布（[LICENSE](LICENSE)），第三方声明见 [NOTICE](NOTICE)。
