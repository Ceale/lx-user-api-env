import { type anyobject } from "@ceale/util"
import type { LX } from "lx-source-type"
import { Worker } from "node:worker_threads"
import { type IUserApi, type LxUserApiHandlers, type LxUserApiOptions } from "./user-api.ts"

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
    | { id: string; event: "log"; data: any }


export type Result<T extends anyobject = {}> = ({ success: true } & T) | { success: false, error: any }

const createID = () => Math.random().toString(36).slice(2)
// @ts-ignore
// const WORKER_PATH = globalThis.WORKER_PATH ?? "./worker-sub.ts"
// import fs from "node:fs"
// const WORKER_PATH = URL.createObjectURL(new Blob([ fs.readFileSync("./worker-sub.ts", "utf8") ], { type: "application/javascript" }))
const WORKER_PATH = "./worker-sub.ts"
const WORKER_DATA = { isSubWorker: true }


export class WorkerUserApi implements IUserApi {

    public isInited = false
    public isInitError = false
    public isUpdateNeeded = false
    public isDestroyed = false

    public supportPlatform?: LX.InitedPayload["sources"]
    public updateAlert?: LX.UpdateAlertPayload

    public handlers: LxUserApiHandlers
    private options: LxUserApiOptions
    
    private wid = createID()
    private worker: Worker // | null
    private resolveMap = new Map<string, Function>()

    constructor(
        script: string,
        worker: Worker,
        handlers: LxUserApiHandlers = {},
        options: LxUserApiOptions = {}
    ) {
        this.worker = worker
        this.handlers = handlers
        this.options = options

        worker.on("message", (message: EventMessage) => {
            if (message.id !== this.wid) return
            switch (message.event) {
                case "inited":
                    this.isInited = true
                    this.supportPlatform = message.payload.sources
                    handlers.onInited?.(message.payload)
                    break
                case "initError":
                    this.isInitError = true
                    this.destroy()
                    handlers.onInitError?.(message.error)
                    break

                case "updateAlert":
                    this.isUpdateNeeded = true
                    this.updateAlert = message.payload
                    handlers.onUpdateAlert?.(message.payload)
                    break
                
                case "resolveResult":
                case "resolveError":
                    const promise = this.resolveMap.get(message.rid)
                    this.resolveMap.delete(message.rid)
                    if (promise) {
                        if (message.event === "resolveResult") {
                            promise({ success: true, result: message.result })
                        } else {
                            promise({ success: false, error: message.error })
                        }
                    }
                    break
                
                case "runError":
                case "workerError":
                    handlers.onRunError?.(message.error)
                    break

                case "log":
                    handlers.onLog?.(...message.data)
                    break
            }
        })

        this.sendMessage({
            action: "load",
            id: this.wid,
            script,
            options: this.options
        })
    }

    private sendMessage(message: ActionMessage) {
        this.worker.postMessage(message)
    }

    async resolve(params: LX.ProviderParams): Promise<Result<{ result: LX.ProviderResult }>> {
        if (this.isDestroyed) return { success: false, error: new Error("UserApi destroyed") }
        return new Promise(resolve => {
            const resolveId = createID()
            this.resolveMap.set(resolveId, resolve)
            this.sendMessage({
                action: "resolve",
                id: this.wid,
                rid: resolveId,
                params
            })
        })
    }

    destroy(): void {
        if (this.isDestroyed) return
        this.isDestroyed = true
        this.sendMessage({
            action: "destroy",
            id: this.wid
        })
        this.resolveMap.forEach(promise => promise({ success: false, error: new Error("UserApi destroyed") }))
        this.resolveMap.clear()
        // this.worker = null
    }
}

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