import { type anyobject } from "@ceale/util"
import type { LX } from "lx-source-type"
import { Worker } from "node:worker_threads"
import { type LxUserApiHandlers, type LxUserApiOptions } from "./user-api.ts"
import { WorkerUserApi } from "./worker-wrap.ts"

export type ActionMessage =
    | { id: string; action: "load"; script: string, options: LxUserApiOptions }
    | { id: string; action: "resolve"; rid: string; params: LX.ProviderParams }
    | { id: string; action: "destroy" }

export type EventMessage =
    // 初始化
    | { id: string; event: "inited"; payload: LX.InitedPayload }
    | { id: string; event: "initError"; error: any }
    // 更新
    | { id: string; event: "updateAlert"; payload: LX.UpdateAlertPayload }
    // 获取
    | { id: string; event: "resolveResult"; rid: string; result: LX.ProviderResult }
    | { id: string; event: "resolveError"; rid: string; error: any }
    // 错误
    | { id: string; event: "runError"; error: any }
    | { id: string; event: "workerError"; error: any }
    // 日志
    | { id: string; event: "log"; level: string; data: any }


export type Result<T extends anyobject = {}> = ({ success: true } & T) | { success: false, error: any }

export const createID = () => Math.random().toString(36).slice(2)

const WORKER_PATH = new URL("./worker-host.js", import.meta.url)
const WORKER_DATA = { isSubWorker: true }


export class WorkerUserApiManager {

    private mode: "dedicated" | "shared"

    private multiWorkerMap!: Map<any, Worker>
    private singleWorker!: Worker

    private userApiSet = new Set<WorkerUserApi>()

    constructor(
        mode: "dedicated" | "shared"
    ) {
        this.mode = mode

        if (this.mode === "dedicated") {
            this.multiWorkerMap = new Map()
        } else {
            this.singleWorker = new Worker(WORKER_PATH, { workerData: WORKER_DATA })
        }
    }

    load(
        script: string,
        handlers: LxUserApiHandlers = {},
        options: LxUserApiOptions = {}
    ): WorkerUserApi {
        if (this.mode === "dedicated") {
            const worker = new Worker(WORKER_PATH, { workerData: WORKER_DATA })
            const userApi = new WorkerUserApi(script, worker, handlers, options)
            const destroy = userApi.destroy
            userApi.destroy = () => {
                destroy.call(userApi)
                this.destroy(userApi)
            }
            this.userApiSet.add(userApi)
            this.multiWorkerMap.set(userApi, worker)
            return userApi
        } else {
            const userApi = new WorkerUserApi(script, this.singleWorker, handlers, options)
            const destroy = userApi.destroy
            userApi.destroy = () => {
                destroy.call(userApi)
                this.destroy(userApi)
            }
            this.userApiSet.add(userApi)
            return userApi
        }
    }

    private async destroy(userApi: WorkerUserApi) {
        if (this.has(userApi)) {
            this.userApiSet.delete(userApi)
            if (this.mode === "dedicated") {
                const worker = this.multiWorkerMap.get(userApi)
                await worker?.terminate()
                this.multiWorkerMap.delete(userApi)
            }
        }
    }

    async destroyAll() {
        for (const userApi of this.userApiSet) {
            userApi.destroy()
        }
        this.userApiSet.clear()
        if (this.mode === "dedicated") {
            for (const [ _, worker ] of this.multiWorkerMap) {
                await worker.terminate()
            }
            this.multiWorkerMap.clear()
        } else {
            await this.singleWorker.terminate()
        }
    }

    has(userApi: WorkerUserApi) {
        return this.userApiSet.has(userApi)
    }

    getAll() {
        return Array.from(this.userApiSet.values())
    }
}