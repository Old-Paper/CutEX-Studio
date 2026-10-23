# CutEX Studio MVP

[![CI](https://github.com/Old-Paper/CutEX-Studio/actions/workflows/ci.yml/badge.svg)](https://github.com/Old-Paper/CutEX-Studio/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Old-Paper/CutEX-Studio)](https://github.com/Old-Paper/CutEX-Studio/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

面向 Windows 的本地配音自动粗剪桌面应用。导入视频或音频后，CutEX 会立即使用 FFmpeg 检测配音停顿并生成建议删除区间；从头审听时按 `X` 即可反选播放头所在的完整片段，最后用精确重编码方式导出成片。

所有媒体处理都在本机完成，不上传文件。

![CutEX Studio 工作台](docs/cutex-studio-preview.png)

## 下载 Windows 版

前往 [GitHub Releases](https://github.com/Old-Paper/CutEX-Studio/releases/latest) 下载最新的 `CutEX-Studio-*-Windows.exe`。当前版本需要系统已安装 FFmpeg/FFprobe，安装方式见下文。

## 快速开始

使用流程：选择或拖入素材后等待自动粗剪完成。默认“原片校对”会播放所有内容，按 `Space` 播放，按 `X` 切换当前位置片段的“删除 / 保留”；切换到“成片预览”才会自动跳过删除区。`Ctrl+Z` 撤销，`Ctrl+S` 保存。

自动规则：原始连续静音 ≤1 秒不自动裁剪；前后保留量不会再次触发 1 秒过滤。手动标记不受此限制。重新粗剪保留手动决定，结果可撤销；打开旧项目不会静默删除片段。

工程保护：切换项目时提示保存，保存保留上一个 `.bak` 版本；修改后约 0.8 秒生成本机恢复快照，重启可选择恢复。恢复快照不是正式保存的替代品。

时间轴操作：普通滚轮横向浏览，`Alt + 滚轮` 以鼠标所在位置为中心缩放；底部全片导航条可点击跳转，放大后拖动紫色可视窗口可快速平移。

导出加速：MP4、MOV、MKV 可在导出窗口选择 CPU、NVIDIA NVENC、Intel Quick Sync 或 AMD AMF。软件会实际测试当前设备，只启用可用 GPU；明确的硬件初始化错误才回退 CPU。磁盘、权限等错误不会触发重复编码。WebM 和纯音频会使用对应的软件编码器。

导出方式：默认“快速导出”使用分段清单串行读取保留区间，适合大量切点；“高精度兼容”使用逐段裁剪。检测到快速模式的时间戳兼容性问题时回退高精度模式。输出先写临时文件，校验流、时长和三处解码后再交付。不会覆盖原媒体或同名成品，请为再次导出选择新文件名。

波形使用 48 kHz 采样提取双声道峰值包络、约 10 ms 基础分桶（超长素材上限 200 万桶）及多级缩放缓存；时间轴只绘制当前可见区域。多音轨素材会为所选音轨生成本地预览缓存，准备期间不播放错误音轨。

开发环境：Node.js 22.12+、pnpm 9.15.9、FFmpeg/FFprobe（本次验证 8.1.1）。运行便携版不需要 Node.js，但仍需 FFmpeg/FFprobe；启动时会检查并提示缺失依赖，不会自动安装系统软件。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

其他命令：

```bash
pnpm typecheck   # TypeScript 严格类型检查
pnpm test        # 单元测试 + 自动生成素材的真实 FFmpeg 回归
pnpm coverage    # 核心算法覆盖率
pnpm lint        # ESLint
pnpm build       # 生产构建
pnpm package     # Windows 便携版
pnpm smoke       # 构建后执行 Electron 运行时验收
```

打包结果位于 `release/`。标签必须与 package.json 版本一致；发布工作流先建立包含 SHA-256 清单的草稿，不覆盖既有版本资产。

性能与验收边界见 [0.8.0 验收说明](docs/validation-0.8.0.md)。

## Windows 安装 FFmpeg

推荐使用 winget：

```powershell
winget install --id Gyan.FFmpeg -e
ffmpeg -version
ffprobe -version
```

也可以设置 `FFMPEG_PATH` 和 `FFPROBE_PATH` 为可执行文件绝对路径。当前 MVP 采用外部 FFmpeg，避免安装依赖从 GitHub 下载大体积二进制导致 `npm install` 不稳定。正式分发版可在 electron-builder 的 `extraResources` 中内置已核验的 FFmpeg Windows 二进制，并通过这两个环境变量或 `process.resourcesPath` 解析。

## 架构

```text
src/
  main/
    ffmpeg/       # 二进制路径、任务管理、silencedetect
    ffprobe/      # 媒体元数据读取
    ipc/          # 白名单 IPC
    project/      # 项目保存、打开、最近记录、媒体重定位
    export/       # 精确裁切、拼接与进度
    logger/       # 完整导出日志
  preload/        # contextBridge 安全 API
  renderer/
    components/   # 工作台面板、预览、反馈
    timeline/     # 单轨时间轴与边缘拖动
    hooks/        # 集中式快捷键
    stores/       # Zustand 编辑器状态与历史
    types/
    utils/
  shared/
    types/        # IPC 与项目共享类型
    constants/    # 默认参数和格式
    ranges.ts     # 纯区间算法
    history.ts    # 纯撤销/重做
    exportArgs.ts # 纯 FFmpeg 参数生成
tests/
```

选择 Zustand 是因为 MVP 状态域较多、动作关系明确，但不需要 Redux 的样板代码。媒体、检测、时间轴、选择、播放、任务、历史和项目数据在同一类型化 store 中分域保存；区间计算和 FFmpeg 参数生成仍保持独立纯函数。

### 核心数据

- `TimeRange`：`id`、`startMs`、`endMs`，全部为整数毫秒。
- `DeletionRange`：在 `TimeRange` 上增加启用状态与来源。
- `MediaInfo`：路径、时长、尺寸、编码、帧率、视频/音频标记和全部音轨。
- `DetectionParameters`：阈值、最短静音、前后保留、最短保留片段与合并距离。
- `ProjectData`：版本、媒体、检测结果、手工区间、缩放和最后播放位置。

### IPC 白名单

- `media:select`：选择文件并运行 FFprobe。
- `analysis:start`：运行 `silencedetect`。
- `task:cancel`：取消分析或导出子进程。
- `project:save` / `project:open` / `project:recent`：项目文件操作。
- `export:start`：选择输出路径并运行精确导出。
- `file:reveal`：在资源管理器中显示成功输出。
- `task:progress`：主进程向渲染层发送任务进度。

渲染进程开启 `contextIsolation` 与沙箱，关闭 `nodeIntegration`，只能通过 preload 的类型化 API 访问上述能力。

## FFmpeg 调用方案

- FFprobe：`-print_format json -show_format -show_streams`，解析格式、视频流和所有音频流。
- 静音检测：选择绝对流索引后使用不低于 `silencedetect=noise=-35dB:d=1.000` 的持续时间，从 stderr 解析开始/结束时间；原始静音 ≤1 秒不自动裁剪，扣除前后保留量后只过滤空区间。
- 精确导出：每个保留区间分别使用 `trim + setpts` 和 `atrim + asetpts`，最后 `concat`；支持 MP4、MOV、MKV、WebM、MP3、WAV、M4A，并为容器选择 H.264/AAC、VP9/Opus、MP3 或 PCM 编码。
- 大量切点的复杂滤镜会写入临时脚本再交给 FFmpeg，避免超过 Windows 进程启动参数长度限制；任务结束后自动清理。
- H.264 使用兼容性稳定的 x264 `veryfast` 软件预设；WebM 启用 VP9 行级多线程，避免默认硬件编码带来的显卡和驱动兼容问题。
- 所有命令均使用 `spawn(executable, args[])`，不拼接 shell 字符串，因此兼容空格、Unicode 和中文路径。

## 已完成功能

- Electron + React + TypeScript + Vite 工程、严格模式、ESLint、Vitest、electron-builder。
- MP4/MOV/MKV/WebM/MP3/WAV/M4A 文件选择或整窗拖放导入，以及 FFprobe 元数据、多音轨选择。
- 导入后自动使用当前节奏预设完成静音检测与粗剪，不需要额外点击分析按钮。
- 静音检测参数、原始静音、建议删除和最终保留区间生成及边界修正；1 秒过滤仅作用于原始静音，不改动保存过的手动片段。
- 深色三栏编辑工作台、视频/音频预览、播放控制、时间显示和跳转。
- FFmpeg PCM 真波形：约 10 ms 基础分桶、多级峰值与 RMS 缓存，Canvas 仅绘制当前可见区域。
- 快/中/慢三档节奏预设；中、慢档按素材真实帧率换算前后 4 帧和 8 帧。
- 单轨时间轴、缩放/滚动、播放头、单选/Ctrl 多选/Shift 连选、边缘拖动、吸附与精确提示。
- 全片导航条、滚轮横移与 `Alt + 滚轮` 定点缩放；删除标记按真实时间比例绘制，避免低缩放下假重叠。
- 集中式快捷键：`Space` 播放、`X` 反选播放头所在片段；含输入控件焦点保护、100 步撤销/重做和连续拖动单步历史。
- 新建、保存、另存为、打开、最近项目持久化、媒体丢失后重新定位。
- MP4/MOV/MKV/WebM/MP3/WAV/M4A 格式选择、精确导出、进度、取消、错误摘要、完整日志和输出定位。
- CPU/GPU 编码选择、NVIDIA/Intel/AMD 真实可用性检测，以及明确硬件初始化失败时回退 CPU。
- 快速分段导出与高精度兼容模式；大量切点不再创建成百上千条并行滤镜。
- 空状态、禁用状态、加载/进度、成功和错误反馈。

## 当前限制

- 最近项目已由主进程维护并通过 IPC 提供，但 MVP 界面暂未加入最近项目下拉列表。
- 预览使用 Chromium 支持的本地编码；部分 MKV、MOV 或专业编码可正常分析/导出但不能直接预览。
- 粗剪预览会自动跳过删除区间，但跳点附近仍可能受源视频关键帧和解码器性能影响。
- 波形按文件、修改时间和音轨缓存；超长素材首次生成仍需要等待。缓存管理界面尚未提供。
- 尚未提供时间轴区间整体移动，只支持边缘调整；不做多轨合成、字幕、转场和通用视频代理转码。
- FFmpeg 需要安装到 PATH 或通过环境变量指定，便携包暂未内置二进制。

## 主要风险与后续建议

1. 为正式分发包内置固定版本 FFmpeg，并验证 LGPL/GPL 许可与编码器组合。
2. 增加缓存清理入口和通用视频代理，改善超长或专业编码素材的编辑体验。
3. 加入最近项目下拉入口和显式项目版本迁移器；现有恢复快照不能代替定期正式保存。
4. 扩充真实长视频、VFR、HEVC、无音频和多语言多音轨回归素材库。
5. 增加安装版签名、自动更新与导出磁盘空间预检。
