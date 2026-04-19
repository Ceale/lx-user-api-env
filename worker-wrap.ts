import type { LX } from "lx-source-type"
import type { Worker } from "node:worker_threads"
import type { IUserApi, LxUserApiHandlers, LxUserApiOptions } from "./user-api"
import { createID, type EventMessage, type ActionMessage, type Result } from "./worker-mgr"

export class WorkerUserApi implements IUserApi {

    public isInited = false;
    public isInitError = false;
    public isUpdateNeeded = false;
    public isDestroyed = false;

    public supportPlatform?: LX.InitedPayload["sources"]
    public updateAlert?: LX.UpdateAlertPayload

    public handlers: LxUserApiHandlers
    private options: LxUserApiOptions

    private wid = createID();
    private worker: Worker // | null
    private resolveMap = new Map<string, Function>();
    private initPromise = new Promise<void>(resolve => {
        this.initResolve = resolve
    });
    private initResolve!: Function

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
                    this.initResolve()
                    handlers.onInited?.(message.payload)
                    break
                case "initError":
                    this.isInitError = true
                    this.destroy()
                    this.initResolve()
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
                    handlers.onLog?.(message.level, ...message.data)
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

    public waitInit(): Promise<void> {
        return this.initPromise
    }

    private sendMessage(message: ActionMessage) {
        this.worker.postMessage(message)
    }

    async resolve(params: LX.ProviderParams): Promise<Result<{ result: LX.ProviderResult} >> {
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
