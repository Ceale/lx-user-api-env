# lx-user-api-env

提供了在 nodejs 环境下加载洛雪音乐源的实现，及在 Worker 内隔离加载音乐源的方法。见下。

经测试目前已经可以兼容加载大部分音乐源，但仍有少部分音乐源在一些情况下有异常。<br/>
异常情况多为无法初始化、请求音乐时出现仅在本环境出现的报错。本项目会尽可能消除音乐源在不同环境下的行为差异。<br/>
但大部分常见可用音乐源内有高强度反混淆、jsvmp壳，因此排查行为差异成因的难度较高。<br/>
如果您已经明确某个音乐源行为差异的原因，可以提交issue说明。

提供了：
- class `UserApi`
- - 实现了加载音乐源
- class `WorkerUserApi`
- - 封装 Worker 内的 `UserApi`，属性、方法与 `UserApi` 一致
- - 须提供运行有 `UserApiWorkerHost` 的 Worker
- class `WorkerUserApiManager`
- - 自动管理 `WorkerUserApi` 与其所需的 Worker

内部类、方法、接口：
- class `UserApiWorkerHost`
- - 运行在 Worker 内的类
- interface `IUserApi`
- - 音乐源类接口，`UserApi` 与 `WorkerUserApi` 实现该接口
- interface `LxUserApiHandlers`
- - 音乐源的事件处理函数
- interface `LxUserApiOptions`
- - `UserApi` 的配置
- interface `ActionMessage`
- - 用以 `WorkerUserApi` 向 `UserApiWorkerHost` 通信
- interface `EventMessage`
- - 用以 `UserApiWorkerHost` 向 `WorkerUserApi` 通信
- method `extractMetadata`
- - 提取音乐源的元数据
- method `request`
- - 提供给音乐源内部的请求方法
- method `createUtils`
- - 创建音乐源的辅助工具