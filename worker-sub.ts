import { workerData, parentPort } from "node:worker_threads"
import type { LX } from "lx-source-type"
import { assert } from "@ceale/util"
import { UserApi, type LxUserApiHandlers, type LxUserApiOptions } from "./user-api.ts"
import type { ActionMessage, EventMessage } from "./worker-main.ts"

export class UserApiWorkerHost {

    map = new Map<string, [UserApi, LxUserApiHandlers]>()

    constructor() {
        parentPort?.on("message", (message: ActionMessage) => {
            switch (message.action) {
                case "load":
                    this.load(message.id, message.script, message.options)
                    break
                case "destroy":
                    this.destroy(message.id)
                    break
                case "resolve":
                    this.resolve(message.id, message.rid, message.params)
                    break
            }
        })
    }

    private sendMessage(message: EventMessage) {
        if (this.map.has(message.id)) {
            parentPort?.postMessage(message)
        }
    }

    async load(id: string, script: string, options: LxUserApiOptions) {
        if (this.map.has(id)) {
            this.sendMessage({ event: "workerError", id, error: "UserApi exists" })
            return
        }
        const handlers = {
            onInited: (data) => {
                this.sendMessage({ event: "inited", id, payload: data })
            },
            onInitError: (error) => {
                this.sendMessage({ event: "initError", id, error })
            },
            onUpdateAlert: (data) => {
                this.sendMessage({ event: "updateAlert", id, payload: data })
            },
            onRunError: (error) => {
                this.sendMessage({ event: "runError", id, error })
            },
            onLog: (...data) => {
                this.sendMessage({ event: "log", id, data })
            }
        } satisfies LxUserApiHandlers
        const userapi = new UserApi(script, handlers, options)
        this.map.set(id, [userapi, handlers])
    }

    async destroy(id: string) {
        if (!this.map.has(id)) {
            this.sendMessage({ event: "workerError", id, error: "UserApi is not exist" })
            return
        }
        const [userapi] = this.map.get(id) ?? []
        userapi?.destroy()
        this.map.delete(id)
    }

    async resolve(id: string, resolveId: string, params: LX.ProviderParams) {
        if (!this.map.has(id)) {
            this.sendMessage({ event: "workerError", id, error: "UserApi is not exist" })
            return
        }
        const [userapi, handlers] = this.map.get(id) ?? []
        userapi?.resolve(params)
            .then(result => {
                if (result.success) {
                    this.sendMessage({ event: "resolveResult", id, rid: resolveId, result: result.result })
                } else {
                    this.sendMessage({ event: "resolveError", id, rid: resolveId, error: result.error })
                }
            })
    }
}
new UserApiWorkerHost()