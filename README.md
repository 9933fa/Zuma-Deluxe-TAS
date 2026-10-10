# ZumaTAS: a faithful Zuma Deluxe replica + Claude TAS (9:38)

[English](#english) · [中文](#中文) · Full write-up: [docs/TAS.md](docs/TAS.md) (also in-game as `docs/tas_doc.html`)

| | TOTAL TIME | COMBOS | COINS | GAPS | MAX CHAIN | MAX COMBO |
|---|---|---|---|---|---|---|
| World-record TAS by [QuocQuoc](https://www.youtube.com/@quocquoc444) & [DadoYep](https://www.youtube.com/@DadoYep) ([YouTube](https://www.youtube.com/watch?v=9vhNcWftR3Q) / [Bilibili](https://www.bilibili.com/video/BV1qd6pYNECM)) | 11:22 | 685 | 52 | 61 | 25 | 10 |
| Claude TAS v3 (`tas/movie_v3.js`) | 12:27 | 459 | 25 | 478 | 21 | 5 |
| **Claude TAS v4** (`tas/movie.js`) | **9:38** (578.26 s) | 565 | 18 | 538 | 15 | 6 |

TOTAL TIME is the sum of in-level times shown on the game's WINNING TOTALS screen. Level by level, v4 is faster than the world record on 56 of 76 levels, in the same second on 14 and slower on 6.

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

# 2. check that your game data matches the recording (should print TOTAL TIME 9:38)
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

This writes `tas/progress_64_v4.json` (resumable) and `tas/movie_v4.js`; copy it to `tas/movie.js` to watch it. The published run took about 4 hours on 22 CPU cores. Older pipelines: `run_v3.js` (12:27) and `run_all.js` (v1, 14:00).

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

# 2. 检查游戏数据和录像是否一致（应输出 TOTAL TIME 9:38）
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

结果写入 `tas/progress_64_v4.json`（可断点续跑）和 `tas/movie_v4.js`，复制为 `tas/movie.js` 即可在游戏里观看。正式录像在 22 个 CPU 核心上跑了约 4 小时。旧版流程：`run_v3.js`（12:27）、`run_all.js`（v1，14:00）。

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
