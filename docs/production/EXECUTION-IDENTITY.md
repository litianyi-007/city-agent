# 启动身份与付费阶段漂移检查

`production-boot-disk-v1` 是启动时**磁盘**来源快照，不是安全沙箱或已加载TS模块字节证明。原服务在factory创建时只捕获一次commit，并非每请求重新标记；缺口是旧服务可能继续读新前端/插件，以及同HEAD下脏源码未被旧build声明发现。本次不修改旧运行标签。

服务可以在缺build或脏树下启动以配置、浏览历史、运行免费Mock；新live/mock-jev和每个下一真实角色/Jev请求必须通过assertFresh。失败要求干净提交→对应构建→实际重启；不重复付费、不自动继续旧中断任务或移动旧标签。

身份保存bootId、startedAt、固定commit、sourceClean、公开源码文件的路径/字节/hash及整体指纹、build快照与文件指纹、ready/issues和限制声明。版本、lockfile、共享契约、Gate、字面Harness插件、后端/前端与dist入口/资产均入指纹。不读取.env、Key、数据、日志、主目录或另一worktree；拒绝symlink、越界、非普通文件、过量与未知证据。

新run/evidence/manifest保存原启动身份，原历史字段可缺省，不追填；大型指纹数组不进入模型Prompt。metadata.ready只代表boot当时证据，不是实时承诺。HEAD、dirty、源码或build漂移在下一付费边界检查；有新的commit/build也不能让旧boot自动变成新身份。benchmark先检查再登记invoked，持久化后第二检查拒绝时仍明确非实际调用；案例意图与HTTP分别计量。

纯模块12项、注入集成7项覆盖HEAD变化、同HEAD源码/lockfile/插件/前端变化、缺失/错误/脏构建、dist漂移、不可变快照、live及mock-jev零注册、下一角色/Jev阻断、不同boot任务、benchmark下一case/持久化窗口/缺默认guard拒绝。没有真实模型请求、凭据读取或Git修改；工程反例不能代替真实运行身份核验。

## 保留的限制

哈希当前磁盘不能严格证明此前模块缓存的已加载字节。文件系统、动态加载与HTTP之间并非原子操作；同账号有写权限的对抗者也不被此功能安全隔离。依赖node_modules不做全量安装完整性证明，camera资产继续依其固定pin验证。更强方案是可信bootstrap加载前后身份校验、固定编译后端产物和隔离执行器；本批没有宣称已完成这些方案。

共享改动仅生产契约，新版本后再实验。公开v5固定967bbba材料与此后源码不同；不能用v5的视频或原运行来证明新的guard/Prompt已真实验证。
