# 受控仓库准备切片（未开放执行）

本批只新增[独立契约](../../shared/production-repository-contract.ts)及[17项纯测试](../../tests/production-repository-contract.test.ts)，不向当前UI/API的能力列表加入仓库选项。Node22纯专项17/17、251.391ms；无HTTP、容器、宿主生成脚本或模型调用，不能计为自主仓库生产。

## 可以复用的契约

`production-task-repo-v1`支持create/feature/bugfix输入，固定模板标识或受控repositoryId、40位base commit及SHA256 tree、精确读写路径/允许变更种类、固定零依赖Node22执行profile。create模板本身尚未实现，标识不是一个已存在的可用仓库。

文件快照只接受普通文件描述、SHA/字节，最多256文件/8MiB；全文件patch只允许create/replace/delete，64文件/总2MiB/单256KiB，以旧SHA与允许路径绑定，拒绝任意unified diff、模型命令或文件权限。初版路径使用可移植ASCII、拒绝隐藏/秘密/穿越/反斜杠/编码与大小写别名；package/lockfile及冻结测试/Gate可读但不可被模型修改。后续确需依赖变更须新profile和独立受控下载准备，不隐式扩大本版权限。

`production-repo-readiness-v1`从控制面单独输入已验证报告与预期镜像digest/配置/资源绑定；任务和patch不能自填readiness。缺项、unknown/false、镜像/配置/资源不一致均拒绝，返回冻结副本。全部安全项必须已验证，包括仅任务目录挂载、无敏感资源/Docker socket/模型Key、nonroot/capdrop/no-new-privileges、只读rootFS、断网、CPU/内存/pid/墙钟/输出/磁盘硬quota、路径/符号链接、Gate不可变、进程/IPC隔离、取消清理和重启不重放。

这些纯函数只验证控制面声明，**不认证调用者，不实际检查文件、SHA/tree或证明容器隔离**。当前没有任何已验证readiness报告，不能用构造全部true的夹具开启生产。将来必须由可信执行器以真实攻击测试产生并绑定证据，而不是接收用户或模型的自证。

## 本机只读就绪检查与下一步

Darwin arm64、硬件虚拟化可用；当前PATH未发现docker/podman/colima/nerdctl/limactl/container/bwrap/firejail，故没有可执行版本或daemon就绪证据，不等于证明从未安装。未启动或安装服务、改变系统权限、检查敏感挂载、运行容器或写入其他worktree。

下一纵向切片顺序：

1. 用户选择并授权准备单一隔离引擎，固定Node22镜像digest；原项目数据、主目录、SSH、Key与Docker socket不得挂载。
2. 独立准备零依赖HTTP＋静态页面模板，冻结package/lockfile/测试入口；只复制允许的普通应用文件，不直接挂用户原仓库或.git。
3. 实际负例验证路径/符号链接、秘密、外联、死循环/fork/内存/输出/磁盘、取消残留和重启不重放，硬门限全过后才保存readiness报告。bind mount没有quota不能当磁盘硬限额。
4. 对同一模板先免费工程验证新建、加功能、Bug修复，再登记内部六角色的真实任务预算。复用冻结Gate、共享≤2返修与完整账本；交付base/final tree、源码/patch、lockfile、exit/log、预览和manifest。

本批不替代实体摄像头、Verifier效益对照或九次固定配置泛化实验。安装/启用系统服务和新增对外部署仍需用户确认，不会以宿主执行补位。
